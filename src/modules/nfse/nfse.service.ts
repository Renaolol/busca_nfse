import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Ambiente, DocumentoOrigem, NfseDocumento, Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { NfseDanfseService } from './nfse-danfse.service';
import { ImportXmlDto } from './dto/import-xml.dto';
import { QueryNfseDto } from './dto/query-nfse.dto';
import { ReprocessarDanfsesDto } from './dto/reprocessar-danfses.dto';
import { ReprocessarXmlsDto } from './dto/reprocessar-xmls.dto';
import { NfseXmlParserService, ParsedNfse, ParsedNfseEvento } from './nfse-xml-parser.service';

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
      take: 500,
      include: this.nfseDocumentoInclude()
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
        take: 500,
        include: this.nfseDocumentoInclude()
      }),
      this.prisma.nfseDocumento.findMany({
        where: {
          ...baseWhere,
          cnpjTomador: cnpjConsulta
        },
        orderBy: { dataEmissao: 'desc' },
        take: 500,
        include: this.nfseDocumentoInclude()
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

  private nfseDocumentoInclude(): Prisma.NfseDocumentoInclude {
    return {
      eventos: {
        orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
      }
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

  private normalizeSearchText(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  async findOne(id: string, clienteId: string) {
    const found = await this.prisma.nfseDocumento.findUnique({
      where: { id },
      include: this.nfseDocumentoInclude()
    });
    if (!found) {
      throw new NotFoundException('NFS-e nao encontrada');
    }
    this.assertNfseClientScope(found, clienteId);

    return found;
  }

  async getXml(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
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

  async getDanfse(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
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
    const parsedXml = this.parser.parseAny(dto.xml);

    if (parsedXml.kind === 'evento') {
      return this.importEventoXml(dto, parsedXml.evento);
    }

    return this.importNfseXml(dto, parsedXml.nfse);
  }

  private async importNfseXml(dto: ImportXmlDto, parsed: ParsedNfse) {
    const hash = this.parser.getHash(dto.xml);
    const ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    const existing = await this.prisma.nfseDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente,
          chaveAcesso: parsed.chaveAcesso
        }
      },
      include: {
        eventos: true
      }
    });
    const cancelamentoDate = this.resolveCancelamentoDate(existing);
    const hasCancelamento = this.hasCancelamento(existing);

    const date = parsed.dataEmissao ?? new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const cnpj = parsed.cnpjPrestador ?? parsed.cnpjTomador ?? 'desconhecido';
    const status = hasCancelamento ? 'cancelada' : this.normalizeStatus(parsed.status) ?? 'autorizada';

    const xmlKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/xml/${parsed.chaveAcesso}.xml`;
    await this.storage.putObject(xmlKey, dto.xml);
    const danfseKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/danfse/${parsed.chaveAcesso}.pdf`;
    const danfsePdf = this.danfse.generateFromXml(dto.xml, {
      chaveAcesso: parsed.chaveAcesso,
      numeroNfse: parsed.numeroNfse,
      dataEmissao: parsed.dataEmissao,
      status,
      cnpjPrestador: parsed.cnpjPrestador,
      razaoSocialPrestador: parsed.razaoSocialPrestador,
      cnpjTomador: parsed.cnpjTomador,
      razaoSocialTomador: parsed.razaoSocialTomador,
      valorServico: parsed.valorServico,
      descricaoServico: parsed.descricaoServico
    });
    await this.storage.putObject(danfseKey, danfsePdf);

    const competencia = parsed.competencia ?? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

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
        dataCancelamento: cancelamentoDate ?? undefined,
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
        dataCancelamento: cancelamentoDate ?? undefined,
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
      tipo: 'nfse',
      origem: nfse.origem,
      xmlPath: nfse.xmlPath,
      danfsePath: nfse.danfsePath
    };
  }

  private async upsertDocumentoForEvento(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: Ambiente;
    evento: ParsedNfseEvento;
    origem: DocumentoOrigem;
  }) {
    const cancelamentoData = this.buildCancelamentoDocumentoData(params.evento);

    return this.prisma.nfseDocumento.upsert({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: params.evento.chaveAcesso
        }
      },
      update: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        ...cancelamentoData
      },
      create: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        ambiente: params.ambiente,
        chaveAcesso: params.evento.chaveAcesso,
        ...cancelamentoData,
        origem: params.origem
      }
    });
  }

  private async findDocumentoForEvento(params: {
    clienteId: string;
    chaveAcesso: string;
    ambientePreferencial: Ambiente;
  }): Promise<NfseDocumento | null> {
    const candidates = await this.prisma.nfseDocumento.findMany({
      where: {
        clienteId: params.clienteId,
        chaveAcesso: params.chaveAcesso
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10
    });

    return this.chooseDocumentoForEvento(candidates, params.ambientePreferencial);
  }

  private chooseDocumentoForEvento(candidates: NfseDocumento[], ambientePreferencial: Ambiente): NfseDocumento | null {
    const exactWithXml = candidates.find(
      (doc) => doc.ambiente === ambientePreferencial && this.hasDocumentoFiscalData(doc)
    );
    if (exactWithXml) {
      return exactWithXml;
    }

    const anyWithXml = candidates.find((doc) => this.hasDocumentoFiscalData(doc));
    if (anyWithXml) {
      return anyWithXml;
    }

    return candidates.find((doc) => doc.ambiente === ambientePreferencial) ?? candidates[0] ?? null;
  }

  private hasDocumentoFiscalData(doc: Pick<NfseDocumento, 'xmlPath' | 'numeroNfse' | 'dataEmissao'>): boolean {
    return Boolean(doc.xmlPath || doc.numeroNfse || doc.dataEmissao);
  }

  private async upsertEvento(
    nfseDocumentoId: string,
    evento: ParsedNfseEvento,
    xmlPath: string,
    hashXml: string
  ) {
    const tipoEvento = evento.tipoEvento || 'evento';
    const dataEvento = evento.dataEvento ?? new Date(0);

    return this.prisma.nfseEvento.upsert({
      where: {
        chaveAcesso_tipoEvento_dataEvento_hashXml: {
          chaveAcesso: evento.chaveAcesso,
          tipoEvento,
          dataEvento,
          hashXml
        }
      },
      update: {
        nfseDocumentoId,
        descricao: evento.descricao,
        xmlPath
      },
      create: {
        nfseDocumentoId,
        chaveAcesso: evento.chaveAcesso,
        tipoEvento,
        dataEvento,
        descricao: evento.descricao,
        xmlPath,
        hashXml
      }
    });
  }

  private buildCancelamentoDocumentoData(
    evento: ParsedNfseEvento
  ): { status?: string; dataCancelamento?: Date; danfsePath?: string | null } {
    if (!this.isEventoCancelamento(evento)) {
      return {};
    }

    return {
      status: 'cancelada',
      dataCancelamento: evento.dataEvento ?? new Date(),
      danfsePath: null
    };
  }

  private hasCancelamento(
    doc:
      | {
          status?: string | null;
          dataCancelamento?: Date | null;
          eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
        }
      | null
      | undefined
  ): boolean {
    if (!doc) {
      return false;
    }

    return (
      this.normalizeStatus(doc.status ?? undefined) === 'cancelada' ||
      Boolean(doc.dataCancelamento) ||
      (doc.eventos ?? []).some((evento) => this.isEventoCancelamento(evento))
    );
  }

  private resolveCancelamentoDate(
    doc:
      | {
          dataCancelamento?: Date | null;
          eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
        }
      | null
      | undefined
  ): Date | undefined {
    return (
      doc?.dataCancelamento ??
      (doc?.eventos ?? []).find((evento) => this.isEventoCancelamento(evento))?.dataEvento ??
      undefined
    );
  }

  private isEventoCancelamento(evento: {
    tipoEvento?: string | null;
    descricao?: string | null;
    isCancelamento?: boolean;
  }): boolean {
    const tipoEvento = (evento.tipoEvento ?? '').trim().toLowerCase();
    const descricao = this.normalizeSearchText(evento.descricao ?? undefined);

    return (
      Boolean(evento.isCancelamento) ||
      tipoEvento === 'e101101' ||
      descricao.includes('cancelamento') ||
      descricao.includes('cancelada')
    );
  }

  private async importEventoXml(dto: ImportXmlDto, evento: ParsedNfseEvento) {
    const ambienteDto = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    const hash = this.parser.getHash(dto.xml);
    const dataReferencia = evento.dataEvento ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const existing = await this.findDocumentoForEvento({
      clienteId: dto.clienteId,
      chaveAcesso: evento.chaveAcesso,
      ambientePreferencial: ambienteDto
    });
    const ambiente = existing?.ambiente ?? ambienteDto;
    const cnpj =
      this.normalizeCnpj(evento.cnpjAutor) ??
      this.normalizeCnpj(existing?.cnpjPrestador) ??
      this.normalizeCnpj(existing?.cnpjTomador) ??
      'desconhecido';
    const xmlKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/eventos/${this.toSafeFileName(
      evento.chaveAcesso
    )}_${this.toSafeFileName(evento.tipoEvento)}.xml`;

    await this.storage.putObject(xmlKey, dto.xml);

    const nfse = await this.upsertDocumentoForEvento({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      evento,
      origem: DocumentoOrigem.importacao_xml
    });
    const eventoSalvo = await this.upsertEvento(nfse.id, evento, xmlKey, hash);

    return {
      id: nfse.id,
      chaveAcesso: nfse.chaveAcesso,
      tipo: 'evento',
      origem: nfse.origem,
      status: nfse.status,
      dataCancelamento: nfse.dataCancelamento,
      eventoId: eventoSalvo.id,
      tipoEvento: eventoSalvo.tipoEvento,
      eventoXmlPath: eventoSalvo.xmlPath,
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
      take: limit,
      include: this.nfseDocumentoInclude()
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
        const hasCancelamento = this.hasCancelamento(doc);
        const cancelamentoDate = this.resolveCancelamentoDate(doc);
        const status = hasCancelamento ? 'cancelada' : this.normalizeStatus(parsed.status) ?? doc.status;
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
            status,
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
            status,
            dataCancelamento: cancelamentoDate ?? doc.dataCancelamento,
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

  async reprocessarDanfses(dto: ReprocessarDanfsesDto) {
    const lote = dto.lote ?? 100;
    const somenteLegadas = dto.somenteLegadas ?? true;
    const limit = dto.limit;
    const where = this.buildReprocessarDanfsesWhere(dto);

    let lastId: string | undefined;
    let remaining = limit ?? Number.POSITIVE_INFINITY;
    let processados = 0;
    let regeneradas = 0;
    let ignoradas = 0;
    let falhas = 0;
    const erros: Array<{ id: string; chaveAcesso: string; erro: string }> = [];

    while (remaining > 0) {
      const take = Math.min(lote, remaining);
      const docs = await this.prisma.nfseDocumento.findMany({
        where: lastId
          ? {
              AND: [where, { id: { gt: lastId } }]
            }
          : where,
        orderBy: { id: 'asc' },
        take,
        include: this.nfseDocumentoInclude()
      });

      if (!docs.length) {
        break;
      }

      for (const doc of docs) {
        lastId = doc.id;
        processados += 1;
        remaining -= 1;

        try {
          const shouldRegenerate = await this.shouldRegenerateDanfse(doc, somenteLegadas);
          if (!shouldRegenerate) {
            ignoradas += 1;
            continue;
          }

          await this.regenerateDanfseFile(doc);
          regeneradas += 1;
        } catch (error) {
          falhas += 1;
          erros.push({
            id: doc.id,
            chaveAcesso: doc.chaveAcesso,
            erro: this.toErrorMessage(error)
          });
        }
      }

      if (docs.length < take) {
        break;
      }
    }

    return {
      filtros: {
        clienteId: dto.clienteId ?? null,
        estabelecimentoId: dto.estabelecimentoId ?? null,
        ambiente: dto.ambiente ?? null,
        somenteLegadas,
        limit: limit ?? null,
        lote
      },
      processados,
      regeneradas,
      ignoradas,
      falhas,
      erros
    };
  }

  async downloadLote(dto: DownloadLoteDto) {
    const uniqueIds = [...new Set(dto.ids)];
    const tipoArquivo = dto.tipoArquivo ?? 'ambos';

    const docs = await this.prisma.nfseDocumento.findMany({
      where: {
        id: {
          in: uniqueIds
        },
        clienteId: dto.clienteId ?? undefined
      }
    });

    if (docs.length === 0) {
      throw new NotFoundException('Nenhuma NFS-e encontrada para os IDs informados');
    }

    const docsById = new Set(docs.map((doc) => doc.id));
    const idsNaoEncontrados = uniqueIds.filter((id) => !docsById.has(id));
    const errors: Array<{ id: string; erro: string }> = [];
    const zip = new JSZip();
    let totalArquivosIncluidos = 0;

    for (const doc of docs) {
      if (tipoArquivo === 'ambos' || tipoArquivo === 'xml') {
        if (!doc.xmlPath) {
          errors.push({ id: doc.id, erro: 'XML nao disponivel para esta NFS-e' });
        } else {
          try {
            const xmlBuffer = await this.storage.getObject(doc.xmlPath);
            zip.file(`xml/NFSE-${this.toSafeFileName(doc.chaveAcesso)}.xml`, xmlBuffer);
            totalArquivosIncluidos += 1;
          } catch (error) {
            errors.push({ id: doc.id, erro: `Falha ao ler XML: ${this.toErrorMessage(error)}` });
          }
        }
      }

      if (tipoArquivo === 'ambos' || tipoArquivo === 'danfse') {
        try {
          const { pdf } = await this.ensureDanfseFile(doc);
          zip.file(`danfse/DANFSE-${this.toSafeFileName(doc.chaveAcesso)}.pdf`, pdf);
          totalArquivosIncluidos += 1;
        } catch (error) {
          errors.push({ id: doc.id, erro: `Falha ao obter DANFSE: ${this.toErrorMessage(error)}` });
        }
      }
    }

    if (totalArquivosIncluidos === 0) {
      throw new NotFoundException('Nenhum arquivo disponivel para os filtros informados');
    }

    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          geradoEm: new Date().toISOString(),
          tipoArquivo,
          totalSolicitados: uniqueIds.length,
          totalDocumentosEncontrados: docs.length,
          totalArquivosIncluidos,
          idsNaoEncontrados,
          erros: errors
        },
        null,
        2
      )
    );

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const fileName = `nfse-lote-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

    return {
      fileName,
      contentType: 'application/zip',
      contentBase64: zipBuffer.toString('base64'),
      totalSolicitados: uniqueIds.length,
      totalDocumentosEncontrados: docs.length,
      totalArquivosIncluidos,
      idsNaoEncontrados,
      erros: errors
    };
  }

  private buildReprocessarDanfsesWhere(dto: ReprocessarDanfsesDto): Prisma.NfseDocumentoWhereInput {
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

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
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

    return this.regenerateDanfseFile(doc);
  }

  private async shouldRegenerateDanfse(doc: NfseDocumento, somenteLegadas: boolean): Promise<boolean> {
    if (!somenteLegadas) {
      return true;
    }

    if (!doc.danfsePath) {
      return true;
    }

    try {
      const existingPdf = await this.storage.getObject(doc.danfsePath);
      return this.isLegacyDanfse(existingPdf);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        return true;
      }
      throw error;
    }
  }

  private async regenerateDanfseFile(doc: NfseDocumento): Promise<{ danfsePath: string; pdf: Buffer }> {
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

  private toSafeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return String(error);
  }

  private assertNfseClientScope(doc: NfseDocumento, clienteId: string): void {
    if (!clienteId) {
      throw new BadRequestException('clienteId obrigatorio para operacao de NFS-e');
    }

    if (doc.clienteId !== clienteId) {
      throw new NotFoundException('NFS-e nao encontrada');
    }
  }
}
