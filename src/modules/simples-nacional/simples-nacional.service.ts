import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SimplesNacionalEmpresa, SimplesNacionalImportacao } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { ImportarSimplesNacionalDto } from './dto/importar-simples-nacional.dto';
import { ListSimplesNacionalEmpresasQueryDto } from './dto/list-simples-nacional-empresas-query.dto';
import {
  SimplesNacionalConsultaDto,
  SimplesNacionalEmpresaDto,
  SimplesNacionalEmpresasPageDto,
  SimplesNacionalImportacaoDto,
  SimplesNacionalImportacaoResultadoDto,
  SimplesNacionalLimpezaDto,
  SimplesNacionalResumoDto
} from './dto/simples-nacional-response.dto';
import { SimplesNacionalPlanilhaParserService } from './simples-nacional-planilha-parser.service';

@Injectable()
export class SimplesNacionalService {
  private static readonly TAMANHO_LOTE = 1000;
  private static readonly MAX_LINHAS_IGNORADAS_RESPOSTA = 50;
  private static readonly PAGE_SIZE_PADRAO = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planilhaParser: SimplesNacionalPlanilhaParserService
  ) {}

  async getResumo(): Promise<SimplesNacionalResumoDto> {
    const [totalEmpresas, ultimaImportacao] = await Promise.all([
      this.prisma.simplesNacionalEmpresa.count(),
      this.prisma.simplesNacionalImportacao.findFirst({ orderBy: { createdAt: 'desc' } })
    ]);

    return {
      totalEmpresas,
      ultimaImportacao: ultimaImportacao ? this.mapImportacao(ultimaImportacao) : null
    };
  }

  async listEmpresas(query: ListSimplesNacionalEmpresasQueryDto): Promise<SimplesNacionalEmpresasPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SimplesNacionalService.PAGE_SIZE_PADRAO;
    const where = this.buildBuscaWhere(query.busca);

    const [total, items] = await Promise.all([
      this.prisma.simplesNacionalEmpresa.count({ where }),
      this.prisma.simplesNacionalEmpresa.findMany({
        where,
        orderBy: [{ razaoSocial: 'asc' }, { cnpjBase: 'asc' }],
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
   * Retorna os CNPJs (sem pontuacao) cuja raiz consta na tabela do Simples Nacional.
   * O Simples Nacional vale para a empresa inteira, entao matriz e filiais compartilham a raiz.
   */
  async filtrarOptantes(cnpjs: string[]): Promise<Set<string>> {
    const consultas = cnpjs
      .map((cnpj) => this.normalizarCnpjConsulta(cnpj))
      .filter((consulta): consulta is { cnpj: string; cnpjBase: string } => Boolean(consulta));
    if (!consultas.length) {
      return new Set();
    }

    const encontradas = await this.prisma.simplesNacionalEmpresa.findMany({
      where: { cnpjBase: { in: [...new Set(consultas.map((consulta) => consulta.cnpjBase))] } },
      select: { cnpjBase: true }
    });
    const bases = new Set(encontradas.map((empresa) => empresa.cnpjBase));

    return new Set(consultas.filter((consulta) => bases.has(consulta.cnpjBase)).map((consulta) => consulta.cnpj));
  }

  async importar(
    dto: ImportarSimplesNacionalDto,
    authUser?: AuthenticatedUser
  ): Promise<SimplesNacionalImportacaoResultadoDto> {
    const nomeArquivo = String(dto.nomeArquivo || '').trim().slice(0, 255);
    const conteudo = this.decodificarBase64(dto.arquivoBase64);
    const planilha = await this.planilhaParser.parse(nomeArquivo, conteudo);

    if (!planilha.empresas.length) {
      throw new BadRequestException(
        `Nenhum CNPJ valido encontrado na coluna "${planilha.colunaCnpj}". A tabela atual foi mantida.`
      );
    }

    const importacaoId = randomUUID();
    const empresas = planilha.empresas.map((empresa) => ({
      importacaoId,
      cnpjBase: empresa.cnpjBase,
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      linhaOrigem: empresa.linha
    }));
    const lotes: Prisma.SimplesNacionalEmpresaCreateManyInput[][] = [];
    for (let inicio = 0; inicio < empresas.length; inicio += SimplesNacionalService.TAMANHO_LOTE) {
      lotes.push(empresas.slice(inicio, inicio + SimplesNacionalService.TAMANHO_LOTE));
    }

    const [, importacao] = await this.prisma.$transaction([
      this.prisma.simplesNacionalImportacao.deleteMany({}),
      this.prisma.simplesNacionalImportacao.create({
        data: {
          id: importacaoId,
          nomeArquivo,
          totalLinhas: planilha.totalLinhas,
          totalEmpresas: empresas.length,
          totalIgnoradas: planilha.ignoradas.length,
          totalDuplicadas: planilha.totalDuplicadas,
          usuarioId: authUser?.userId ?? null,
          usuarioNome: (authUser?.nome || authUser?.username || '').slice(0, 255) || null
        }
      }),
      ...lotes.map((lote) => this.prisma.simplesNacionalEmpresa.createMany({ data: lote }))
    ]);

    return {
      importacao: this.mapImportacao(importacao as SimplesNacionalImportacao),
      colunaCnpj: planilha.colunaCnpj,
      colunaRazaoSocial: planilha.colunaRazaoSocial,
      linhasIgnoradas: planilha.ignoradas.slice(0, SimplesNacionalService.MAX_LINHAS_IGNORADAS_RESPOSTA)
    };
  }

  async limpar(): Promise<SimplesNacionalLimpezaDto> {
    const [removidas] = await this.prisma.$transaction([
      this.prisma.simplesNacionalEmpresa.deleteMany({}),
      this.prisma.simplesNacionalImportacao.deleteMany({})
    ]);

    return { removidas: removidas.count };
  }

  private buildBuscaWhere(busca?: string): Prisma.SimplesNacionalEmpresaWhereInput {
    const texto = String(busca || '').trim();
    if (!texto) {
      return {};
    }

    const filtros: Prisma.SimplesNacionalEmpresaWhereInput[] = [
      { razaoSocial: { contains: texto, mode: 'insensitive' } }
    ];
    const cnpjParcial = texto.toUpperCase().replace(/[\s./-]/g, '');
    if (/^[0-9A-Z]{2,14}$/.test(cnpjParcial) && /\d/.test(cnpjParcial)) {
      filtros.push({ cnpj: { contains: cnpjParcial } }, { cnpjBase: { contains: cnpjParcial.slice(0, 8) } });
    }

    return { OR: filtros };
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

  private decodificarBase64(arquivoBase64: string): Buffer {
    const base64 = String(arquivoBase64 || '')
      .replace(/^data:[^,]*,/, '')
      .replace(/\s/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new BadRequestException('Conteudo do arquivo invalido. Envie o arquivo em Base64.');
    }

    return Buffer.from(base64, 'base64');
  }

  private mapImportacao(importacao: SimplesNacionalImportacao): SimplesNacionalImportacaoDto {
    return {
      id: importacao.id,
      nomeArquivo: importacao.nomeArquivo,
      importadoEm: importacao.createdAt.toISOString(),
      importadoPor: importacao.usuarioNome,
      totalLinhas: importacao.totalLinhas,
      totalEmpresas: importacao.totalEmpresas,
      totalIgnoradas: importacao.totalIgnoradas,
      totalDuplicadas: importacao.totalDuplicadas
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
