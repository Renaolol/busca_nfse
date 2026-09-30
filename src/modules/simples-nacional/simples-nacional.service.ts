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
  private static readonly EXTENSOES_ACEITAS = /\.(csv|txt|xlsx|zip)$/i;

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
    const where = this.buildBuscaWhere(query.busca);

    const [total, items] = await Promise.all([
      Object.keys(where).length ? this.prisma.simplesNacionalEmpresa.count({ where }) : this.contarEmpresasAtivas(),
      this.prisma.simplesNacionalEmpresa.findMany({
        where,
        orderBy: { cnpjBase: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return {
      items: items.map((item) => this.mapEmpresa(item)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
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

  async limpar(): Promise<SimplesNacionalLimpezaDto> {
    await this.garantirSemImportacaoEmAndamento();
    const [removidas] = await this.prisma.$transaction([
      this.prisma.simplesNacionalEmpresa.deleteMany({}),
      this.prisma.simplesNacionalImportacao.deleteMany({})
    ]);

    return { removidas: removidas.count };
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

  private buildBuscaWhere(busca?: string): Prisma.SimplesNacionalEmpresaWhereInput {
    const texto = String(busca || '').trim();
    if (!texto) {
      return {};
    }

    const cnpjParcial = texto.toUpperCase().replace(/[\s./-]/g, '');
    if (/^[0-9A-Z]{8,14}$/.test(cnpjParcial) && /\d/.test(cnpjParcial)) {
      return { cnpjBase: cnpjParcial.slice(0, 8) };
    }

    if (/^\d{2,7}$/.test(cnpjParcial)) {
      // Faixa na chave primaria (usa o indice), equivalente a "comeca com" para raizes numericas.
      return { cnpjBase: { gte: cnpjParcial.padEnd(8, '0'), lte: cnpjParcial.padEnd(8, '9') } };
    }

    return { razaoSocial: { contains: texto, mode: 'insensitive' } };
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
