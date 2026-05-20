import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Ambiente, DocumentoOrigem, NfseDocumento, Prisma } from '@prisma/client';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { NfseDanfseService } from './nfse-danfse.service';
import { ImportXmlDto } from './dto/import-xml.dto';
import { QueryNfseDto } from './dto/query-nfse.dto';
import { ReprocessarXmlsDto } from './dto/reprocessar-xmls.dto';
import { NfseXmlParserService } from './nfse-xml-parser.service';

@Injectable()
export class NfseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: NfseXmlParserService,
    private readonly storage: LocalStorageService,
    private readonly danfse: NfseDanfseService
  ) {}

  async findAll(query: QueryNfseDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidas') {
        where.cnpjPrestador = cnpjConsulta;
      } else if (tipoRelacao === 'tomadas') {
        where.cnpjTomador = cnpjConsulta;
      } else {
        where.OR = [{ cnpjPrestador: cnpjConsulta }, { cnpjTomador: cnpjConsulta }];
      }
    }

    return this.prisma.nfseDocumento.findMany({
      where,
      orderBy: { dataEmissao: 'desc' },
      take: 500
    });
  }

  async findSeparated(query: QueryNfseDto) {
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    if (!cnpjConsulta) {
      throw new BadRequestException('Informe cnpjConsulta com 14 digitos para separar emitidas e tomadas.');
    }

    const baseWhere = this.buildBaseWhere(query);
    delete baseWhere.cnpjPrestador;
    delete baseWhere.cnpjTomador;
    delete baseWhere.OR;

    const [emitidas, tomadas] = await Promise.all([
      this.prisma.nfseDocumento.findMany({
        where: {
          ...baseWhere,
          cnpjPrestador: cnpjConsulta
        },
        orderBy: { dataEmissao: 'desc' },
        take: 500
      }),
      this.prisma.nfseDocumento.findMany({
        where: {
          ...baseWhere,
          cnpjTomador: cnpjConsulta
        },
        orderBy: { dataEmissao: 'desc' },
        take: 500
      })
    ]);

    return {
      cnpjConsulta,
      totais: {
        emitidas: emitidas.length,
        tomadas: tomadas.length
      },
      emitidas,
      tomadas
    };
  }

  private buildBaseWhere(query: QueryNfseDto): Prisma.NfseDocumentoWhereInput {
    const where: Prisma.NfseDocumentoWhereInput = {};

    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const cnpjPrestador = this.normalizeCnpj(query.cnpjPrestador);
    if (cnpjPrestador) {
      where.cnpjPrestador = cnpjPrestador;
    }

    const cnpjTomador = this.normalizeCnpj(query.cnpjTomador);
    if (cnpjTomador) {
      where.cnpjTomador = cnpjTomador;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.dataInicio || query.dataFim) {
      where.dataEmissao = {
        gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
        lte: query.dataFim ? new Date(query.dataFim) : undefined
      };
    }

    if (query.competencia) {
      const [year, month] = query.competencia.split('-').map((v) => Number(v));
      if (year && month) {
        where.competencia = new Date(Date.UTC(year, month - 1, 1));
      }
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      where.valorServico = {
        gte: query.valorMin,
        lte: query.valorMax
      };
    }

    return where;
  }

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  async findOne(id: string) {
    const found = await this.prisma.nfseDocumento.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('NFS-e nao encontrada');
    }

    return found;
  }

  async getXml(id: string) {
    const doc = await this.findOne(id);
    if (!doc.xmlPath) {
      throw new NotFoundException('XML nao disponivel para esta NFS-e');
    }

    const xml = await this.storage.getObject(doc.xmlPath);
    const xmlUtf8 = xml.toString('utf8');
    const fileName = `NFSE-${doc.chaveAcesso}.xml`;

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      fileName,
      contentType: 'application/xml',
      contentBase64: xml.toString('base64'),
      xml: xmlUtf8
    };
  }

  async getDanfse(id: string) {
    const doc = await this.findOne(id);
    const { danfsePath, pdf } = await this.ensureDanfseFile(doc);

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      danfsePath,
      fileName: `DANFSE-${doc.chaveAcesso}.pdf`,
      contentType: 'application/pdf',
      contentBase64: pdf.toString('base64')
    };
  }

  async importXml(dto: ImportXmlDto) {
    const parsed = this.parser.parse(dto.xml);
    const hash = this.parser.getHash(dto.xml);

    const date = parsed.dataEmissao ?? new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const cnpj = parsed.cnpjPrestador ?? parsed.cnpjTomador ?? 'desconhecido';
    const ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;

    const xmlKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/xml/${parsed.chaveAcesso}.xml`;
    await this.storage.putObject(xmlKey, dto.xml);
    const danfseKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/danfse/${parsed.chaveAcesso}.pdf`;
    const danfsePdf = this.danfse.generateFromXml(dto.xml, {
      chaveAcesso: parsed.chaveAcesso,
      numeroNfse: parsed.numeroNfse,
      dataEmissao: parsed.dataEmissao,
      status: this.normalizeStatus(parsed.status),
      cnpjPrestador: parsed.cnpjPrestador,
      razaoSocialPrestador: parsed.razaoSocialPrestador,
      cnpjTomador: parsed.cnpjTomador,
      razaoSocialTomador: parsed.razaoSocialTomador,
      valorServico: parsed.valorServico,
      descricaoServico: parsed.descricaoServico
    });
    await this.storage.putObject(danfseKey, danfsePdf);

    const competencia = parsed.competencia ?? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const status = this.normalizeStatus(parsed.status) ?? 'autorizada';

    const nfse = await this.prisma.nfseDocumento.upsert({
      where: {
        ambiente_chaveAcesso: {
          ambiente,
          chaveAcesso: parsed.chaveAcesso
        }
      },
      update: {
        clienteId: dto.clienteId,
        estabelecimentoId: dto.estabelecimentoId,
        numeroNfse: parsed.numeroNfse,
        serie: parsed.serie,
        dataEmissao: parsed.dataEmissao,
        status,
        cnpjPrestador: parsed.cnpjPrestador,
        razaoSocialPrestador: parsed.razaoSocialPrestador,
        cnpjTomador: parsed.cnpjTomador,
        razaoSocialTomador: parsed.razaoSocialTomador,
        municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
        municipioPrestacaoNome: parsed.municipioPrestacaoNome,
        valorServico: this.toDecimal(parsed.valorServico),
        valorDeducoes: this.toDecimal(parsed.valorDeducoes),
        valorIss: this.toDecimal(parsed.valorIss),
        aliquotaIss: this.toDecimal(parsed.aliquotaIss),
        codigoServicoNacional: parsed.codigoServicoNacional,
        itemListaServico: parsed.itemListaServico,
        descricaoServico: parsed.descricaoServico,
        xmlPath: xmlKey,
        danfsePath: danfseKey,
        hashXml: hash,
        competencia,
        origem: DocumentoOrigem.importacao_xml
      },
      create: {
        clienteId: dto.clienteId,
        estabelecimentoId: dto.estabelecimentoId,
        ambiente,
        chaveAcesso: parsed.chaveAcesso,
        numeroNfse: parsed.numeroNfse,
        serie: parsed.serie,
        dataEmissao: parsed.dataEmissao,
        status,
        cnpjPrestador: parsed.cnpjPrestador,
        razaoSocialPrestador: parsed.razaoSocialPrestador,
        cnpjTomador: parsed.cnpjTomador,
        razaoSocialTomador: parsed.razaoSocialTomador,
        municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
        municipioPrestacaoNome: parsed.municipioPrestacaoNome,
        valorServico: this.toDecimal(parsed.valorServico),
        valorDeducoes: this.toDecimal(parsed.valorDeducoes),
        valorIss: this.toDecimal(parsed.valorIss),
        aliquotaIss: this.toDecimal(parsed.aliquotaIss),
        codigoServicoNacional: parsed.codigoServicoNacional,
        itemListaServico: parsed.itemListaServico,
        descricaoServico: parsed.descricaoServico,
        xmlPath: xmlKey,
        danfsePath: danfseKey,
        hashXml: hash,
        competencia,
        origem: DocumentoOrigem.importacao_xml
      }
    });

    return {
      id: nfse.id,
      chaveAcesso: nfse.chaveAcesso,
      origem: nfse.origem,
      xmlPath: nfse.xmlPath,
      danfsePath: nfse.danfsePath
    };
  }

  async reprocessarXmls(dto: ReprocessarXmlsDto) {
    const limit = dto.limit ?? 200;
    const somenteIncompletos = dto.somenteIncompletos ?? true;
    const regenerarDanfse = dto.regenerarDanfse ?? true;

    const conditions: Prisma.NfseDocumentoWhereInput[] = [
      {
        xmlPath: {
          not: null
        }
      }
    ];

    if (dto.clienteId) {
      conditions.push({ clienteId: dto.clienteId });
    }

    if (dto.estabelecimentoId) {
      conditions.push({ estabelecimentoId: dto.estabelecimentoId });
    }

    if (dto.ambiente) {
      conditions.push({ ambiente: dto.ambiente === 'producao' ? Ambiente.producao : Ambiente.producao_restrita });
    }

    if (somenteIncompletos) {
      conditions.push({
        OR: [
          { numeroNfse: null },
          { dataEmissao: null },
          { cnpjPrestador: null },
          { razaoSocialPrestador: null },
          { cnpjTomador: null },
          { razaoSocialTomador: null },
          { valorServico: null },
          { descricaoServico: null },
          { codigoServicoNacional: null },
          { danfsePath: null }
        ]
      });
    }

    const where: Prisma.NfseDocumentoWhereInput =
      conditions.length === 1
        ? conditions[0]
        : {
            AND: conditions
          };

    const docs = await this.prisma.nfseDocumento.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit
    });

    let processados = 0;
    let atualizados = 0;
    let falhas = 0;
    const erros: Array<{ id: string; chaveAcesso: string; erro: string }> = [];

    for (const doc of docs) {
      processados += 1;

      try {
        if (!doc.xmlPath) {
          throw new Error('Documento sem xmlPath');
        }

        const xml = (await this.storage.getObject(doc.xmlPath)).toString('utf8');
        const parsed = this.parser.parse(xml);
        const hash = this.parser.getHash(xml);
        const dataReferencia = parsed.dataEmissao ?? doc.dataEmissao ?? doc.createdAt ?? new Date();
        const competencia =
          parsed.competencia ??
          (parsed.dataEmissao ? new Date(Date.UTC(parsed.dataEmissao.getUTCFullYear(), parsed.dataEmissao.getUTCMonth(), 1)) : undefined);
        const cnpj =
          this.normalizeCnpj(parsed.cnpjPrestador) ??
          this.normalizeCnpj(parsed.cnpjTomador) ??
          this.normalizeCnpj(doc.cnpjPrestador) ??
          this.normalizeCnpj(doc.cnpjTomador) ??
          'desconhecido';
        const year = dataReferencia.getUTCFullYear();
        const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
        const danfseKey = `nfse/${doc.ambiente}/${cnpj}/${year}/${month}/danfse/${doc.chaveAcesso}.pdf`;

        if (regenerarDanfse) {
          const pdf = this.danfse.generateFromXml(xml, {
            chaveAcesso: doc.chaveAcesso,
            numeroNfse: parsed.numeroNfse ?? doc.numeroNfse,
            dataEmissao: parsed.dataEmissao ?? doc.dataEmissao,
            status: this.normalizeStatus(parsed.status) ?? doc.status,
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador ?? doc.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador ?? doc.razaoSocialTomador,
            valorServico: parsed.valorServico ?? doc.valorServico?.toString(),
            descricaoServico: parsed.descricaoServico ?? doc.descricaoServico
          });
          await this.storage.putObject(danfseKey, pdf);
        }

        await this.prisma.nfseDocumento.update({
          where: { id: doc.id },
          data: {
            numeroNfse: parsed.numeroNfse ?? doc.numeroNfse,
            serie: parsed.serie ?? doc.serie,
            dataEmissao: parsed.dataEmissao ?? doc.dataEmissao,
            competencia: competencia ?? doc.competencia,
            status: this.normalizeStatus(parsed.status) ?? doc.status,
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador ?? doc.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador ?? doc.razaoSocialTomador,
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo ?? doc.municipioPrestacaoCodigo,
            municipioPrestacaoNome: parsed.municipioPrestacaoNome ?? doc.municipioPrestacaoNome,
            valorServico: this.toDecimal(parsed.valorServico) ?? doc.valorServico,
            valorDeducoes: this.toDecimal(parsed.valorDeducoes) ?? doc.valorDeducoes,
            valorIss: this.toDecimal(parsed.valorIss) ?? doc.valorIss,
            aliquotaIss: this.toDecimal(parsed.aliquotaIss) ?? doc.aliquotaIss,
            codigoServicoNacional: parsed.codigoServicoNacional ?? doc.codigoServicoNacional,
            itemListaServico: parsed.itemListaServico ?? doc.itemListaServico,
            descricaoServico: parsed.descricaoServico ?? doc.descricaoServico,
            hashXml: hash,
            danfsePath: regenerarDanfse ? danfseKey : doc.danfsePath
          }
        });

        atualizados += 1;
      } catch (error) {
        falhas += 1;
        const message = error instanceof Error ? error.message : String(error);
        erros.push({
          id: doc.id,
          chaveAcesso: doc.chaveAcesso,
          erro: message
        });
      }
    }

    return {
      filtros: {
        clienteId: dto.clienteId ?? null,
        estabelecimentoId: dto.estabelecimentoId ?? null,
        ambiente: dto.ambiente ?? null,
        somenteIncompletos,
        regenerarDanfse,
        limit
      },
      totalSelecionados: docs.length,
      processados,
      atualizados,
      falhas,
      erros
    };
  }

  async downloadLote(dto: DownloadLoteDto) {
    const docs = await this.prisma.nfseDocumento.findMany({
      where: {
        id: {
          in: dto.ids
        }
      },
      select: {
        id: true,
        chaveAcesso: true,
        xmlPath: true,
        danfsePath: true
      }
    });

    return {
      total: docs.length,
      documentos: docs,
      observacao: 'Geracao de ZIP em lote sera implementada na fase operacional.'
    };
  }

  private async ensureDanfseFile(doc: NfseDocumento): Promise<{ danfsePath: string; pdf: Buffer }> {
    if (doc.danfsePath) {
      try {
        const existingPdf = await this.storage.getObject(doc.danfsePath);
        if (!this.isLegacyDanfse(existingPdf)) {
          return { danfsePath: doc.danfsePath, pdf: existingPdf };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('ENOENT')) {
          throw error;
        }
      }
    }

    if (!doc.xmlPath) {
      throw new NotFoundException('DANFSe nao disponivel para esta NFS-e');
    }

    let xmlBuffer: Buffer;
    try {
      xmlBuffer = await this.storage.getObject(doc.xmlPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        throw new NotFoundException('XML nao disponivel para gerar DANFSe');
      }
      throw error;
    }
    const xml = xmlBuffer.toString('utf8');
    const periodBaseDate = doc.dataEmissao ?? doc.createdAt ?? new Date();
    const year = periodBaseDate.getUTCFullYear();
    const month = String(periodBaseDate.getUTCMonth() + 1).padStart(2, '0');
    const cnpj =
      this.normalizeCnpj(doc.cnpjPrestador) ??
      this.normalizeCnpj(doc.cnpjTomador) ??
      'desconhecido';
    const danfseKey = `nfse/${doc.ambiente}/${cnpj}/${year}/${month}/danfse/${doc.chaveAcesso}.pdf`;

    const pdf = this.danfse.generateFromXml(xml, {
      chaveAcesso: doc.chaveAcesso,
      numeroNfse: doc.numeroNfse,
      dataEmissao: doc.dataEmissao,
      status: doc.status,
      cnpjPrestador: doc.cnpjPrestador,
      razaoSocialPrestador: doc.razaoSocialPrestador,
      cnpjTomador: doc.cnpjTomador,
      razaoSocialTomador: doc.razaoSocialTomador,
      valorServico: doc.valorServico?.toString(),
      descricaoServico: doc.descricaoServico
    });

    await this.storage.putObject(danfseKey, pdf);

    if (doc.danfsePath !== danfseKey) {
      await this.prisma.nfseDocumento.update({
        where: { id: doc.id },
        data: { danfsePath: danfseKey }
      });
    }

    return { danfsePath: danfseKey, pdf };
  }

  private isLegacyDanfse(pdf: Buffer): boolean {
    if (!pdf.length) {
      return true;
    }

    return !pdf.includes(Buffer.from('DANFSE - pagina', 'utf8'));
  }

  private toDecimal(value?: string): Prisma.Decimal | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    const sanitized =
      normalized.includes(',') && normalized.includes('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(',', '.');

    if (!/^-?\d+(\.\d+)?$/.test(sanitized)) {
      return undefined;
    }

    return new Prisma.Decimal(sanitized);
  }

  private normalizeStatus(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (normalized === '100') {
      return 'autorizada';
    }

    if (normalized === '101') {
      return 'cancelada';
    }

    return normalized;
  }
}
