import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Certificado, NfeAmbiente, NfeDocumentoOrigem, NfeTipoRelacao, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { MAX_UNPAGINATED_RESULTS } from '../../common/dto/pagination-query.dto';
import { CTE_CONSULTA_CLIENT, CteConsultaClient, CteConsultaDocument, CteConsultaResult } from '../../integrations/cte-consulta/cte-consulta.types';
import { NfeService } from '../nfe/nfe.service';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CteXmlParserService } from './cte-xml-parser.service';
import { DashboardCteStatsQueryDto } from './dto/dashboard-stats.dto';
import { QueryCteByChaveDto } from './dto/query-by-chave.dto';
import { SincronizarCteEventosDto } from './dto/sincronizar-eventos.dto';
import { QueryCteDto } from './dto/query-cte.dto';

@Injectable()
export class CteService {
  private readonly logger = new Logger(CteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly cteXmlParser: CteXmlParserService,
    private readonly nfeService: NfeService,
    @Inject(CTE_CONSULTA_CLIENT) private readonly cteConsultaClient: CteConsultaClient
  ) {}

  async findAll(query: QueryCteDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    const andConditions = this.getAndConditions(where);
    const { page, pageSize, skip } = this.resolvePagination(query);

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidos') {
        andConditions.push({ cnpjEmitente: cnpjConsulta });
      } else if (tipoRelacao === 'recebidos') {
        andConditions.push({ cnpjDestinatario: cnpjConsulta });
      } else {
        andConditions.push({
          OR: [{ cnpjEmitente: cnpjConsulta }, { cnpjDestinatario: cnpjConsulta }]
        });
      }
    }

    const [total, documents] = await Promise.all([
      this.prisma.nfeDocumento.count({ where }),
      this.findManyDocumentosWithEventos({
        where,
        orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize
      })
    ]);

    const items = await Promise.all(documents.map((document) => this.enrichDocument(document)));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  async getDashboardStats(query: DashboardCteStatsQueryDto) {
    const where = this.createCteWhere();
    const andConditions = this.getAndConditions(where);
    if (query.clienteId) {
      andConditions.push({ clienteId: query.clienteId });
    }

    const xmlCompletoWhere: Prisma.NfeDocumentoWhereInput = {
      ...where,
      AND: [...andConditions, { xmlCompletoDisponivel: true }]
    };

    const [totalCte, xmlsCompletos, totalByClientRows, completosByClientRows] = await Promise.all([
      this.prisma.nfeDocumento.count({ where }),
      this.prisma.nfeDocumento.count({ where: xmlCompletoWhere }),
      this.prisma.nfeDocumento.groupBy({
        by: ['clienteId'],
        where,
        _count: { _all: true }
      }),
      this.prisma.nfeDocumento.groupBy({
        by: ['clienteId'],
        where: xmlCompletoWhere,
        _count: { _all: true }
      })
    ]);

    const byClient = new Map<string, { clienteId: string; totalCte: number; xmlsCompletos: number }>();

    totalByClientRows.forEach((row) => {
      byClient.set(row.clienteId, {
        clienteId: row.clienteId,
        totalCte: row._count._all,
        xmlsCompletos: 0
      });
    });

    completosByClientRows.forEach((row) => {
      const current = byClient.get(row.clienteId) ?? {
        clienteId: row.clienteId,
        totalCte: 0,
        xmlsCompletos: 0
      };
      current.xmlsCompletos = row._count._all;
      byClient.set(row.clienteId, current);
    });

    return {
      totalCte,
      xmlsCompletos,
      byClient: Array.from(byClient.values()).sort(
        (left, right) =>
          right.totalCte - left.totalCte ||
          right.xmlsCompletos - left.xmlsCompletos ||
          left.clienteId.localeCompare(right.clienteId)
      )
    };
  }

  async findOne(id: string, clienteId: string) {
    const found = await this.findUniqueDocumentoWithEventos({
      where: { id }
    });
    if (!found || !this.isCteDocument(found)) {
      throw new NotFoundException('CT-e nao encontrado');
    }
    this.assertClientScope(found.clienteId, clienteId);
    return this.enrichDocument(found);
  }

  async getXml(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
    const key = doc.xmlCompletoPath ?? doc.xmlResumoPath;
    if (!key) {
      throw new NotFoundException('XML nao disponivel para este CT-e');
    }

    const xmlBuffer = await this.storage.getObject(key);
    const xml = xmlBuffer.toString('utf8');

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      fileName: `CTE-${doc.chaveAcesso}.xml`,
      contentType: 'application/xml',
      contentBase64: xmlBuffer.toString('base64'),
      xml
    };
  }

  async consultarChave(dto: QueryCteByChaveDto) {
    await this.ensureClient(dto.clienteId);
    const establishment = await this.getEstablishmentOrThrow(dto.estabelecimentoId, dto.clienteId);
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const certificate = await this.findActiveCertificateOrThrow(dto.clienteId, dto.estabelecimentoId, establishment.cnpj);
    const result = await this.cteConsultaClient.consultarPorChave({
      chaveAcesso: dto.chaveAcesso,
      ambiente,
      certificateId: certificate.id
    });

    return this.handleConsultaChaveResult({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      cnpjConsulta: establishment.cnpj,
      persistir: dto.persistir !== false,
      tentarEventos: dto.tentarEventos !== false,
      requestedChave: dto.chaveAcesso,
      result
    });
  }

  async sincronizarEventos(dto: SincronizarCteEventosDto) {
    const clienteId = await this.resolveClienteIdForEventoSync(dto.clienteId, dto.documentoIds);
    await this.ensureClient(clienteId);

    const limit = dto.limit ?? 50;
    const where = this.buildEventoSyncWhere({
      clienteId,
      documentoIds: dto.documentoIds,
      somenteSemEventos: dto.somenteSemEventos
    });
    const orderBy: Prisma.NfeDocumentoOrderByWithRelationInput[] = [{ dataEmissao: 'desc' }, { createdAt: 'desc' }];
    let documents: Array<
      Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })
    > = [];
    try {
      documents = await this.findManyDocumentosForEventoSync({
        where,
        include: this.documentInclude(),
        orderBy,
        take: limit
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao preparar sincronizacao manual de eventos de CT-e; retornando detalhe estruturado. ${this.toErrorMessage(error)}`
      );
      return this.buildFatalEventoSyncResponse({
        documentoIds: dto.documentoIds,
        where,
        orderBy,
        take: limit,
        error
      });
    }

    const detalhes: Array<{
      documentoId: string;
      chaveAcesso: string;
      numeroDocumento?: string | null;
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
      const numeroDocumento = document.numeroNfe ?? null;

      try {
        const establishment = await this.getEstablishmentOrThrow(document.estabelecimentoId, document.clienteId);
        const certificate = await this.findActiveCertificateOrThrow(document.clienteId, document.estabelecimentoId, establishment.cnpj);
        const result = await this.cteConsultaClient.consultarPorChave({
          chaveAcesso: document.chaveAcesso,
          ambiente: document.ambiente,
          certificateId: certificate.id
        });

        if (result.statusCode !== 200) {
          falhas += 1;
          detalhes.push({
            documentoId: document.id,
            chaveAcesso: document.chaveAcesso,
            numeroDocumento,
            status: 'falha_api',
            eventosEncontrados: 0,
            eventosImportados: 0,
            mensagem: result.xMotivo ?? `Consulta de eventos retornou HTTP ${result.statusCode}.`
          });
          continue;
        }

        const eventDocuments = this.extractEventDocuments(result.documents);
        const importedBefore = eventosImportados;

        for (const eventDocument of eventDocuments) {
          await this.nfeService.persistEventDocumentFromExternalSource({
            clienteId: document.clienteId,
            estabelecimentoId: document.estabelecimentoId,
            ambiente: document.ambiente,
            cnpjConsulta: establishment.cnpj,
            document: {
              schema: eventDocument.schema,
              xml: eventDocument.xml,
              chaveAcesso: eventDocument.chaveAcesso
            },
            origem: document.origem ?? NfeDocumentoOrigem.distribuicao_nsu
          });
          eventosImportados += 1;
        }

        if (eventDocuments.length > 0) {
          documentosComEventos += 1;
        }
        eventosEncontrados += eventDocuments.length;
        detalhes.push({
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
          numeroDocumento,
          status: eventDocuments.length > 0 ? 'sincronizado' : 'sem_eventos',
          eventosEncontrados: eventDocuments.length,
          eventosImportados: eventosImportados - importedBefore,
          mensagem: result.xMotivo
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
          numeroDocumento,
          status: this.isCertificateSelectionError(error) ? 'falha_certificado' : 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: error instanceof Error ? error.message : 'Erro inesperado'
        });
      }
    }

    return {
      documentosProcessados: documents.length,
      documentosComEventos,
      eventosEncontrados,
      eventosImportados,
      falhas,
      detalhes
    };
  }

  private async buildFatalEventoSyncResponse(params: {
    documentoIds?: string[];
    where: Prisma.NfeDocumentoWhereInput;
    orderBy: Prisma.NfeDocumentoOrderByWithRelationInput[];
    take: number;
    error: unknown;
  }) {
    const message = this.toErrorMessage(params.error);
    const fallbackDocuments = await this.findFallbackDocumentsForEventoSync({
      where: params.where,
      orderBy: params.orderBy,
      take: params.take
    }).catch(() => []);
    const requestedIds = [...new Set((params.documentoIds ?? []).filter(Boolean))];
    const detailsSource =
      fallbackDocuments.length > 0
        ? fallbackDocuments
        : requestedIds.map((id) => ({
            id,
            chaveAcesso: '',
            numeroNfe: null
          }));
    const falhas = detailsSource.length || 1;

    return {
      documentosProcessados: detailsSource.length,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas,
      detalhes: detailsSource.map((document) => ({
        documentoId: document.id,
        chaveAcesso: document.chaveAcesso || '',
        numeroDocumento: document.numeroNfe ?? null,
        status: 'falha_api' as const,
        eventosEncontrados: 0,
        eventosImportados: 0,
        mensagem: message
      }))
    };
  }

  private buildBaseWhere(query: QueryCteDto): Prisma.NfeDocumentoWhereInput {
    const where = this.createCteWhere();
    const andConditions = this.getAndConditions(where);

    if (query.clienteId) {
      andConditions.push({ clienteId: query.clienteId });
    }

    const cnpjEmitente = this.normalizeCnpj(query.cnpjEmitente);
    if (cnpjEmitente) {
      andConditions.push({ cnpjEmitente });
    }

    const cnpjDestinatario = this.normalizeCnpj(query.cnpjDestinatario);
    if (cnpjDestinatario) {
      andConditions.push({ cnpjDestinatario });
    }

    const cnpj = this.normalizeCnpj(query.cnpj);
    if (cnpj) {
      andConditions.push({
        OR: [{ cnpjEmitente: cnpj }, { cnpjDestinatario: cnpj }]
      });
    }

    if (query.status) {
      andConditions.push({ status: query.status });
    }

    if (query.schemaDoc) {
      andConditions.push({ schemaDoc: query.schemaDoc });
    }

    if (query.numeroCte) {
      andConditions.push({
        numeroNfe: {
          contains: query.numeroCte
        }
      });
    }

    if (query.chaveAcesso) {
      andConditions.push({
        chaveAcesso: {
          contains: query.chaveAcesso
        }
      });
    }

    if (query.ambiente) {
      andConditions.push({ ambiente: query.ambiente });
    }

    if (query.dataInicio || query.dataFim) {
      andConditions.push({
        dataEmissao: {
          gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
          lte: query.dataFim ? new Date(query.dataFim) : undefined
        }
      });
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      andConditions.push({
        valorTotal: {
          gte: query.valorMin,
          lte: query.valorMax
        }
      });
    }

    if (query.somenteXmlCompleto) {
      andConditions.push({ xmlCompletoDisponivel: true });
    }

    if (query.somenteResumos) {
      andConditions.push({ xmlCompletoDisponivel: false });
    }

    return where;
  }

  private buildEventoSyncWhere(params: {
    clienteId: string;
    documentoIds?: string[];
    somenteSemEventos?: boolean;
  }): Prisma.NfeDocumentoWhereInput {
    const where = this.createCteWhere();
    const andConditions = this.getAndConditions(where);
    andConditions.push({ clienteId: params.clienteId });

    if (params.documentoIds?.length) {
      andConditions.push({ id: { in: params.documentoIds } });
    }

    if (params.somenteSemEventos !== false) {
      andConditions.push({ eventos: { none: {} } });
    }

    return where;
  }

  private createCteWhere(): Prisma.NfeDocumentoWhereInput {
    return {
      AND: [
        {
          OR: [
            { modelo: '57' },
            { schemaDoc: { startsWith: 'CTe' } },
            { schemaDoc: { startsWith: 'cteProc' } },
            { schemaDoc: { startsWith: 'resCTe' } },
            { schemaDoc: { startsWith: 'eventoCTe' } },
            { schemaDoc: { startsWith: 'procEventoCTe' } }
          ]
        }
      ]
    };
  }

  private getAndConditions(where: Prisma.NfeDocumentoWhereInput): Prisma.NfeDocumentoWhereInput[] {
    if (Array.isArray(where.AND)) {
      return where.AND;
    }

    if (where.AND) {
      return [where.AND];
    }

    const andConditions: Prisma.NfeDocumentoWhereInput[] = [];
    where.AND = andConditions;
    return andConditions;
  }

  private isCteDocument(doc: Pick<Prisma.NfeDocumentoUncheckedCreateInput, 'modelo' | 'schemaDoc'>): boolean {
    return doc.modelo === '57' || ['CTe', 'cteProc', 'resCTe', 'eventoCTe', 'procEventoCTe'].some((prefix) => String(doc.schemaDoc || '').startsWith(prefix));
  }

  private documentInclude(): Prisma.NfeDocumentoInclude {
    return {
      eventos: {
        orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
      }
    };
  }

  private async persistDocument(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    document: CteConsultaDocument;
    origem: NfeDocumentoOrigem;
  }) {
    const parsed = this.cteXmlParser.parse(params.document.xml);
    const chaveAcesso = parsed.chaveAcesso ?? this.normalizeChaveAcesso(params.document.chaveAcesso);
    if (!chaveAcesso) {
      throw new BadRequestException('Nao foi possivel localizar chave de acesso no retorno da consulta de CT-e');
    }

    const existing = await this.prisma.nfeDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso
        }
      }
    });

    const cnpjConsulta = this.normalizeCnpj(params.cnpjConsulta);
    const tipoRelacao =
      parsed.cnpjEmitente && cnpjConsulta && parsed.cnpjEmitente === cnpjConsulta
        ? NfeTipoRelacao.emitida
        : parsed.cnpjDestinatario && cnpjConsulta && parsed.cnpjDestinatario === cnpjConsulta
          ? NfeTipoRelacao.recebida
          : existing?.tipoRelacao ?? null;

    const dataReferencia = parsed.dataEmissao ?? parsed.dataAutorizacao ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const cnpjPasta = parsed.cnpjEmitente ?? parsed.cnpjDestinatario ?? cnpjConsulta ?? 'sem-cnpj';
    const storagePrefix = `nfe/${params.ambiente}/${cnpjPasta}/${year}/${month}`;
    const isFull = ['CTe_v4.00', 'cteProc_v4.00'].includes(parsed.schemaDoc ?? params.document.schema);
    const storageKey = `${storagePrefix}/${isFull ? 'xml' : 'resumos'}/${chaveAcesso}.xml`;
    await this.storage.putObject(storageKey, params.document.xml);
    const hash = createHash('sha256').update(params.document.xml, 'utf8').digest('hex');

    const updateData: Prisma.NfeDocumentoUncheckedUpdateInput = {
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      numeroNfe: parsed.numeroCte ?? existing?.numeroNfe,
      serie: parsed.serie ?? existing?.serie,
      modelo: parsed.modelo ?? existing?.modelo ?? '57',
      dataEmissao: parsed.dataEmissao ?? existing?.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao ?? existing?.dataAutorizacao,
      status: parsed.status ?? existing?.status,
      tipoRelacao,
      schemaDoc: parsed.schemaDoc ?? params.document.schema,
      cnpjEmitente: parsed.cnpjEmitente ?? existing?.cnpjEmitente,
      razaoSocialEmitente: parsed.razaoSocialEmitente ?? existing?.razaoSocialEmitente,
      cnpjDestinatario: parsed.cnpjDestinatario ?? existing?.cnpjDestinatario,
      razaoSocialDestinatario: parsed.razaoSocialDestinatario ?? existing?.razaoSocialDestinatario,
      valorTotal: parsed.valorTotal ? new Prisma.Decimal(parsed.valorTotal) : existing?.valorTotal,
      origem: params.origem,
      updatedAt: new Date(),
      ...(isFull
        ? {
            xmlCompletoDisponivel: true,
            xmlCompletoPath: storageKey,
            hashXmlCompleto: hash
          }
        : {
            resumoDisponivel: true,
            xmlResumoPath: storageKey,
            hashResumo: hash
          })
    };

    const createData: Prisma.NfeDocumentoUncheckedCreateInput = {
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      ambiente: params.ambiente,
      chaveAcesso,
      numeroNfe: parsed.numeroCte,
      serie: parsed.serie,
      modelo: parsed.modelo ?? '57',
      dataEmissao: parsed.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao,
      status: parsed.status,
      tipoRelacao,
      schemaDoc: parsed.schemaDoc ?? params.document.schema,
      resumoDisponivel: !isFull,
      xmlCompletoDisponivel: isFull,
      cnpjEmitente: parsed.cnpjEmitente,
      razaoSocialEmitente: parsed.razaoSocialEmitente,
      cnpjDestinatario: parsed.cnpjDestinatario,
      razaoSocialDestinatario: parsed.razaoSocialDestinatario,
      valorTotal: parsed.valorTotal ? new Prisma.Decimal(parsed.valorTotal) : undefined,
      xmlResumoPath: isFull ? undefined : storageKey,
      xmlCompletoPath: isFull ? storageKey : undefined,
      hashResumo: isFull ? undefined : hash,
      hashXmlCompleto: isFull ? hash : undefined,
      origem: params.origem
    };

    return this.prisma.nfeDocumento.upsert({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso
        }
      },
      update: updateData,
      create: createData
    });
  }

  private async findManyDocumentosWithEventos(
    args: Omit<Prisma.NfeDocumentoFindManyArgs, 'include'>
  ): Promise<Array<Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })>> {
    try {
      return await this.prisma.nfeDocumento.findMany({
        ...args,
        include: this.documentInclude()
      });
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn('Tabela nfe_eventos indisponivel; retornando CT-e sem eventos vinculados. Aplique a migration pendente.');
      const documentos = await this.prisma.nfeDocumento.findMany(args);
      return documentos.map((documento) => ({
        ...documento,
        eventos: []
      }));
    }
  }

  private async findManyDocumentosForEventoSync(
    args: Prisma.NfeDocumentoFindManyArgs
  ): Promise<Array<Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })>> {
    try {
      return (await this.prisma.nfeDocumento.findMany(args)) as Array<
        Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })
      >;
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn(
        'Tabela nfe_eventos indisponivel durante sincronizacao de eventos de CT-e; repetindo consulta sem filtro relacional.'
      );
      const { where, ...rest } = args;
      delete rest.include;
      const documentos = await this.prisma.nfeDocumento.findMany({
        ...rest,
        where: this.removeEventosRelationFilter(where)
      });
      return documentos.map((documento) => ({
        ...documento,
        eventos: []
      }));
    }
  }

  private async findFallbackDocumentsForEventoSync(args: {
    where: Prisma.NfeDocumentoWhereInput;
    orderBy: Prisma.NfeDocumentoOrderByWithRelationInput[];
    take: number;
  }): Promise<Array<{ id: string; chaveAcesso: string; numeroNfe: string | null }>> {
    return this.prisma.nfeDocumento.findMany({
      where: this.removeEventosRelationFilter(args.where),
      orderBy: args.orderBy,
      take: args.take,
      select: {
        id: true,
        chaveAcesso: true,
        numeroNfe: true
      }
    });
  }

  private async findUniqueDocumentoWithEventos(
    args: Omit<Prisma.NfeDocumentoFindUniqueArgs, 'include'>
  ): Promise<(Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })) | null> {
    try {
      return await this.prisma.nfeDocumento.findUnique({
        ...args,
        include: this.documentInclude()
      });
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn('Tabela nfe_eventos indisponivel; retornando detalhe de CT-e sem eventos vinculados. Aplique a migration pendente.');
      const documento = await this.prisma.nfeDocumento.findUnique(args);
      return documento ? { ...documento, eventos: [] } : null;
    }
  }

  private async enrichDocument<T extends {
    chaveAcesso: string;
    numeroNfe?: string | null;
    serie?: string | null;
    modelo?: string | null;
    dataEmissao?: Date | null;
    dataAutorizacao?: Date | null;
    valorTotal?: Prisma.Decimal | null;
    schemaDoc?: string | null;
    xmlCompletoPath?: string | null;
    xmlResumoPath?: string | null;
  }>(document: T): Promise<T> {
    if (!this.needsXmlEnrichment(document)) {
      return document;
    }

    const storageKey = document.xmlCompletoPath ?? document.xmlResumoPath;
    if (!storageKey) {
      return document;
    }

    try {
      const xml = (await this.storage.getObject(storageKey)).toString('utf8');
      const parsed = this.cteXmlParser.parse(xml);

      return {
        ...document,
        numeroNfe: document.numeroNfe ?? parsed.numeroCte ?? null,
        serie: document.serie ?? parsed.serie ?? null,
        modelo: document.modelo ?? parsed.modelo ?? null,
        dataEmissao: document.dataEmissao ?? parsed.dataEmissao ?? null,
        dataAutorizacao: document.dataAutorizacao ?? parsed.dataAutorizacao ?? null,
        valorTotal: document.valorTotal ?? (parsed.valorTotal as unknown as Prisma.Decimal | null) ?? null,
        schemaDoc: document.schemaDoc ?? parsed.schemaDoc ?? null
      };
    } catch {
      return document;
    }
  }

  private needsXmlEnrichment(document: {
    numeroNfe?: string | null;
    valorTotal?: Prisma.Decimal | null;
    schemaDoc?: string | null;
  }): boolean {
    return !document.numeroNfe || document.valorTotal == null || !document.schemaDoc;
  }

  private assertClientScope(ownerClientId: string, requestedClientId: string) {
    if (ownerClientId !== requestedClientId) {
      throw new NotFoundException('CT-e nao encontrado');
    }
  }

  private normalizeCnpj(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private normalizeChaveAcesso(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits.length === 44 ? digits : undefined;
  }

  private removeEventosRelationFilter(
    where?: Prisma.NfeDocumentoWhereInput
  ): Prisma.NfeDocumentoWhereInput | undefined {
    if (!where) {
      return where;
    }

    const next: Prisma.NfeDocumentoWhereInput = { ...where };

    if ('eventos' in next) {
      delete next.eventos;
    }

    if (Array.isArray(next.AND)) {
      next.AND = next.AND
        .map((condition) => this.removeEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfeDocumentoWhereInput => Boolean(condition));
      if (next.AND.length === 0) {
        delete next.AND;
      }
    } else if (next.AND) {
      const cleanedAnd = this.removeEventosRelationFilter(next.AND);
      if (cleanedAnd) {
        next.AND = cleanedAnd;
      } else {
        delete next.AND;
      }
    }

    if (Array.isArray(next.OR)) {
      next.OR = next.OR
        .map((condition) => this.removeEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfeDocumentoWhereInput => Boolean(condition));
      if (next.OR.length === 0) {
        delete next.OR;
      }
    }

    if (Array.isArray(next.NOT)) {
      next.NOT = next.NOT
        .map((condition) => this.removeEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfeDocumentoWhereInput => Boolean(condition));
      if (next.NOT.length === 0) {
        delete next.NOT;
      }
    } else if (next.NOT) {
      const cleanedNot = this.removeEventosRelationFilter(next.NOT);
      if (cleanedNot) {
        next.NOT = cleanedNot;
      } else {
        delete next.NOT;
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  private isEventDocument(document: CteConsultaDocument): boolean {
    return ['eventoCTe', 'procEventoCTe'].some((prefix) => document.schema.startsWith(prefix)) || /<(?:\w+:)?(?:procEventoCTe|eventoCTe)\b/i.test(document.xml);
  }

  private extractEventDocuments(documents: CteConsultaDocument[]): CteConsultaDocument[] {
    const seen = new Set<string>();
    const filtered: CteConsultaDocument[] = [];

    for (const document of documents) {
      if (!this.isEventDocument(document)) {
        continue;
      }

      const signature = `${document.schema}|${createHash('sha256').update(document.xml, 'utf8').digest('hex')}`;
      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      filtered.push(document);
    }

    return filtered;
  }

  private async handleConsultaChaveResult(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta: string;
    persistir: boolean;
    tentarEventos: boolean;
    requestedChave: string;
    result: CteConsultaResult;
  }) {
    let documentosPersistidos = 0;
    let eventosPersistidos = 0;
    const documentos = params.result.documents.map((document) => ({
      schema: document.schema,
      chaveAcesso: document.chaveAcesso
    }));

    if (params.persistir) {
      for (const document of params.result.documents) {
        if (this.isEventDocument(document)) {
          if (!params.tentarEventos) {
            continue;
          }
          await this.nfeService.persistEventDocumentFromExternalSource({
            clienteId: params.clienteId,
            estabelecimentoId: params.estabelecimentoId,
            ambiente: params.ambiente,
            cnpjConsulta: params.cnpjConsulta,
            document: {
              schema: document.schema,
              xml: document.xml,
              chaveAcesso: document.chaveAcesso
            },
            origem: NfeDocumentoOrigem.distribuicao_nsu
          });
          eventosPersistidos += 1;
          continue;
        }

        await this.persistDocument({
          clienteId: params.clienteId,
          estabelecimentoId: params.estabelecimentoId,
          ambiente: params.ambiente,
          cnpjConsulta: params.cnpjConsulta,
          document,
          origem: NfeDocumentoOrigem.distribuicao_nsu
        });
        documentosPersistidos += 1;
      }
    }

    return {
      statusCode: params.result.statusCode,
      cStat: params.result.cStat,
      xMotivo: params.result.xMotivo,
      requestedChave: params.requestedChave,
      persistido: params.persistir,
      documentosEncontrados: params.result.documents.filter((document) => !this.isEventDocument(document)).length,
      documentosPersistidos,
      eventosEncontrados: this.extractEventDocuments(params.result.documents).length,
      eventosPersistidos,
      documentos
    };
  }

  private async ensureClient(clienteId: string): Promise<void> {
    const normalizedClientId = this.normalizeScopeId(clienteId);
    if (!normalizedClientId) {
      throw new BadRequestException('clienteId obrigatorio para esta operacao');
    }

    const found = await this.prisma.cliente.findUnique({ where: { id: normalizedClientId } });
    if (!found) {
      throw new NotFoundException('Cliente nao encontrado');
    }
  }

  private async resolveClienteIdForEventoSync(clienteId?: string, documentoIds?: string[]): Promise<string> {
    const normalizedClientId = this.normalizeScopeId(clienteId);
    if (normalizedClientId) {
      return normalizedClientId;
    }

    const ids = [...new Set((documentoIds ?? []).filter(Boolean))];
    if (!ids.length) {
      throw new BadRequestException('clienteId obrigatorio para sincronizacao de eventos');
    }

    const documents = await this.prisma.nfeDocumento.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        clienteId: true
      }
    });
    const clientIds = [...new Set(documents.map((document) => this.normalizeScopeId(document.clienteId)).filter(Boolean))];

    if (clientIds.length === 1) {
      return clientIds[0] as string;
    }

    if (clientIds.length > 1) {
      throw new BadRequestException('Os documentoIds informados pertencem a mais de um cliente; informe clienteId explicitamente');
    }

    throw new BadRequestException('Nao foi possivel determinar o cliente a partir dos documentoIds informados');
  }

  private async getEstablishmentOrThrow(estabelecimentoId: string, clienteId: string) {
    const found = await this.prisma.clienteEstabelecimento.findUnique({
      where: { id: estabelecimentoId }
    });
    if (!found || found.clienteId !== clienteId || !found.ativo) {
      throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
    }
    return found;
  }

  private async findActiveCertificateOrThrow(
    clienteId: string,
    estabelecimentoId: string,
    cnpjConsulta: string
  ): Promise<Pick<Certificado, 'id'>> {
    const now = new Date();
    const certificates = await this.prisma.certificado.findMany({
      where: {
        ativo: true,
        AND: [
          {
            OR: [
              {
                clienteId,
                estabelecimentoId
              },
              {
                clienteId,
                estabelecimentoId: null,
                cnpjTitular: cnpjConsulta
              }
            ]
          },
          {
            OR: [{ validadeFim: null }, { validadeFim: { gt: now } }]
          }
        ]
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        nome: true,
        estabelecimentoId: true,
        arquivoCriptografadoPath: true
      }
    });

    const certificate =
      certificates.find((item) => item.estabelecimentoId === estabelecimentoId) ??
      certificates.find((item) => item.estabelecimentoId === null);

    if (!certificate) {
      throw new BadRequestException(`Nenhum certificado ativo e valido encontrado para o CNPJ ${cnpjConsulta}`);
    }

    const certificateFileExists = await this.storage.hasObject(certificate.arquivoCriptografadoPath);
    if (!certificateFileExists) {
      throw new BadRequestException(
        `Arquivo do certificado selecionado (${certificate.nome || certificate.id}) nao encontrado no storage local para o CNPJ ${cnpjConsulta}. Caminho esperado: ${certificate.arquivoCriptografadoPath}. Recadastre ou restaure esse certificado.`
      );
    }

    return { id: certificate.id };
  }

  private isCertificateSelectionError(error: unknown): boolean {
    const message = error instanceof Error && error.message ? error.message.toLowerCase() : '';
    return message.includes('certificado') || message.includes('cnpj');
  }

  private isEventosSchemaUnavailable(error: unknown): boolean {
    const message = this.toErrorMessage(error).toLowerCase();
    const mentionsEventosTable = ['nfe_eventos', 'nfeevento', 'nfe_evento', 'nfe evento'].some((fragment) => message.includes(fragment));
    return (
      mentionsEventosTable &&
      (message.includes('does not exist') ||
        message.includes('relation') ||
        message.includes('table') ||
        message.includes('column') ||
        message.includes('p2021') ||
        message.includes('p2022'))
    );
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'erro inesperado';
  }

  private normalizeScopeId(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }

  private resolvePagination(query: QueryCteDto): { page: number; pageSize: number; skip: number } {
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
}
