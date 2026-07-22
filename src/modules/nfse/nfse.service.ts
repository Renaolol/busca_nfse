import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Ambiente, DocumentoOrigem, NfseDocumento, Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import { MAX_UNPAGINATED_RESULTS } from '../../common/dto/pagination-query.dto';
import { NFSE_ADN_CLIENT, NfseAdnClient } from '../../integrations/nfse-adn/nfse-adn.types';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats.dto';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { DanfseRenderInput, NfseDanfseService } from './nfse-danfse.service';
import { ImportXmlDto } from './dto/import-xml.dto';
import { QueryNfseDto } from './dto/query-nfse.dto';
import { ReprocessarDanfsesDto } from './dto/reprocessar-danfses.dto';
import { ReprocessarXmlsDto } from './dto/reprocessar-xmls.dto';
import { SincronizarNfseEventosDto } from './dto/sincronizar-eventos.dto';
import { NfseXmlParserService, ParsedNfse, ParsedNfseEvento } from './nfse-xml-parser.service';

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);
  private readonly eventRequestIntervalMs = process.env.NODE_ENV === 'test' ? 0 : this.readPositiveNumberEnv('NFSE_EVENTOS_REQUEST_INTERVAL_MS', 5000);
  private readonly eventRateLimitRetryCount =
    process.env.NODE_ENV === 'test' ? 0 : this.readBoundedIntegerEnv('NFSE_EVENTOS_RATE_LIMIT_RETRY_COUNT', 2, 0, 5);
  private readonly eventRateLimitRetryDelayMs =
    process.env.NODE_ENV === 'test' ? 0 : this.readPositiveNumberEnv('NFSE_EVENTOS_RATE_LIMIT_RETRY_DELAY_MS', 15000);
  private lastEventRequestAtMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: NfseXmlParserService,
    private readonly storage: LocalStorageService,
    private readonly danfse: NfseDanfseService,
    @Inject(NFSE_ADN_CLIENT) private readonly adnClient: NfseAdnClient
  ) {}

  async findAll(query: QueryNfseDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    const { page, pageSize, skip } = this.resolvePagination(query);

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

    const [total, items] = await Promise.all([
      this.prisma.nfseDocumento.count({ where }),
      this.prisma.nfseDocumento.findMany({
        where,
        orderBy: { dataEmissao: 'desc' },
        skip,
        take: pageSize,
        include: this.nfseDocumentoInclude()
      })
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  async getDashboardStats(query: DashboardStatsQueryDto) {
    const where: Prisma.NfseDocumentoWhereInput = {};

    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const storedXmlWhere: Prisma.NfseDocumentoWhereInput = {
      ...where,
      xmlPath: {
        not: null
      }
    };

    const [totalNfse, storedXmls, totalByClientRows, storedByClientRows] = await Promise.all([
      this.prisma.nfseDocumento.count({ where }),
      this.prisma.nfseDocumento.count({ where: storedXmlWhere }),
      this.prisma.nfseDocumento.groupBy({
        by: ['clienteId'],
        where,
        _count: {
          _all: true
        }
      }),
      this.prisma.nfseDocumento.groupBy({
        by: ['clienteId'],
        where: storedXmlWhere,
        _count: {
          _all: true
        }
      })
    ]);

    const byClient = new Map<string, { clienteId: string; totalNfse: number; storedXmls: number }>();

    totalByClientRows.forEach((row) => {
      if (!row.clienteId) {
        return;
      }

      byClient.set(row.clienteId, {
        clienteId: row.clienteId,
        totalNfse: row._count._all,
        storedXmls: 0
      });
    });

    storedByClientRows.forEach((row) => {
      if (!row.clienteId) {
        return;
      }

      const current = byClient.get(row.clienteId) ?? {
        clienteId: row.clienteId,
        totalNfse: 0,
        storedXmls: 0
      };

      current.storedXmls = row._count._all;
      byClient.set(row.clienteId, current);
    });

    return {
      totalNfse,
      storedXmls,
      byClient: Array.from(byClient.values()).sort(
        (left, right) =>
          right.totalNfse - left.totalNfse ||
          right.storedXmls - left.storedXmls ||
          left.clienteId.localeCompare(right.clienteId)
      )
    };
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

  private buildEventoSyncWhere(dto: SincronizarNfseEventosDto): Prisma.NfseDocumentoWhereInput {
    const where: Prisma.NfseDocumentoWhereInput = {
      clienteId: dto.clienteId
    };

    if (Array.isArray(dto.documentoIds) && dto.documentoIds.length > 0) {
      where.id = {
        in: dto.documentoIds
      };
    }

    if (dto.estabelecimentoId) {
      where.estabelecimentoId = dto.estabelecimentoId;
    }

    if (dto.ambiente) {
      where.ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    }

    if (dto.chaveAcesso) {
      where.chaveAcesso = dto.chaveAcesso;
    }

    if (dto.somenteSemEventos ?? true) {
      where.eventos = {
        none: {}
      };
    }

    return where;
  }

  private buildBaseWhere(query: QueryNfseDto): Prisma.NfseDocumentoWhereInput {
    const where: Prisma.NfseDocumentoWhereInput = { AND: [] };
    const andConditions = this.getAndConditions(where);

    if (query.clienteId) {
      andConditions.push({ clienteId: query.clienteId });
    }

    const cnpjPrestador = this.normalizeCnpj(query.cnpjPrestador);
    if (cnpjPrestador) {
      andConditions.push({ cnpjPrestador });
    }

    const cnpjTomador = this.normalizeCnpj(query.cnpjTomador);
    if (cnpjTomador) {
      andConditions.push({ cnpjTomador });
    }

    const cnpj = this.normalizeCnpj(query.cnpj);
    if (cnpj) {
      andConditions.push({
        OR: [{ cnpjPrestador: cnpj }, { cnpjTomador: cnpj }]
      });
    }

    if (query.status) {
      andConditions.push({ status: query.status });
    }

    if (query.dataInicio || query.dataFim) {
      andConditions.push({
        dataEmissao: {
          gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
          lte: query.dataFim ? new Date(query.dataFim) : undefined
        }
      });
    }

    if (query.competencia) {
      const [year, month] = query.competencia.split('-').map((v) => Number(v));
      if (year && month) {
        andConditions.push({
          competencia: new Date(Date.UTC(year, month - 1, 1))
        });
      }
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      andConditions.push({
        valorServico: {
          gte: query.valorMin,
          lte: query.valorMax
        }
      });
    }

    if (query.numeroNfse) {
      andConditions.push({
        numeroNfse: {
          contains: query.numeroNfse
        }
      });
    }

    if (query.municipio) {
      andConditions.push({ municipioPrestacaoNome: query.municipio });
    }

    if (query.downloadInicio || query.downloadFim) {
      andConditions.push({
        updatedAt: {
          gte: query.downloadInicio ? new Date(query.downloadInicio) : undefined,
          lte: query.downloadFim ? new Date(query.downloadFim) : undefined
        }
      });
    }

    if (query.statusArmazenamento === 'Armazenado') {
      andConditions.push({
        xmlPath: {
          not: null
        }
      });
    } else if (query.statusArmazenamento === 'Erro') {
      andConditions.push({ xmlPath: null });
    } else if (query.statusArmazenamento === 'Pendente') {
      andConditions.push({ id: '__no-match__' });
    }

    return where;
  }

  private getAndConditions(where: Prisma.NfseDocumentoWhereInput): Prisma.NfseDocumentoWhereInput[] {
    if (Array.isArray(where.AND)) {
      return where.AND;
    }

    if (where.AND) {
      return [where.AND];
    }

    const andConditions: Prisma.NfseDocumentoWhereInput[] = [];
    where.AND = andConditions;
    return andConditions;
  }

  private resolvePagination(query: QueryNfseDto): { page: number; pageSize: number; skip: number } {
    if (query.all) {
      return { page: 1, pageSize: MAX_UNPAGINATED_RESULTS, skip: 0 };
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(200, query.pageSize ?? 100));
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize
    };
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

  private async enrichDocumentoDetails(
    doc: NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
    }
  ): Promise<
    NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
      retencaoIss?: string | null;
    }
  > {
    if (!doc.xmlPath) {
      return doc;
    }

    try {
      const xml = (await this.storage.getObject(doc.xmlPath)).toString('utf8');
      const parsed = this.parser.parse(xml);

      return {
        ...doc,
        razaoSocialPrestador: doc.razaoSocialPrestador ?? parsed.razaoSocialPrestador ?? null,
        razaoSocialTomador: doc.razaoSocialTomador ?? parsed.razaoSocialTomador ?? null,
        retencaoIss: parsed.retencaoIss ?? null
      };
    } catch (error) {
      this.logger.warn(`Falha ao enriquecer detalhes da NFS-e ${doc.id}: ${this.toErrorMessage(error)}`);
      return doc;
    }
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

    return this.enrichDocumentoDetails(found);
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

  async sincronizarEventos(dto: SincronizarNfseEventosDto) {
    const limit = dto.limit ?? 100;
    const documents = await this.findManyDocumentosForEventoSync({
      where: this.buildEventoSyncWhere(dto),
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });
    const certificateByEstablishment = new Map<string, { id: string }>();
    const detalhes: Array<{
      documentoId: string;
      chaveAcesso: string;
      estabelecimentoId: string;
      ambiente: 'producao' | 'producao_restrita';
      status: 'sincronizado' | 'sem_eventos' | 'falha_api' | 'falha_certificado';
      eventosEncontrados: number;
      eventosImportados: number;
      mensagem?: string;
    }> = [];
    let documentosComEventos = 0;
    let eventosEncontrados = 0;
    let eventosImportados = 0;
    let falhas = 0;

    for (const document of documents) {
      try {
        let certificate = certificateByEstablishment.get(document.estabelecimentoId);
        if (!certificate) {
          certificate = await this.findUsableCertificate(dto.clienteId, document.estabelecimentoId);
          certificateByEstablishment.set(document.estabelecimentoId, certificate);
        }

        const response = await this.fetchEventosByChaveWithRetry({
          chaveAcesso: document.chaveAcesso,
          ambiente: this.toExternalAmbiente(document.ambiente),
          certificateId: certificate.id
        });
        const statusCode = this.extractStatusCode(response);
        if (statusCode !== undefined && statusCode !== 200) {
          falhas += 1;
          detalhes.push({
            documentoId: document.id,
            chaveAcesso: document.chaveAcesso,
            estabelecimentoId: document.estabelecimentoId,
            ambiente: this.toDtoAmbiente(document.ambiente),
            status: 'falha_api',
            eventosEncontrados: 0,
            eventosImportados: 0,
            mensagem: this.extractSyncMessage(response) ?? `Consulta de eventos retornou HTTP ${statusCode}.`
          });
          continue;
        }

        const xmls = this.extractEventoImportXmls(response, document.chaveAcesso);
        const importedBefore = eventosImportados;
        for (const xml of xmls) {
          await this.importXml({
            clienteId: dto.clienteId,
            estabelecimentoId: document.estabelecimentoId,
            ambiente: this.toDtoAmbiente(document.ambiente),
            xml
          });
          eventosImportados += 1;
        }

        if (xmls.length > 0) {
          documentosComEventos += 1;
        }
        eventosEncontrados += xmls.length;
        detalhes.push({
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
          estabelecimentoId: document.estabelecimentoId,
          ambiente: this.toDtoAmbiente(document.ambiente),
          status: xmls.length > 0 ? 'sincronizado' : 'sem_eventos',
          eventosEncontrados: xmls.length,
          eventosImportados: eventosImportados - importedBefore,
          mensagem: xmls.length > 0 ? undefined : this.extractSyncMessage(response) ?? 'Nenhum evento encontrado no ADN'
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
          estabelecimentoId: document.estabelecimentoId,
          ambiente: this.toDtoAmbiente(document.ambiente),
          status: this.isCertificateError(error) ? 'falha_certificado' : 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      documentosAnalisados: documents.length,
      documentosComEventos,
      eventosEncontrados,
      eventosImportados,
      falhas,
      detalhes
    };
  }

  private async findManyDocumentosForEventoSync(args: Prisma.NfseDocumentoFindManyArgs) {
    try {
      return await this.prisma.nfseDocumento.findMany(args);
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn(
        'Tabela nfse_eventos indisponivel durante sincronizacao de eventos de NFS-e; repetindo consulta sem filtro relacional.'
      );
      const { where, ...rest } = args;
      return this.prisma.nfseDocumento.findMany({
        ...rest,
        where: this.removeNfseEventosRelationFilter(where)
      });
    }
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
    const municipioFallback = await this.buildDanfseMunicipioFallback({
      cnpjPrestador: parsed.cnpjPrestador,
      cnpjTomador: parsed.cnpjTomador,
      municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
      municipioPrestacaoNome: parsed.municipioPrestacaoNome
    });
    const danfsePdf = this.danfse.generateFromXml(dto.xml, {
      chaveAcesso: parsed.chaveAcesso,
      numeroNfse: parsed.numeroNfse,
      dataEmissao: parsed.dataEmissao,
      status,
      cnpjPrestador: parsed.cnpjPrestador,
      razaoSocialPrestador: parsed.razaoSocialPrestador,
      cnpjTomador: parsed.cnpjTomador,
      razaoSocialTomador: parsed.razaoSocialTomador,
      ...municipioFallback,
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
        nsu: null,
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
        nsu: null,
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
        nsu: null,
        ...cancelamentoData
      },
      create: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        ambiente: params.ambiente,
        nsu: null,
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
    const tipoEvento = this.normalizeSearchText(evento.tipoEvento ?? undefined);
    const descricao = this.normalizeSearchText(evento.descricao ?? undefined);

    return (
      Boolean(evento.isCancelamento) ||
      tipoEvento === 'e101101' ||
      tipoEvento.includes('cancelamento') ||
      tipoEvento.includes('cancelada') ||
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
          const municipioFallback = await this.buildDanfseMunicipioFallback({
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo ?? doc.municipioPrestacaoCodigo,
            municipioPrestacaoNome: parsed.municipioPrestacaoNome ?? doc.municipioPrestacaoNome
          });
          const pdf = this.danfse.generateFromXml(xml, {
            chaveAcesso: doc.chaveAcesso,
            numeroNfse: parsed.numeroNfse ?? doc.numeroNfse,
            dataEmissao: parsed.dataEmissao ?? doc.dataEmissao,
            status,
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador ?? doc.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador ?? doc.razaoSocialTomador,
            ...municipioFallback,
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
      },
      include: {
        eventos: {
          orderBy: [{ dataEvento: 'asc' }, { createdAt: 'asc' }]
        }
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

        for (const evento of doc.eventos ?? []) {
          if (!evento.xmlPath) {
            continue;
          }

          try {
            const eventoXmlBuffer = await this.storage.getObject(evento.xmlPath);
            zip.file(this.buildEventoZipEntryPath(doc.chaveAcesso, evento), eventoXmlBuffer);
            totalArquivosIncluidos += 1;
          } catch (error) {
            errors.push({
              id: doc.id,
              erro: `Falha ao ler XML do evento ${evento.tipoEvento || evento.id}: ${this.toErrorMessage(error)}`
            });
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

  private buildEventoZipEntryPath(
    chaveAcesso: string,
    evento: { id: string; tipoEvento?: string | null; dataEvento?: Date | null; xmlPath?: string | null }
  ): string {
    const tipoEvento = this.toSafeFileName((evento.tipoEvento ?? 'evento').trim() || 'evento');
    const dataEvento = evento.dataEvento ? evento.dataEvento.toISOString().replace(/[:.]/g, '-') : 'sem-data';
    const fallbackFileName = `NFSE-EVENTO-${this.toSafeFileName(chaveAcesso)}-${tipoEvento}-${dataEvento}.xml`;
    const originalFileName = evento.xmlPath?.split('/').filter(Boolean).pop();

    return `xml/eventos/${originalFileName ? this.toSafeFileName(originalFileName) : fallbackFileName}`;
  }

  private async ensureDanfseFile(
    doc: NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
      dataCancelamento?: Date | null;
      status?: string | null;
    }
  ): Promise<{ danfsePath: string; pdf: Buffer }> {
    if (this.hasCancelamento(doc)) {
      return this.regenerateDanfseFile(doc);
    }

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

    const municipioFallback = await this.buildDanfseMunicipioFallback({
      cnpjPrestador: doc.cnpjPrestador,
      cnpjTomador: doc.cnpjTomador,
      municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo,
      municipioPrestacaoNome: doc.municipioPrestacaoNome
    });
    const pdf = this.danfse.generateFromXml(xml, {
      chaveAcesso: doc.chaveAcesso,
      numeroNfse: doc.numeroNfse,
      dataEmissao: doc.dataEmissao,
      status: doc.status,
      cnpjPrestador: doc.cnpjPrestador,
      razaoSocialPrestador: doc.razaoSocialPrestador,
      cnpjTomador: doc.cnpjTomador,
      razaoSocialTomador: doc.razaoSocialTomador,
      ...municipioFallback,
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

  private async buildDanfseMunicipioFallback(params: {
    cnpjPrestador?: string | null;
    cnpjTomador?: string | null;
    municipioPrestacaoCodigo?: string | null;
    municipioPrestacaoNome?: string | null;
  }): Promise<
    Pick<
      DanfseRenderInput,
      | 'municipioPrestador'
      | 'municipioTomador'
      | 'municipioPrestacaoCodigo'
      | 'municipioPrestacaoNome'
      | 'localPrestacao'
      | 'municipioIncidenciaIssqn'
    >
  > {
    const [municipioPrestador, municipioTomador] = await Promise.all([
      this.resolveMunicipioNomeByCnpj(params.cnpjPrestador),
      this.resolveMunicipioNomeByCnpj(params.cnpjTomador)
    ]);
    const municipioPrestacaoNome = params.municipioPrestacaoNome ?? undefined;

    return {
      municipioPrestador: municipioPrestador ?? municipioPrestacaoNome,
      municipioTomador,
      municipioPrestacaoCodigo: params.municipioPrestacaoCodigo ?? undefined,
      municipioPrestacaoNome,
      localPrestacao: municipioPrestacaoNome,
      municipioIncidenciaIssqn: municipioPrestacaoNome
    };
  }

  private async resolveMunicipioNomeByCnpj(cnpj?: string | null): Promise<string | undefined> {
    const normalizedCnpj = this.normalizeCnpj(cnpj);
    if (!normalizedCnpj) {
      return undefined;
    }

    const estabelecimento = await this.prisma.clienteEstabelecimento.findFirst({
      where: {
        cnpj: normalizedCnpj,
        municipioNome: {
          not: null
        }
      },
      select: {
        municipioNome: true
      }
    });

    const municipio = estabelecimento?.municipioNome?.trim();
    return municipio || undefined;
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

  private async fetchEventosByChaveWithRetry(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<unknown> {
    let attempt = 0;

    while (true) {
      await this.waitForEventRequestSlot();
      const response = await this.adnClient.getEventosByChave(params);
      const statusCode = this.extractStatusCode(response);
      if (statusCode !== 429 || attempt >= this.eventRateLimitRetryCount) {
        return response;
      }

      attempt += 1;
      await this.delay(this.eventRateLimitRetryDelayMs);
    }
  }

  private async waitForEventRequestSlot(): Promise<void> {
    if (this.eventRequestIntervalMs <= 0) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastEventRequestAtMs;
    if (elapsed < this.eventRequestIntervalMs) {
      await this.delay(this.eventRequestIntervalMs - elapsed);
    }

    this.lastEventRequestAtMs = Date.now();
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  private readBoundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, parsed));
  }

  private toExternalAmbiente(ambiente: Ambiente): NfseAmbiente {
    return ambiente === Ambiente.producao_restrita ? NfseAmbiente.PRODUCAO_RESTRITA : NfseAmbiente.PRODUCAO;
  }

  private toDtoAmbiente(ambiente: Ambiente): 'producao' | 'producao_restrita' {
    return ambiente === Ambiente.producao_restrita ? 'producao_restrita' : 'producao';
  }

  private async findUsableCertificate(clienteId: string, estabelecimentoId: string): Promise<{ id: string }> {
    const certificate = await this.prisma.certificado.findFirst({
      where: {
        clienteId,
        estabelecimentoId,
        ativo: true
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        validadeFim: true
      }
    });

    if (!certificate) {
      throw new BadRequestException('Nenhum certificado ativo para o estabelecimento');
    }

    if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
      throw new BadRequestException('Certificado vencido');
    }

    return { id: certificate.id };
  }

  private extractStatusCode(payload: unknown): number | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const candidate = (payload as { statusCode?: unknown; status?: unknown }).statusCode ?? (payload as { status?: unknown }).status;
    return typeof candidate === 'number' ? candidate : undefined;
  }

  private extractSyncMessage(payload: unknown): string | undefined {
    const values = this.collectRecursiveValues(payload, 100);

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmed = value.trim();
      if (!trimmed || this.parser.isEventoXml(trimmed)) {
        continue;
      }

      const lower = trimmed.toLowerCase();
      if (
        lower.includes('sem evento') ||
        lower.includes('nenhum evento') ||
        lower.includes('mensagem') ||
        lower.includes('erro') ||
        lower.includes('falha')
      ) {
        return trimmed;
      }
    }

    return undefined;
  }

  private extractEventoXmls(payload: unknown): string[] {
    const values = this.collectRecursiveValues(payload, 300);
    const xmls: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmed = value.trim();
      if (!trimmed || !this.parser.isEventoXml(trimmed) || seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      xmls.push(trimmed);
    }

    return xmls;
  }

  private extractEventoImportXmls(payload: unknown, chaveAcessoFallback?: string): string[] {
    const xmls = this.extractEventoXmls(payload);
    const seen = new Set<string>();
    const signatures = new Set<string>();

    for (const xml of xmls) {
      seen.add(xml);
      signatures.add(this.buildEventoSignatureFromXml(xml));
    }

    for (const evento of this.extractStructuredEventos(payload, chaveAcessoFallback)) {
      const signature = this.buildEventoSignature(evento);
      if (signatures.has(signature)) {
        continue;
      }

      const xml = this.buildSyntheticEventoXml(evento);
      if (seen.has(xml)) {
        continue;
      }

      seen.add(xml);
      signatures.add(signature);
      xmls.push(xml);
    }

    return xmls;
  }

  private extractStructuredEventos(payload: unknown, chaveAcessoFallback?: string): ParsedNfseEvento[] {
    const values = this.collectRecursiveValues(payload, 300);
    const eventos: ParsedNfseEvento[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const evento = this.tryExtractStructuredEvento(value, chaveAcessoFallback);
      if (!evento) {
        continue;
      }

      const signature = this.buildEventoSignature(evento);
      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      eventos.push(evento);
    }

    return eventos;
  }

  private tryExtractStructuredEvento(payload: unknown, chaveAcessoFallback?: string): ParsedNfseEvento | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const nestedEventEntry = Object.entries(record).find(([key]) => /^e\d{6}$/i.test(key));
    const nestedEventRecord = this.asRecord(nestedEventEntry?.[1]);
    const explicitTipoEvento =
      nestedEventEntry?.[0] ??
      this.scalarToString(
        this.readRecordValue(record, [
          'tipoEvento',
          'tpEvento',
          'cEvento',
          'codigoEvento',
          'codigoTipoEvento',
          'eventoTipo'
        ])
      );
    const descricao =
      this.scalarToString(
        this.readRecordValue(nestedEventRecord, ['xDesc', 'descricao', 'descricaoEvento', 'descEvento'])
      ) ??
      this.scalarToString(
        this.readRecordValue(record, ['xDesc', 'descricao', 'descricaoEvento', 'descEvento', 'mensagem'])
      );
    const motivo =
      this.scalarToString(this.readRecordValue(nestedEventRecord, ['xMotivo', 'motivo', 'motivoEvento'])) ??
      this.scalarToString(this.readRecordValue(record, ['xMotivo', 'motivo', 'motivoEvento']));
    const chaveAcesso =
      this.normalizeChaveAcesso(
        this.scalarToString(this.readRecordValue(record, ['chNFSe', 'chNfse', 'chaveAcesso', 'chave', 'nfseChave']))
      ) ?? this.normalizeChaveAcesso(chaveAcessoFallback);
    const tipoEvento = this.normalizeStructuredTipoEvento(explicitTipoEvento, descricao, motivo);
    const dataEvento = this.parseUnknownDate(
      this.readRecordValue(nestedEventRecord, ['dhEvento', 'dhProc', 'dataEvento', 'dataHoraEvento']) ??
        this.readRecordValue(record, ['dhEvento', 'dhProc', 'dataEvento', 'dataHoraEvento', 'dhRegistro'])
    );
    const cnpjAutor = this.normalizeCnpj(
      this.scalarToString(this.readRecordValue(record, ['CNPJAutor', 'cnpjAutor', 'cnpjResponsavel']))
    );
    const numeroSequencial =
      this.scalarToString(this.readRecordValue(record, ['nSeqEvento', 'numSeqEvento', 'sequenciaEvento'])) ?? undefined;
    const idEvento =
      this.scalarToString(this.readRecordValue(record, ['idEvento', 'identificadorEvento', 'id'])) ?? undefined;
    const descricaoCompleta = [descricao, motivo].filter(Boolean).join(' - ') || undefined;
    const hasEventSignal = Boolean(tipoEvento || descricao || motivo || dataEvento || numeroSequencial || idEvento);

    if (!hasEventSignal || !chaveAcesso) {
      return null;
    }

    if (chaveAcessoFallback) {
      const normalizedFallback = this.normalizeChaveAcesso(chaveAcessoFallback);
      if (normalizedFallback && chaveAcesso !== normalizedFallback) {
        return null;
      }
    }

    const resolvedTipoEvento = tipoEvento ?? 'evento';

    return {
      chaveAcesso,
      tipoEvento: resolvedTipoEvento,
      dataEvento,
      descricao: descricaoCompleta,
      cnpjAutor,
      motivo,
      idEvento,
      numeroSequencial,
      isCancelamento: this.isEventoCancelamento({
        tipoEvento: resolvedTipoEvento,
        descricao: descricaoCompleta
      })
    };
  }

  private buildEventoSignatureFromXml(xml: string): string {
    try {
      return this.buildEventoSignature(this.parser.parseEvento(xml));
    } catch {
      return `xml:${xml}`;
    }
  }

  private buildEventoSignature(evento: ParsedNfseEvento): string {
    return [
      evento.chaveAcesso,
      (evento.tipoEvento || 'evento').trim().toLowerCase(),
      evento.dataEvento?.toISOString() ?? '',
      evento.numeroSequencial?.trim() ?? '',
      this.normalizeSearchText(evento.descricao ?? undefined)
    ].join('|');
  }

  private buildSyntheticEventoXml(evento: ParsedNfseEvento): string {
    const tipoEvento = this.resolveSyntheticTipoEventoTag(evento.tipoEvento);
    const descricao = this.escapeXml(evento.descricao ?? (evento.isCancelamento ? 'Cancelamento de NFS-e' : 'Evento de NFS-e'));
    const motivo = evento.motivo ? `<xMotivo>${this.escapeXml(evento.motivo)}</xMotivo>` : '';
    const dataEvento = evento.dataEvento?.toISOString() ?? new Date().toISOString();
    const numeroSequencial = evento.numeroSequencial
      ? `<nSeqEvento>${this.escapeXml(evento.numeroSequencial)}</nSeqEvento>`
      : '';
    const cnpjAutor = evento.cnpjAutor ? `<CNPJAutor>${this.escapeXml(evento.cnpjAutor)}</CNPJAutor>` : '';
    const idEvento = evento.idEvento ? ` Id="${this.escapeXml(evento.idEvento)}"` : '';
    const detalheEvento = /^e\d{6}$/i.test(tipoEvento)
      ? `<${tipoEvento}><xDesc>${descricao}</xDesc>${motivo}</${tipoEvento}>`
      : `<tpEvento>${this.escapeXml(tipoEvento)}</tpEvento><detEvento><xDesc>${descricao}</xDesc>${motivo}</detEvento>`;

    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">',
      `  <infEvento${idEvento}>`,
      `    <dhProc>${this.escapeXml(dataEvento)}</dhProc>`,
      '    <pedRegEvento versao="1.01">',
      '      <infPedReg>',
      `        <dhEvento>${this.escapeXml(dataEvento)}</dhEvento>`,
      cnpjAutor ? `        ${cnpjAutor}` : '',
      `        <chNFSe>${this.escapeXml(evento.chaveAcesso)}</chNFSe>`,
      numeroSequencial ? `        ${numeroSequencial}` : '',
      `        ${detalheEvento}`,
      '      </infPedReg>',
      '    </pedRegEvento>',
      '  </infEvento>',
      '</evento>'
    ]
      .filter(Boolean)
      .join('\n');
  }

  private resolveSyntheticTipoEventoTag(tipoEvento?: string): string {
    const normalized = this.normalizeStructuredTipoEvento(tipoEvento);
    return normalized ?? 'evento';
  }

  private normalizeStructuredTipoEvento(
    tipoEvento?: string,
    descricao?: string,
    motivo?: string
  ): string | undefined {
    const normalized = this.normalizeSearchText(tipoEvento);
    if (normalized) {
      if (/^e\d{6}$/.test(normalized)) {
        return normalized;
      }

      if (/^\d{6}$/.test(normalized)) {
        return `e${normalized}`;
      }
    }

    const descriptionText = [descricao, motivo].filter(Boolean).join(' ');
    if (this.isEventoCancelamento({ tipoEvento, descricao: descriptionText })) {
      return 'e101101';
    }

    return tipoEvento?.trim() || undefined;
  }

  private normalizeChaveAcesso(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    if (digits.length >= 50) {
      return digits.slice(0, 50);
    }

    return digits || undefined;
  }

  private parseUnknownDate(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value;
    }

    const text = this.scalarToString(value);
    if (!text) {
      return undefined;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private scalarToString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value);
    }

    return undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private readRecordValue(record: Record<string, unknown> | undefined, keys: string[]): unknown {
    if (!record) {
      return undefined;
    }

    const normalizedKeys = new Set(keys.map((key) => this.normalizeLookupKey(key)));
    for (const [key, value] of Object.entries(record)) {
      if (normalizedKeys.has(this.normalizeLookupKey(key))) {
        return value;
      }
    }

    return undefined;
  }

  private normalizeLookupKey(value: string): string {
    return this.normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private collectRecursiveValues(payload: unknown, maxItems: number): unknown[] {
    const values: unknown[] = [];
    const queue: unknown[] = [payload];
    const seen = new Set<object>();

    while (queue.length > 0 && values.length < maxItems) {
      const current = queue.shift();
      values.push(current);

      if (!current || typeof current !== 'object') {
        continue;
      }

      if (seen.has(current)) {
        continue;
      }

      seen.add(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      queue.push(...Object.values(current));
    }

    return values;
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

  private isCertificateError(error: unknown): boolean {
    return this.toErrorMessage(error).toLowerCase().includes('certificado');
  }

  private isEventosSchemaUnavailable(error: unknown): boolean {
    const message = this.toErrorMessage(error).toLowerCase();
    return (
      message.includes('nfse_eventos') &&
      (message.includes('does not exist') ||
        message.includes('relation') ||
        message.includes('table') ||
        message.includes('column') ||
        message.includes('p2021') ||
        message.includes('p2022'))
    );
  }

  private removeNfseEventosRelationFilter(
    where?: Prisma.NfseDocumentoWhereInput
  ): Prisma.NfseDocumentoWhereInput | undefined {
    if (!where) {
      return where;
    }

    const next: Prisma.NfseDocumentoWhereInput = { ...where };

    if ('eventos' in next) {
      delete next.eventos;
    }

    if (Array.isArray(next.AND)) {
      next.AND = next.AND
        .map((condition) => this.removeNfseEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfseDocumentoWhereInput => Boolean(condition));
      if (next.AND.length === 0) {
        delete next.AND;
      }
    } else if (next.AND) {
      const cleanedAnd = this.removeNfseEventosRelationFilter(next.AND);
      if (cleanedAnd) {
        next.AND = cleanedAnd;
      } else {
        delete next.AND;
      }
    }

    if (Array.isArray(next.OR)) {
      next.OR = next.OR
        .map((condition) => this.removeNfseEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfseDocumentoWhereInput => Boolean(condition));
      if (next.OR.length === 0) {
        delete next.OR;
      }
    }

    if (Array.isArray(next.NOT)) {
      next.NOT = next.NOT
        .map((condition) => this.removeNfseEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfseDocumentoWhereInput => Boolean(condition));
      if (next.NOT.length === 0) {
        delete next.NOT;
      }
    } else if (next.NOT) {
      const cleanedNot = this.removeNfseEventosRelationFilter(next.NOT);
      if (cleanedNot) {
        next.NOT = cleanedNot;
      } else {
        delete next.NOT;
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }
}
