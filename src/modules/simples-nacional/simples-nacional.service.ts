import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException
} from '@nestjs/common';
import { Prisma, SimplesNacionalEmpresa, SimplesNacionalImportacao } from '@prisma/client';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { ListSimplesNacionalEmpresasQueryDto } from './dto/list-simples-nacional-empresas-query.dto';
import {
  SimplesNacionalConsultaDto,
  SimplesNacionalEmpresaDto,
  SimplesNacionalEmpresasPageDto,
  SimplesNacionalImportacaoDto,
  SimplesNacionalLimpezaDto,
  SimplesNacionalLinhaIgnoradaDto,
  SimplesNacionalResumoDto
} from './dto/simples-nacional-response.dto';
import { PlanilhaSimplesResumo, SimplesNacionalPlanilhaParserService } from './simples-nacional-planilha-parser.service';

type BuscaEmpresas =
  | { tipo: 'todas' }
  | { tipo: 'raiz'; cnpjBase: string }
  | { tipo: 'faixa'; inicio: string; fim: string }
  | { tipo: 'nome'; consulta: string };

@Injectable()
export class SimplesNacionalService {
  static readonly TAMANHO_MAXIMO_ARQUIVO = 5 * 1024 * 1024 * 1024;
  private static readonly TAMANHO_LOTE = 5000;
  private static readonly TAMANHO_LOTE_CONSULTA = 1000;
  private static readonly PAGE_SIZE_PADRAO = 50;
  private static readonly INTERVALO_BATIMENTO_MS = 5000;
  private static readonly LIMITE_SEM_BATIMENTO_MS = 2 * 60 * 1000;
  private static readonly TIMEOUT_TRANSACAO_MS = 6 * 60 * 60 * 1000;
  private static readonly PREFIXO_TEMPORARIO = 'nfse-simples-';
  private static readonly EXTENSOES_ACEITAS = /\.(csv|txt|xlsx|zip|gz)$/i;
  private static readonly TIMEOUT_BUSCA_NOME_MS = 20000;
  private static readonly MAX_PALAVRAS_BUSCA = 6;

  private readonly logger = new Logger(SimplesNacionalService.name);
  private processamento: Promise<void> | null = null;
  private recebendoArquivo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planilhaParser: SimplesNacionalPlanilhaParserService
  ) {}

  async getResumo(): Promise<SimplesNacionalResumoDto> {
    await this.marcarImportacoesInterrompidas();
    const [ultimaImportacao, ultimaTentativa] = await Promise.all([
      this.prisma.simplesNacionalImportacao.findFirst({ where: { status: 'concluida' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.simplesNacionalImportacao.findFirst({
        where: { status: { not: 'concluida' } },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    const tentativaMaisRecente =
      ultimaTentativa && (!ultimaImportacao || ultimaTentativa.createdAt > ultimaImportacao.createdAt)
        ? ultimaTentativa
        : null;

    return {
      totalEmpresas: ultimaImportacao?.totalEmpresas ?? 0,
      ultimaImportacao: ultimaImportacao ? this.mapImportacao(ultimaImportacao) : null,
      ultimaTentativa: tentativaMaisRecente ? this.mapImportacao(tentativaMaisRecente) : null
    };
  }

  async listEmpresas(query: ListSimplesNacionalEmpresasQueryDto): Promise<SimplesNacionalEmpresasPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SimplesNacionalService.PAGE_SIZE_PADRAO;
    const skip = (page - 1) * pageSize;
    const busca = this.interpretarBusca(query.busca);

    if (busca.tipo === 'todas') {
      const [total, items] = await Promise.all([
        this.contarEmpresasAtivas(),
        this.prisma.simplesNacionalEmpresa.findMany({ orderBy: { cnpjBase: 'asc' }, skip, take: pageSize })
      ]);
      return {
        items: items.map((item) => this.mapEmpresa(item)),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        temMais: skip + items.length < total
      };
    }

    // Com filtro nao ha contagem exata: numa tabela com dezenas de milhoes de linhas ela custaria uma varredura.
    const encontrados =
      busca.tipo === 'nome'
        ? await this.buscarPorNome(busca.consulta, skip, pageSize + 1)
        : await this.prisma.simplesNacionalEmpresa.findMany({
            where: { cnpjBase: busca.tipo === 'raiz' ? busca.cnpjBase : { gte: busca.inicio, lte: busca.fim } },
            orderBy: { cnpjBase: 'asc' },
            skip,
            take: pageSize + 1
          });

    return {
      items: encontrados.slice(0, pageSize).map((item) => this.mapEmpresa(item)),
      total: null,
      page,
      pageSize,
      totalPages: null,
      temMais: encontrados.length > pageSize
    };
  }

  async consultarCnpj(cnpj: string): Promise<SimplesNacionalConsultaDto> {
    const consulta = this.normalizarCnpjConsulta(cnpj);
    if (!consulta) {
      throw new BadRequestException('Informe um CNPJ com 14 caracteres ou a raiz do CNPJ com 8 digitos.');
    }

    const empresa = await this.prisma.simplesNacionalEmpresa.findUnique({
      where: { cnpjBase: consulta.cnpjBase }
    });

    return {
      cnpj: consulta.cnpj,
      cnpjBase: consulta.cnpjBase,
      optante: Boolean(empresa),
      empresa: empresa ? this.mapEmpresa(empresa) : null
    };
  }

  /**
   * Retorna as raizes de CNPJ (8 primeiros caracteres) que constam na tabela do Simples Nacional.
   * O Simples Nacional vale para a empresa inteira, entao matriz e filiais compartilham a raiz.
   */
  async filtrarBasesOptantes(cnpjs: string[]): Promise<string[]> {
    const bases = [
      ...new Set(
        cnpjs
          .map((cnpj) => this.normalizarCnpjConsulta(cnpj)?.cnpjBase)
          .filter((base): base is string => Boolean(base))
      )
    ];

    const optantes: string[] = [];
    for (let inicio = 0; inicio < bases.length; inicio += SimplesNacionalService.TAMANHO_LOTE_CONSULTA) {
      const encontradas = await this.prisma.simplesNacionalEmpresa.findMany({
        where: { cnpjBase: { in: bases.slice(inicio, inicio + SimplesNacionalService.TAMANHO_LOTE_CONSULTA) } },
        select: { cnpjBase: true }
      });
      optantes.push(...encontradas.map((empresa) => empresa.cnpjBase));
    }

    return optantes;
  }

  /**
   * Grava o arquivo recebido em disco e inicia o processamento em segundo plano. A tabela atual continua valendo
   * ate a nova ser gravada por completo; se o processamento falhar, ela e mantida.
   */
  async iniciarImportacao(
    arquivo: Readable,
    nomeArquivoInformado: string,
    authUser?: AuthenticatedUser
  ): Promise<SimplesNacionalImportacaoDto> {
    const nomeArquivo = String(nomeArquivoInformado || '')
      .trim()
      .replace(/[\\/]/g, '_')
      .slice(0, 255);
    if (!SimplesNacionalService.EXTENSOES_ACEITAS.test(nomeArquivo)) {
      arquivo.resume();
      throw new BadRequestException('Envie a tabela em .csv, .txt, .xlsx ou .zip.');
    }

    await this.garantirSemImportacaoEmAndamento();
    this.recebendoArquivo = true;
    let diretorio: string | null = null;
    try {
      await this.removerTemporariosAntigos();
      diretorio = await mkdtemp(join(tmpdir(), SimplesNacionalService.PREFIXO_TEMPORARIO));
      const caminho = join(diretorio, `arquivo${extname(nomeArquivo).toLowerCase()}`);
      const bytes = await this.salvarArquivo(arquivo, caminho);
      if (!bytes) {
        throw new BadRequestException('O arquivo enviado esta vazio.');
      }

      await this.prisma.simplesNacionalImportacao.deleteMany({ where: { status: 'erro' } });
      const importacao = await this.prisma.simplesNacionalImportacao.create({
        data: {
          nomeArquivo,
          status: 'processando',
          usuarioId: authUser?.userId ?? null,
          usuarioNome: (authUser?.nome || authUser?.username || '').slice(0, 255) || null
        }
      });

      const diretorioImportacao = diretorio;
      diretorio = null;
      this.processamento = this.processarImportacao(importacao.id, caminho, nomeArquivo).finally(async () => {
        await rm(diretorioImportacao, { recursive: true, force: true }).catch(() => undefined);
        this.processamento = null;
      });

      return this.mapImportacao(importacao);
    } finally {
      this.recebendoArquivo = false;
      if (diretorio) {
        await rm(diretorio, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Aguarda a importacao em segundo plano deste processo, se houver. */
  async aguardarImportacaoEmAndamento(): Promise<void> {
    await this.processamento;
  }

  /**
   * Exclui todas as empresas. TRUNCATE e instantaneo e devolve o espaco em disco na hora; um DELETE de dezenas de
   * milhoes de linhas levaria muitos minutos e deixaria a tabela inchada ate o VACUUM.
   */
  async limpar(): Promise<SimplesNacionalLimpezaDto> {
    await this.garantirSemImportacaoEmAndamento();
    const removidas = await this.contarEmpresasAtivas();
    await this.prisma.$transaction([
      this.prisma.$executeRaw`TRUNCATE TABLE simples_nacional_empresas`,
      this.prisma.simplesNacionalImportacao.deleteMany({})
    ]);

    return { removidas };
  }

  private async processarImportacao(id: string, caminho: string, nomeArquivo: string): Promise<void> {
    let linhasLidas = 0;
    const batimento = setInterval(() => {
      void this.prisma.simplesNacionalImportacao
        .update({ where: { id }, data: { linhasProcessadas: linhasLidas } })
        .catch(() => undefined);
    }, SimplesNacionalService.INTERVALO_BATIMENTO_MS);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          let inseridas = 0;
          await tx.simplesNacionalEmpresa.deleteMany({});
          const resumo = await this.planilhaParser.processarArquivo(caminho, nomeArquivo, {
            tamanhoLote: SimplesNacionalService.TAMANHO_LOTE,
            onProgresso: (total) => {
              linhasLidas = total;
            },
            onLote: async (empresas) => {
              const { count } = await tx.simplesNacionalEmpresa.createMany({
                data: empresas.map((empresa) => ({
                  cnpjBase: empresa.cnpjBase,
                  cnpj: empresa.cnpj,
                  razaoSocial: empresa.razaoSocial,
                  linhaOrigem: empresa.linha
                })),
                skipDuplicates: true
              });
              inseridas += count;
            }
          });

          linhasLidas = resumo.totalLinhas;
          if (!inseridas) {
            throw new BadRequestException(this.mensagemSemEmpresas(resumo));
          }

          clearInterval(batimento);
          await tx.simplesNacionalImportacao.deleteMany({ where: { id: { not: id } } });
          await tx.simplesNacionalImportacao.update({
            where: { id },
            data: {
              status: 'concluida',
              concluidoEm: new Date(),
              layout: resumo.layout,
              colunaCnpj: resumo.colunaCnpj.slice(0, 255),
              colunaRazaoSocial: resumo.colunaRazaoSocial?.slice(0, 255) ?? null,
              colunaOpcao: resumo.colunaOpcao?.slice(0, 255) ?? null,
              linhasProcessadas: resumo.totalLinhas,
              totalLinhas: resumo.totalLinhas,
              totalEmpresas: inseridas,
              totalIgnoradas: resumo.totalIgnoradas,
              totalDuplicadas: resumo.totalOptantes - inseridas,
              totalNaoOptantes: resumo.totalNaoOptantes,
              linhasIgnoradas: resumo.linhasIgnoradas as unknown as Prisma.InputJsonValue,
              mensagem: null
            }
          });
        },
        { maxWait: 10000, timeout: SimplesNacionalService.TIMEOUT_TRANSACAO_MS }
      );
      // Estatisticas atualizadas para o planejador escolher entre o indice de nome e a chave primaria.
      await this.prisma.$executeRaw`ANALYZE simples_nacional_empresas`.catch((error: unknown) =>
        this.logger.warn(`ANALYZE da tabela do Simples Nacional falhou: ${error instanceof Error ? error.message : error}`)
      );
    } catch (error) {
      const mensagem = this.mensagemErro(error);
      this.logger.warn(`Importacao ${id} da tabela do Simples Nacional falhou: ${mensagem}`);
      await this.prisma.simplesNacionalImportacao
        .update({ where: { id }, data: { status: 'erro', mensagem, linhasProcessadas: linhasLidas } })
        .catch(() => undefined);
    } finally {
      clearInterval(batimento);
    }
  }

  private async salvarArquivo(arquivo: Readable, caminho: string): Promise<number> {
    let bytes = 0;
    const limitador = new Transform({
      transform(trecho: Buffer, _encoding, callback) {
        bytes += trecho.length;
        if (bytes > SimplesNacionalService.TAMANHO_MAXIMO_ARQUIVO) {
          callback(new PayloadTooLargeException('O arquivo excede o limite de 5 GB. Envie o arquivo compactado em .zip.'));
          return;
        }
        callback(null, trecho);
      }
    });

    try {
      await pipeline(arquivo, limitador, createWriteStream(caminho));
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException('O envio do arquivo foi interrompido. Envie o arquivo novamente.');
    }

    return bytes;
  }

  private async garantirSemImportacaoEmAndamento(): Promise<void> {
    const mensagem = 'Ja existe uma importacao da tabela do Simples Nacional em andamento. Aguarde a conclusao.';
    if (this.processamento || this.recebendoArquivo) {
      throw new ConflictException(mensagem);
    }

    await this.marcarImportacoesInterrompidas();
    const emAndamento = await this.prisma.simplesNacionalImportacao.findFirst({ where: { status: 'processando' } });
    if (emAndamento) {
      throw new ConflictException(mensagem);
    }
  }

  /** Importacao sem batimento recente parou junto com o servidor: libera uma nova tentativa. */
  private async marcarImportacoesInterrompidas(): Promise<void> {
    await this.prisma.simplesNacionalImportacao.updateMany({
      where: {
        status: 'processando',
        updatedAt: { lt: new Date(Date.now() - SimplesNacionalService.LIMITE_SEM_BATIMENTO_MS) }
      },
      data: {
        status: 'erro',
        mensagem: 'A importacao foi interrompida (o servidor foi reiniciado ou parou de responder). Envie o arquivo novamente.'
      }
    });
  }

  private async removerTemporariosAntigos(): Promise<void> {
    const entradas = await readdir(tmpdir(), { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entradas
        .filter((entrada) => entrada.isDirectory() && entrada.name.startsWith(SimplesNacionalService.PREFIXO_TEMPORARIO))
        .map((entrada) => rm(join(tmpdir(), entrada.name), { recursive: true, force: true }).catch(() => undefined))
    );
  }

  private async contarEmpresasAtivas(): Promise<number> {
    const ativa = await this.prisma.simplesNacionalImportacao.findFirst({
      where: { status: 'concluida' },
      orderBy: { createdAt: 'desc' },
      select: { totalEmpresas: true }
    });
    return ativa?.totalEmpresas ?? 0;
  }

  private interpretarBusca(busca?: string): BuscaEmpresas {
    const texto = String(busca || '').trim();
    if (!texto) {
      return { tipo: 'todas' };
    }

    const compacto = texto.toUpperCase().replace(/[\s./-]/g, '');
    if (/^[0-9A-Z]{12}\d{2}$/.test(compacto) && /\d/.test(compacto.slice(0, 12))) {
      return { tipo: 'raiz', cnpjBase: compacto.slice(0, 8) };
    }

    if (/^\d{12,13}$/.test(compacto)) {
      return { tipo: 'raiz', cnpjBase: compacto.padStart(14, '0').slice(0, 8) };
    }

    if (/^\d{8,10}$/.test(compacto)) {
      return { tipo: 'raiz', cnpjBase: compacto.slice(0, 8) };
    }

    if (/^\d{2,7}$/.test(compacto)) {
      // Faixa na chave primaria (usa o indice), equivalente a "comeca com" para raizes numericas.
      return { tipo: 'faixa', inicio: compacto.padEnd(8, '0'), fim: compacto.padEnd(8, '9') };
    }

    // Nome, razao social ou CPF (os nomes de MEI trazem o CPF do titular): cada palavra vira um prefixo.
    // Pontuacao entre digitos e removida para "113.387.678-10" virar um unico termo.
    const palavras = texto
      .replace(/(\d)[.\-/](?=\d)/g, '$1')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((palavra) => palavra.length >= 2)
      .slice(0, SimplesNacionalService.MAX_PALAVRAS_BUSCA);
    if (!palavras.length) {
      throw new BadRequestException('Digite ao menos 2 letras do nome ou o CNPJ para buscar.');
    }

    return {
      tipo: 'nome',
      consulta: palavras.map((palavra) => (palavra.length >= 3 ? `${palavra}:*` : palavra)).join(' & ')
    };
  }

  /**
   * Usa o indice GIN criado na migration 20260930190000_simples_nacional_busca_nome. Para termos raros o planejador
   * estima mal e prefere varrer a tabela calculando o tsvector linha a linha (minutos em dezenas de milhoes de
   * linhas), por isso a varredura sequencial e desligada nesta consulta. Sem ORDER BY a leitura para assim que
   * completa a pagina; o resultado sai na ordem fisica (ordem de importacao do arquivo).
   */
  private async buscarPorNome(consulta: string, skip: number, take: number): Promise<SimplesNacionalEmpresa[]> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(SimplesNacionalService.TIMEOUT_BUSCA_NOME_MS)}, true), set_config('enable_seqscan', 'off', true)`;
          return tx.$queryRaw<SimplesNacionalEmpresa[]>`
            SELECT cnpj_base AS "cnpjBase", cnpj, razao_social AS "razaoSocial", linha_origem AS "linhaOrigem"
            FROM simples_nacional_empresas
            WHERE razao_social IS NOT NULL
              AND simples_nacional_nome_tsvector(razao_social) @@ to_tsquery('simple', ${consulta})
            LIMIT ${take} OFFSET ${skip}`;
        },
        { timeout: SimplesNacionalService.TIMEOUT_BUSCA_NOME_MS + 10000 }
      );
    } catch (error) {
      if (/statement timeout|canceling statement|57014/i.test(error instanceof Error ? error.message : String(error))) {
        throw new BadRequestException(
          'A busca demorou demais. Digite o nome mais completo (ex.: nome e sobrenome) ou busque pelo CNPJ.'
        );
      }
      throw error;
    }
  }

  private normalizarCnpjConsulta(valor: string): { cnpj: string; cnpjBase: string } | null {
    const cnpj = String(valor || '')
      .trim()
      .toUpperCase()
      .replace(/[\s./-]/g, '');
    if (/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^\d{8}$/.test(cnpj)) {
      return { cnpj, cnpjBase: cnpj.slice(0, 8) };
    }

    return null;
  }

  private mensagemSemEmpresas(resumo: PlanilhaSimplesResumo): string {
    const motivo =
      resumo.layout === 'receita_simples'
        ? 'Nenhuma empresa com opcao "S" pelo Simples Nacional foi encontrada no arquivo.'
        : resumo.colunaOpcao
          ? `Nenhuma linha com CNPJ valido marcada como optante na coluna "${resumo.colunaOpcao}".`
          : `Nenhum CNPJ valido encontrado na coluna "${resumo.colunaCnpj}".`;
    return `${motivo} A tabela atual foi mantida.`;
  }

  private mensagemErro(error: unknown): string {
    if (error instanceof HttpException) {
      const resposta = error.getResponse();
      const mensagem =
        typeof resposta === 'object' && resposta && 'message' in resposta
          ? (resposta as { message: unknown }).message
          : error.message;
      return String(Array.isArray(mensagem) ? mensagem.join('; ') : mensagem).slice(0, 1000);
    }

    const detalhe = error instanceof Error ? error.message : String(error);
    return `Falha ao gravar a tabela; a tabela atual foi mantida. Detalhe: ${detalhe}`.slice(0, 1000);
  }

  private mapImportacao(importacao: SimplesNacionalImportacao): SimplesNacionalImportacaoDto {
    return {
      id: importacao.id,
      nomeArquivo: importacao.nomeArquivo,
      status: importacao.status,
      layout: importacao.layout,
      colunaCnpj: importacao.colunaCnpj,
      colunaRazaoSocial: importacao.colunaRazaoSocial,
      colunaOpcao: importacao.colunaOpcao,
      importadoEm: importacao.createdAt.toISOString(),
      atualizadoEm: importacao.updatedAt.toISOString(),
      concluidoEm: importacao.concluidoEm ? importacao.concluidoEm.toISOString() : null,
      importadoPor: importacao.usuarioNome,
      linhasProcessadas: importacao.linhasProcessadas,
      totalLinhas: importacao.totalLinhas,
      totalEmpresas: importacao.totalEmpresas,
      totalIgnoradas: importacao.totalIgnoradas,
      totalDuplicadas: importacao.totalDuplicadas,
      totalNaoOptantes: importacao.totalNaoOptantes,
      linhasIgnoradas: Array.isArray(importacao.linhasIgnoradas)
        ? (importacao.linhasIgnoradas as unknown as SimplesNacionalLinhaIgnoradaDto[])
        : [],
      mensagem: importacao.mensagem
    };
  }

  private mapEmpresa(empresa: SimplesNacionalEmpresa): SimplesNacionalEmpresaDto {
    return {
      cnpjBase: empresa.cnpjBase,
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      linhaOrigem: empresa.linhaOrigem
    };
  }
}
