import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Certificado,
  NfeAmbiente,
  NfeDocumentoOrigem,
  NfeSyncStatus,
  NfeTipoRelacao,
  Prisma
} from '@prisma/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MAX_UNPAGINATED_RESULTS } from '../../common/dto/pagination-query.dto';
import {
  DOMINIO_NFE_XML_SOURCE,
  DominioNfeCatalogRecord,
  DominioNfeXmlSource
} from '../../integrations/dominio-nfe/dominio-nfe.types';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NfseService } from '../nfse/nfse.service';
import { CteService } from '../cte/cte.service';
import {
  NFE_DISTRIBUICAO_CLIENT,
  NfeDistribuicaoClient,
  NfeDistribuicaoDocument,
  NfeDistribuicaoResult
} from '../../integrations/nfe-distribuicao/nfe-distribuicao.types';
import { DashboardNfeStatsQueryDto } from './dto/dashboard-stats.dto';
import { GetDominioNfeXmlDto } from './dto/dominio-xml.dto';
import { ImportNfeFromDominioDto } from './dto/import-dominio.dto';
import { EnableAllNfeSyncDto } from './dto/enable-all-sync.dto';
import { EnableNfeSyncDto } from './dto/enable-sync.dto';
import { ImportNfeXmlDto } from './dto/import-xml.dto';
import { PauseNfeSyncDto } from './dto/pause-sync.dto';
import { QueryNfeByChaveDto } from './dto/query-by-chave.dto';
import { QueryNfeByNsuDto } from './dto/query-by-nsu.dto';
import { QueryNfeDto } from './dto/query-nfe.dto';
import { RunNfeSyncDto } from './dto/run-sync.dto';
import { SincronizarNfeEventosDto } from './dto/sincronizar-eventos.dto';
import { StartNfeSyncDto } from './dto/start-sync.dto';
import { UpdateNfeSchedulerSettingsDto } from './dto/update-scheduler-settings.dto';
import { NfeXmlParserService, ParsedDfeEvento, ParsedNfe } from './nfe-xml-parser.service';

type NfeNightlySweepConfigFile = {
  enabled?: boolean;
  activeSlots?: string[];
};

type NfeNightlySweepSlot = {
  time: string;
  hour: number;
  minute: number;
};

type NfeSyncSourceMode = 'distribuicao' | 'dominio' | 'dominio_chave';

type NfeSyncRunFailureDetail = {
  kind: 'documento' | 'controle';
  status:
    | 'persistido'
    | 'ignorado_sem_vinculo'
    | 'ignorado_xml_nao_fiscal'
    | 'ignorado_xml_cte'
    | 'ignorado_ja_completo'
    | 'ignorado_chave_invalida'
    | 'ignorado_chave_cte'
    | 'falha';
  clientId: string;
  estabelecimentoId: string;
  ambiente: NfeAmbiente;
  cnpjConsulta: string;
  catalogoId?: number;
  chaveAcesso?: string;
  numeroNfe?: string;
  serie?: string;
  modelo?: string;
  mensagem: string;
};

type NfeSyncRunResult = {
  processed: number;
  documentsSaved: number;
  failures: number;
  executionDetails: NfeSyncRunFailureDetail[];
  failureDetails: NfeSyncRunFailureDetail[];
};

type NfeDownloadByKeyPreviewRow = {
  kind: 'documento' | 'controle';
  clientId: string;
  estabelecimentoId: string;
  ambiente: NfeAmbiente;
  cnpjConsulta: string;
  catalogoId?: number;
  chaveAcesso?: string;
  modelo?: string;
  mensagem: string;
};

type NfeDownloadByKeyPreviewResult = {
  processed: number;
  pendingDownloads: number;
  failures: number;
  rows: NfeDownloadByKeyPreviewRow[];
};

@Injectable()
export class NfeService implements OnModuleInit, OnModuleDestroy {
  private static readonly NIGHTLY_SWEEP_AVAILABLE_SLOTS = ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];
  private static readonly NIGHTLY_SWEEP_CONFIG_STORAGE_KEY = 'settings/nfe-nightly-sweep.json';
  private static readonly DOMINIO_CHAVE_DATA_EMISSAO_INICIO = '2026-01-02';
  private readonly logger = new Logger(NfeService.name);
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private nightlySweepTimer: NodeJS.Timeout | null = null;
  private autoSyncRunning = false;
  private nightlySweepRunning = false;
  private lastNightlySweepExecutionKey: string | null = null;
  private readonly executedNightlySweepKeys = new Set<string>();
  private readonly autoSyncEnabled = process.env.NFE_SYNC_AUTO_RUN_ENABLED !== 'false';
  private readonly autoSyncIntervalMs = this.parsePositiveNumberEnv('NFE_SYNC_AUTO_RUN_INTERVAL_MS', 5 * 60 * 1000);
  private readonly autoSyncStartupDelayMs = this.parsePositiveNumberEnv('NFE_SYNC_AUTO_RUN_STARTUP_DELAY_MS', 15000);
  private nightlySweepEnabled = process.env.NFE_SYNC_NIGHTLY_SWEEP_ENABLED !== 'false';
  private readonly nightlySweepCheckIntervalMs = this.parsePositiveNumberEnv('NFE_SYNC_NIGHTLY_SWEEP_CHECK_INTERVAL_MS', 60000);
  private readonly nightlySweepHour = this.parseBoundedIntegerEnv('NFE_SYNC_NIGHTLY_SWEEP_HOUR', 2, 0, 23);
  private readonly nightlySweepMinute = this.parseBoundedIntegerEnv('NFE_SYNC_NIGHTLY_SWEEP_MINUTE', 0, 0, 59);
  private nightlySweepActiveSlots = this.resolveInitialNightlySweepSlots();
  private readonly nightlySweepTimezoneOffsetMinutes = this.parseBoundedIntegerEnv(
    'NFE_SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES',
    -180,
    -720,
    840
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: NfeXmlParserService,
    private readonly nfseService: NfseService,
    private readonly storage: LocalStorageService,
    @Inject(forwardRef(() => CteService)) private readonly cteService: CteService,
    @Inject(NFE_DISTRIBUICAO_CLIENT) private readonly distribuicaoClient: NfeDistribuicaoClient,
    @Inject(DOMINIO_NFE_XML_SOURCE) private readonly dominioXmlSource: DominioNfeXmlSource
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadNightlySweepConfig();

    if (this.autoSyncEnabled) {
      this.autoSyncTimer = setInterval(() => {
        void this.runAutomaticSyncCycle();
      }, this.autoSyncIntervalMs);
      this.autoSyncTimer.unref?.();

      const autoSyncStartupTimer = setTimeout(() => {
        void this.runAutomaticSyncCycle();
      }, this.autoSyncStartupDelayMs);
      autoSyncStartupTimer.unref?.();

      this.logger.log(`Execucao automatica de NF-e habilitada a cada ${this.autoSyncIntervalMs}ms`);
    } else {
      this.logger.log('Execucao automatica de NF-e desativada (NFE_SYNC_AUTO_RUN_ENABLED=false)');
    }

    this.refreshNightlySweepTimer();
  }

  onModuleDestroy(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    if (this.nightlySweepTimer) {
      clearInterval(this.nightlySweepTimer);
      this.nightlySweepTimer = null;
    }
  }

  schedulerStatus(): {
    sourceMode: NfeSyncSourceMode;
    autoSync: {
      enabled: boolean;
      running: boolean;
      intervalMs: number;
      startupDelayMs: number;
    };
    nightlySweep: {
      enabled: boolean;
      running: boolean;
      hour: number;
      minute: number;
      activeSlots: string[];
      availableSlots: string[];
      timezoneOffsetMinutes: number;
      checkIntervalMs: number;
      lastRunExecutionKey: string | null;
      nextRunAt: string | null;
    };
  } {
    return {
      sourceMode: this.getSyncSourceMode(),
      autoSync: {
        enabled: this.autoSyncEnabled,
        running: this.autoSyncRunning,
        intervalMs: this.autoSyncIntervalMs,
        startupDelayMs: this.autoSyncStartupDelayMs
      },
      nightlySweep: {
        enabled: this.nightlySweepEnabled,
        running: this.nightlySweepRunning,
        hour: this.getReferenceNightlySweepSlot().hour,
        minute: this.getReferenceNightlySweepSlot().minute,
        activeSlots: [...this.nightlySweepActiveSlots],
        availableSlots: [...NfeService.NIGHTLY_SWEEP_AVAILABLE_SLOTS],
        timezoneOffsetMinutes: this.nightlySweepTimezoneOffsetMinutes,
        checkIntervalMs: this.nightlySweepCheckIntervalMs,
        lastRunExecutionKey: this.lastNightlySweepExecutionKey,
        nextRunAt: this.nightlySweepEnabled ? this.resolveNextNightlySweepAt(new Date())?.toISOString() ?? null : null
      }
    };
  }

  async updateSchedulerSettings(params: UpdateNfeSchedulerSettingsDto) {
    if (typeof params.enabled === 'boolean') {
      this.nightlySweepEnabled = params.enabled;
    }

    if (params.activeSlots) {
      this.nightlySweepActiveSlots = this.normalizeNightlySweepSlots(params.activeSlots);
    }

    await this.saveNightlySweepConfig();
    this.refreshNightlySweepTimer();
    return this.schedulerStatus();
  }

  async ativarSyncNoNsuAtual(
    dto: EnableNfeSyncDto
  ): Promise<{
    clienteId: string;
    ambiente: NfeAmbiente;
    controlesCriadosOuReativados: number;
    controlesInicializados: number;
    controlesReativados: number;
    falhas: number;
    detalhes: Array<{ estabelecimentoId: string; cnpjConsulta: string; status: 'inicializado' | 'reativado' | 'falha'; mensagem: string }>;
  }> {
    if (this.usesDominioSyncSource()) {
      return this.prepareDominioControls({
        clienteId: dto.clienteId,
        ambiente: dto.ambiente ?? NfeAmbiente.producao
      });
    }

    await this.ensureClientEligibleForNfeSync(dto.clienteId);
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const establishments = await this.resolveTargetEstablishments(dto.clienteId);
    const detalhes: Array<{
      estabelecimentoId: string;
      cnpjConsulta: string;
      status: 'inicializado' | 'reativado' | 'falha';
      mensagem: string;
    }> = [];
    let controlesInicializados = 0;
    let controlesReativados = 0;
    let falhas = 0;

    for (const establishment of establishments) {
      const cnpjConsulta = establishment.cnpj;

      try {
        const certificate = await this.findActiveCertificateOrThrow(dto.clienteId, establishment.id, cnpjConsulta);
        const existing = await this.prisma.nfeSyncControle.findFirst({
          where: {
            clienteId: dto.clienteId,
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            ambiente
          }
        });
        const shouldRecaptureBase = existing ? existing.ultimoNsuConsultado === 0n && existing.maxNsu === 0n : false;

        if (existing && !shouldRecaptureBase) {
          await this.prisma.nfeSyncControle.update({
            where: { id: existing.id },
            data: {
              status: NfeSyncStatus.ativo,
              ultimaMensagem: 'Busca de NF-e reativada mantendo o NSU base existente'
            }
          });
          controlesReativados += 1;
          detalhes.push({
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            status: 'reativado',
            mensagem: 'Controle existente reativado'
          });
          continue;
        }

        const cUfAutor = this.resolveCUfAutorFromEstablishment(establishment);
        const currentNsuResult = await this.distribuicaoClient.distribuirPorNsu({
          cnpjConsulta,
          cUfAutor,
          ultNsu: 0n,
          ambiente,
          certificateId: certificate.id
        });

        if (currentNsuResult.statusCode !== 200) {
          throw new BadRequestException(
            currentNsuResult.xMotivo ?? `Falha ao consultar NSU atual da NF-e. HTTP ${currentNsuResult.statusCode}.`
          );
        }

        this.assertInitialCaptureResult(currentNsuResult, cnpjConsulta);

        if (existing && shouldRecaptureBase) {
          await this.prisma.nfeSyncControle.update({
            where: { id: existing.id },
            data: {
              ultimoNsuConsultado: currentNsuResult.maxNsu,
              maxNsu: currentNsuResult.maxNsu,
              status: NfeSyncStatus.ativo,
              ultimaExecucao: new Date(),
              ultimaMensagem: `Busca de NF-e reativada e reposicionada no NSU atual ${currentNsuResult.maxNsu.toString()}`
            }
          });
          controlesReativados += 1;
          detalhes.push({
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            status: 'reativado',
            mensagem: `Controle existente reposicionado no NSU atual ${currentNsuResult.maxNsu.toString()}`
          });
          continue;
        }

        await this.prisma.nfeSyncControle.create({
          data: {
            clienteId: dto.clienteId,
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            ambiente,
            ultimoNsuConsultado: currentNsuResult.maxNsu,
            maxNsu: currentNsuResult.maxNsu,
            status: NfeSyncStatus.ativo,
            ultimaExecucao: new Date(),
            ultimaMensagem: `Busca de NF-e habilitada a partir do NSU atual ${currentNsuResult.maxNsu.toString()}`
          }
        });
        controlesInicializados += 1;
        detalhes.push({
          estabelecimentoId: establishment.id,
          cnpjConsulta,
          status: 'inicializado',
          mensagem: `Controle criado no NSU atual ${currentNsuResult.maxNsu.toString()}`
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          estabelecimentoId: establishment.id,
          cnpjConsulta,
          status: 'falha',
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      clienteId: dto.clienteId,
      ambiente,
      controlesCriadosOuReativados: controlesInicializados + controlesReativados,
      controlesInicializados,
      controlesReativados,
      falhas,
      detalhes
    };
  }

  async ativarSyncNoNsuAtualParaTodos(
    dto: EnableAllNfeSyncDto = {}
  ): Promise<{
    ambiente: NfeAmbiente;
    clientesProcessados: number;
    clientesComSucesso: number;
    controlesCriadosOuReativados: number;
    controlesInicializados: number;
    controlesReativados: number;
    falhas: number;
    detalhes: Array<{ clienteId: string; sucesso: boolean; mensagem: string }>;
  }> {
    if (this.usesDominioSyncSource()) {
      return this.prepareDominioControlsForAll(dto);
    }

    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const clients = await this.prisma.cliente.findMany({
      where: {
        ativo: true,
        nfeHabilitado: true
      },
      orderBy: { createdAt: 'asc' }
    });
    const detalhes: Array<{ clienteId: string; sucesso: boolean; mensagem: string }> = [];
    let clientesComSucesso = 0;
    let controlesCriadosOuReativados = 0;
    let controlesInicializados = 0;
    let controlesReativados = 0;
    let falhas = 0;

    for (const client of clients) {
      try {
        const result = await this.ativarSyncNoNsuAtual({
          clienteId: client.id,
          ambiente
        });
        const activated = result.controlesCriadosOuReativados;
        const hasSuccess = activated > 0 && result.falhas < result.detalhes.length;
        if (hasSuccess) {
          clientesComSucesso += 1;
        }
        controlesCriadosOuReativados += result.controlesCriadosOuReativados;
        controlesInicializados += result.controlesInicializados;
        controlesReativados += result.controlesReativados;
        falhas += result.falhas;
        detalhes.push({
          clienteId: client.id,
          sucesso: hasSuccess,
          mensagem: `${result.controlesCriadosOuReativados} controle(s) preparados; ${result.falhas} falha(s)`
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          clienteId: client.id,
          sucesso: false,
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      ambiente,
      clientesProcessados: clients.length,
      clientesComSucesso,
      controlesCriadosOuReativados,
      controlesInicializados,
      controlesReativados,
      falhas,
      detalhes
    };
  }

  async findAll(query: QueryNfeDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    const andConditions = this.getAndConditions(where);
    const { page, pageSize, skip } = this.resolvePagination(query);

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidas') {
        andConditions.push({ cnpjEmitente: cnpjConsulta });
      } else if (tipoRelacao === 'recebidas') {
        andConditions.push({ cnpjDestinatario: cnpjConsulta });
      } else {
        andConditions.push({
          OR: [{ cnpjEmitente: cnpjConsulta }, { cnpjDestinatario: cnpjConsulta }]
        });
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.nfeDocumento.count({ where }),
      this.findManyDocumentosWithEventos({
        where,
        orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize
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

  async getDashboardStats(query: DashboardNfeStatsQueryDto) {
    const where: Prisma.NfeDocumentoWhereInput = {
      NOT: this.getCteSchemaDocFilters()
    };
    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const xmlCompletoWhere: Prisma.NfeDocumentoWhereInput = {
      ...where,
      xmlCompletoDisponivel: true
    };

    const [totalNfe, xmlsCompletos, totalByClientRows, completosByClientRows] = await Promise.all([
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

    const byClient = new Map<string, { clienteId: string; totalNfe: number; xmlsCompletos: number }>();

    totalByClientRows.forEach((row) => {
      byClient.set(row.clienteId, {
        clienteId: row.clienteId,
        totalNfe: row._count._all,
        xmlsCompletos: 0
      });
    });

    completosByClientRows.forEach((row) => {
      const current = byClient.get(row.clienteId) ?? {
        clienteId: row.clienteId,
        totalNfe: 0,
        xmlsCompletos: 0
      };
      current.xmlsCompletos = row._count._all;
      byClient.set(row.clienteId, current);
    });

    return {
      totalNfe,
      xmlsCompletos,
      byClient: Array.from(byClient.values()).sort(
        (left, right) =>
          right.totalNfe - left.totalNfe ||
          right.xmlsCompletos - left.xmlsCompletos ||
          left.clienteId.localeCompare(right.clienteId)
      )
    };
  }

  async findOne(id: string, clienteId: string) {
    const found = await this.findUniqueDocumentoWithEventos({
      where: { id }
    });
    if (!found) {
      throw new NotFoundException('NF-e nao encontrada');
    }
    this.assertClientScope(found.clienteId, clienteId);
    if (found.modelo === '57' || this.isCteSchemaDoc(found.schemaDoc)) {
      throw new NotFoundException('NF-e nao encontrada');
    }
    return found;
  }

  async sincronizarEventos(dto: SincronizarNfeEventosDto) {
    return this.sincronizarEventosDocumentos({
      clienteId: dto.clienteId,
      documentoIds: dto.documentoIds,
      somenteSemEventos: dto.somenteSemEventos,
      limit: dto.limit,
      filtro: 'nfe'
    });
  }

  async getXml(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
    const key = doc.xmlCompletoPath ?? doc.xmlResumoPath;
    if (!key) {
      throw new NotFoundException('XML nao disponivel para esta NF-e');
    }

    const xmlBuffer = await this.storage.getObject(key);
    const xml = xmlBuffer.toString('utf8');

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      fileName: `NFE-${doc.chaveAcesso}.xml`,
      contentType: 'application/xml',
      contentBase64: xmlBuffer.toString('base64'),
      xml
    };
  }

  async sincronizarEventosDocumentos(params: {
    clienteId: string;
    documentoIds?: string[];
    somenteSemEventos?: boolean;
    limit?: number;
    filtro: 'nfe' | 'cte';
  }) {
    const clienteId = await this.resolveClienteIdForEventoSync(params.clienteId, params.documentoIds);
    await this.ensureClient(clienteId);

    const limit = params.limit ?? 50;
    const where = this.buildEventoSyncWhere({
      ...params,
      clienteId
    });
    const orderBy: Prisma.NfeDocumentoOrderByWithRelationInput[] = [{ dataEmissao: 'desc' }, { createdAt: 'desc' }];
    let documents: Array<
      Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })
    > = [];
    try {
      documents = await this.findManyDocumentosForEventoSync({
        where,
        include: this.nfeDocumentoInclude(),
        orderBy,
        take: limit
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao preparar sincronizacao manual de eventos de ${params.filtro.toUpperCase()}; retornando detalhe estruturado. ${this.toErrorMessage(error)}`
      );
      return this.buildFatalEventoSyncResponse({
        documentoIds: params.documentoIds,
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
        const cnpjConsulta = establishment.cnpj;
        const certificate = await this.findActiveCertificateOrThrow(document.clienteId, document.estabelecimentoId, cnpjConsulta);
        const cUfAutor = this.resolveCUfAutorFromEstablishment(establishment);
        const result = await this.distribuicaoClient.consultarPorChave({
          cnpjConsulta,
          cUfAutor,
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

        const eventDocuments = this.extractEventDocuments(result.documents, params.filtro);
        const importedBefore = eventosImportados;

        for (const eventDocument of eventDocuments) {
          await this.persistDocument({
            clienteId: document.clienteId,
            estabelecimentoId: document.estabelecimentoId,
            ambiente: document.ambiente,
            cnpjConsulta,
            document: eventDocument,
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
          mensagem: eventDocuments.length > 0 ? undefined : result.xMotivo ?? 'Nenhum evento encontrado na distribuicao'
        });
      } catch (error) {
        falhas += 1;
        const message = this.toErrorMessage(error);
        detalhes.push({
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
          numeroDocumento,
          status: message.toLowerCase().includes('certificado') ? 'falha_certificado' : 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: message
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

  async importXml(dto: ImportNfeXmlDto) {
    await this.ensureClient(dto.clienteId);
    await this.ensureEstablishment(dto.estabelecimentoId, dto.clienteId);

    const xml = Buffer.from(dto.xmlBase64, 'base64').toString('utf8');
    const persisted = await this.persistDocument({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente: dto.ambiente,
      cnpjConsulta: dto.cnpjConsulta,
      document: {
        schema: 'importacao_xml',
        xml
      },
      origem: NfeDocumentoOrigem.importacao_xml,
      tipoRelacaoForcada: dto.tipoRelacao
    });

    return persisted;
  }

  async importFromDominio(dto: ImportNfeFromDominioDto) {
    await this.ensureClient(dto.clienteId);
    return this.importFromDominioInternal({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente: dto.ambiente ?? NfeAmbiente.producao,
      limit: dto.limit,
      dataEmissaoInicio: dto.dataEmissaoInicio,
      dataEmissaoFim: dto.dataEmissaoFim,
      chavesAcesso: dto.chavesAcesso,
      catalogoIds: dto.catalogoIds
    });
  }

  async getDominioXml(dto: GetDominioNfeXmlDto) {
    await this.ensureClient(dto.clienteId);

    const records = await this.loadDominioDocumentsForClient({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      catalogoIds: [dto.catalogoId],
      limit: 10
    });
    const record = records.find((item) => item.catalogoId === dto.catalogoId);
    if (!record) {
      throw new NotFoundException('XML nao encontrado no banco Dominio para o catalogo informado');
    }

    const xml = this.decodeXml(record.xmlBase64);
    const inspected = this.parser.inspect(xml);

    return {
      catalogoId: record.catalogoId,
      chaveAcesso: this.normalizeChaveAcesso(record.chaveAcesso) ?? inspected.chaveAcesso,
      numeroNfe: inspected.numeroNfe,
      serie: inspected.serie,
      modelo: inspected.modelo,
      fileName: `DOMINIO-NFE-${record.catalogoId}.xml`,
      contentType: 'application/xml',
      contentBase64: Buffer.from(xml, 'utf8').toString('base64'),
      xml
    };
  }

  async iniciarSync(dto: StartNfeSyncDto): Promise<{ controlesCriadosOuAtualizados: number }> {
    if (this.usesDominioSyncSource()) {
      const result = await this.prepareDominioControls({
        clienteId: dto.clienteId,
        estabelecimentoId: dto.estabelecimentoId,
        ambiente: dto.ambiente ?? NfeAmbiente.producao
      });
      return { controlesCriadosOuAtualizados: result.controlesCriadosOuReativados };
    }

    await this.ensureClientEligibleForNfeSync(dto.clienteId);
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const controls = await this.resolveTargetEstablishments(dto.clienteId, dto.estabelecimentoId);
    const nsuInicial = dto.nsuInicial ? BigInt(dto.nsuInicial) : 1n;
    let count = 0;

    for (const establishment of controls) {
      const cnpjConsulta = this.normalizeCnpj(dto.cnpjConsulta) ?? establishment.cnpj;
      await this.findActiveCertificateOrThrow(dto.clienteId, establishment.id, cnpjConsulta);

      await this.prisma.nfeSyncControle.upsert({
        where: {
          clienteId_cnpjConsulta_ambiente: {
            clienteId: dto.clienteId,
            cnpjConsulta,
            ambiente
          }
        },
        update: {
          status: NfeSyncStatus.ativo,
          ultimaMensagem: 'Busca de NF-e habilitada'
        },
        create: {
          clienteId: dto.clienteId,
          estabelecimentoId: establishment.id,
          cnpjConsulta,
          ambiente,
          ultimoNsuConsultado: nsuInicial > 0n ? nsuInicial - 1n : 0n,
          status: NfeSyncStatus.ativo,
          ultimaMensagem: 'Busca de NF-e habilitada'
        }
      });
      count += 1;
    }

    return { controlesCriadosOuAtualizados: count };
  }

  async pausarSync(dto: PauseNfeSyncDto): Promise<{ total: number }> {
    await this.ensureClient(dto.clienteId);
    const result = await this.prisma.nfeSyncControle.updateMany({
      where: {
        clienteId: dto.clienteId,
        ...(dto.ambiente ? { ambiente: dto.ambiente } : {})
      },
      data: {
        status: NfeSyncStatus.pausado,
        ultimaMensagem: 'Busca de NF-e pausada manualmente'
      }
    });

    return { total: result.count };
  }

  async statusSync(clienteId: string) {
    await this.ensureClient(clienteId);
    return this.prisma.nfeSyncControle.findMany({
      where: { clienteId },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async runNow(dto: RunNfeSyncDto): Promise<NfeSyncRunResult> {
    await this.ensureClientEligibleForNfeSync(dto.clienteId);
    if (this.isDominioXmlSyncSource()) {
      return this.runNowViaDominio({
        clienteId: dto.clienteId,
        ambiente: dto.ambiente,
        estabelecimentoId: dto.estabelecimentoId,
        limitControles: dto.limitControles
      });
    }

    if (this.isDominioChaveSyncSource()) {
      return this.runNowViaDominioConsultaChave({
        clienteId: dto.clienteId,
        ambiente: dto.ambiente,
        estabelecimentoId: dto.estabelecimentoId,
        limitControles: dto.limitControles
      });
    }

    return this.runNowInternal({
      clienteId: dto.clienteId,
      ambiente: dto.ambiente,
      estabelecimentoId: dto.estabelecimentoId,
      limitControles: dto.limitControles
    });
  }

  async runNowGlobal(): Promise<NfeSyncRunResult> {
    if (this.isDominioXmlSyncSource()) {
      return this.runNowViaDominio({
        limitControles: 50
      });
    }

    if (this.isDominioChaveSyncSource()) {
      return this.runNowViaDominioConsultaChave({
        limitControles: 50
      });
    }

    return this.runNowInternal({
      limitControles: 50
    });
  }

  async previewDownloadByKey(dto: RunNfeSyncDto): Promise<NfeDownloadByKeyPreviewResult> {
    this.assertManualDownloadByKeyEnabled();
    await this.ensureClientEligibleForNfeSync(dto.clienteId);
    return this.previewDownloadByKeyInternal({
      clienteId: dto.clienteId,
      ambiente: dto.ambiente,
      estabelecimentoId: dto.estabelecimentoId,
      limitControles: dto.limitControles
    });
  }

  async previewDownloadByKeyGlobal(): Promise<NfeDownloadByKeyPreviewResult> {
    this.assertManualDownloadByKeyEnabled();
    return this.previewDownloadByKeyInternal({
      limitControles: 50
    });
  }

  async executeDownloadByKey(dto: RunNfeSyncDto): Promise<NfeSyncRunResult> {
    this.assertManualDownloadByKeyEnabled();
    await this.ensureClientEligibleForNfeSync(dto.clienteId);
    return this.runNowViaDominioConsultaChave({
      clienteId: dto.clienteId,
      ambiente: dto.ambiente,
      estabelecimentoId: dto.estabelecimentoId,
      limitControles: dto.limitControles
    });
  }

  async executeDownloadByKeyGlobal(): Promise<NfeSyncRunResult> {
    this.assertManualDownloadByKeyEnabled();
    return this.runNowViaDominioConsultaChave({
      limitControles: 50
    });
  }

  private async importFromDominioInternal(params: {
    clienteId: string;
    estabelecimentoId?: string;
    ambiente: NfeAmbiente;
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
    catalogoIds?: number[];
    catalogoIdMinExclusive?: number;
    sortDirection?: 'asc' | 'desc';
  }) {
    const establishments = await this.resolveTargetEstablishments(params.clienteId, params.estabelecimentoId);
    const establishmentByCnpj = new Map(
      establishments
        .map((establishment) => {
          const cnpj = this.normalizeCnpj(establishment.cnpj);
          return cnpj ? [cnpj, establishment] : null;
        })
        .filter((entry): entry is [string, (typeof establishments)[number]] => entry !== null)
    );

    const documents = await this.loadDominioDocumentsForClient({
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      limit: params.limit,
      dataEmissaoInicio: params.dataEmissaoInicio,
      dataEmissaoFim: params.dataEmissaoFim,
      chavesAcesso: params.chavesAcesso,
      catalogoIds: params.catalogoIds,
      catalogoIdMinExclusive: params.catalogoIdMinExclusive,
      sortDirection: params.sortDirection
    });

    let xmlsPersistidos = 0;
    let falhas = 0;
    let ignoradosSemVinculo = 0;
    let cursorAtualizadoAte = params.catalogoIdMinExclusive ?? 0;
    let maxCatalogoIdEncontrado = params.catalogoIdMinExclusive ?? 0;
    let travarCursor = false;
    const detalhes: Array<{
      catalogoId: number;
      chaveAcesso?: string;
      numeroNfe?: string;
      serie?: string;
      modelo?: string;
      cnpjEmpresa: string;
      status: 'persistido' | 'ignorado_sem_vinculo' | 'ignorado_xml_nao_fiscal' | 'ignorado_xml_cte' | 'falha';
      mensagem: string;
    }> = [];

    for (const document of documents) {
      maxCatalogoIdEncontrado = Math.max(maxCatalogoIdEncontrado, document.catalogoId);
      const cnpjEmpresa = this.normalizeCnpj(document.cnpjEmpresa);
      const establishment = cnpjEmpresa ? establishmentByCnpj.get(cnpjEmpresa) : undefined;
      const xml = this.decodeXml(document.xmlBase64);
      const inspectedXml = this.parser.inspect(xml);
      const classifiedXml = this.parser.classify(xml);

      if (this.isIgnorableDominioXml(xml)) {
        if (params.sortDirection === 'asc' && !travarCursor) {
          cursorAtualizadoAte = document.catalogoId;
        }
        detalhes.push({
          catalogoId: document.catalogoId,
          chaveAcesso: this.normalizeChaveAcesso(document.chaveAcesso),
          numeroNfe: inspectedXml.numeroNfe,
          serie: inspectedXml.serie,
          modelo: inspectedXml.modelo,
          cnpjEmpresa: cnpjEmpresa ?? '',
          status: 'ignorado_xml_nao_fiscal',
          mensagem: 'XML da Dominio ignorado por se tratar de baixa financeira, sem documento fiscal para importar'
        });
        continue;
      }

      if (classifiedXml.documentType === 'cte') {
        if (params.sortDirection === 'asc' && !travarCursor) {
          cursorAtualizadoAte = document.catalogoId;
        }
        detalhes.push({
          catalogoId: document.catalogoId,
          chaveAcesso: this.normalizeChaveAcesso(document.chaveAcesso) ?? inspectedXml.chaveAcesso,
          numeroNfe: inspectedXml.numeroNfe,
          serie: inspectedXml.serie,
          modelo: inspectedXml.modelo,
          cnpjEmpresa: cnpjEmpresa ?? '',
          status: 'ignorado_xml_cte',
          mensagem: 'XML da Dominio ignorado por se tratar de CT-e; use um fluxo dedicado para documentos de transporte'
        });
        continue;
      }

      if (!establishment) {
        ignoradosSemVinculo += 1;
        if (params.sortDirection === 'asc') {
          travarCursor = true;
        }
        detalhes.push({
          catalogoId: document.catalogoId,
          chaveAcesso: this.normalizeChaveAcesso(document.chaveAcesso),
          numeroNfe: inspectedXml.numeroNfe,
          serie: inspectedXml.serie,
          modelo: inspectedXml.modelo,
          cnpjEmpresa: cnpjEmpresa ?? '',
          status: 'ignorado_sem_vinculo',
          mensagem: 'CNPJ da Dominio nao possui estabelecimento ativo vinculado neste cliente'
        });
        continue;
      }

      try {
        const routedToNfse = await this.tryImportDominioAsNfse({
          clienteId: params.clienteId,
          estabelecimentoId: establishment.id,
          ambiente: params.ambiente,
          xml
        });
        if (!routedToNfse) {
          await this.persistDocument({
            clienteId: params.clienteId,
            estabelecimentoId: establishment.id,
            ambiente: params.ambiente,
            cnpjConsulta: establishment.cnpj,
            document: {
              schema: 'dominio_xml',
              xml,
              chaveAcesso: this.normalizeChaveAcesso(document.chaveAcesso)
            },
            origem: NfeDocumentoOrigem.importacao_xml
          });
        }
        xmlsPersistidos += 1;
        if (params.sortDirection === 'asc' && !travarCursor) {
          cursorAtualizadoAte = document.catalogoId;
        }
        detalhes.push({
          catalogoId: document.catalogoId,
          chaveAcesso: this.normalizeChaveAcesso(document.chaveAcesso),
          numeroNfe: inspectedXml.numeroNfe,
          serie: inspectedXml.serie,
          modelo: inspectedXml.modelo,
          cnpjEmpresa: cnpjEmpresa ?? '',
          status: 'persistido',
          mensagem: routedToNfse
            ? 'XML da Dominio identificado como NFS-e e importado com sucesso no armazenamento de servicos'
            : 'XML importado com sucesso'
        });
      } catch (error) {
        falhas += 1;
        if (params.sortDirection === 'asc') {
          travarCursor = true;
        }
        detalhes.push({
          catalogoId: document.catalogoId,
          chaveAcesso: this.normalizeChaveAcesso(document.chaveAcesso),
          numeroNfe: inspectedXml.numeroNfe,
          serie: inspectedXml.serie,
          modelo: inspectedXml.modelo,
          cnpjEmpresa: cnpjEmpresa ?? '',
          status: 'falha',
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      ambiente: params.ambiente,
      estabelecimentosConsultados: establishments.length,
      cnpjsConsultados: Array.from(establishmentByCnpj.keys()),
      xmlsEncontrados: documents.length,
      xmlsPersistidos,
      ignoradosSemVinculo,
      falhas,
      cursorAtualizadoAte,
      maxCatalogoIdEncontrado,
      detalhes
    };
  }

  private async loadDominioDocumentsForClient(params: {
    clienteId: string;
    estabelecimentoId?: string;
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
    catalogoIds?: number[];
    catalogoIdMinExclusive?: number;
    sortDirection?: 'asc' | 'desc';
  }) {
    const establishments = await this.resolveTargetEstablishments(params.clienteId, params.estabelecimentoId);
    const cnpjs = establishments
      .map((establishment) => this.normalizeCnpj(establishment.cnpj))
      .filter((value): value is string => Boolean(value));

    return this.dominioXmlSource.listDocuments({
      cnpjs,
      limit: params.limit,
      dataEmissaoInicio: params.dataEmissaoInicio,
      dataEmissaoFim: params.dataEmissaoFim,
      chavesAcesso: params.chavesAcesso?.map((value) => this.normalizeChaveAcesso(value)).filter((value): value is string => Boolean(value)),
      catalogoIds: (params.catalogoIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
      catalogoIdMinExclusive: params.catalogoIdMinExclusive,
      sortDirection: params.sortDirection
    });
  }

  private async loadDominioCatalogForClient(params: {
    clienteId: string;
    estabelecimentoId?: string;
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
    catalogoIds?: number[];
    catalogoIdMinExclusive?: number;
    sortDirection?: 'asc' | 'desc';
  }): Promise<DominioNfeCatalogRecord[]> {
    const establishments = await this.resolveTargetEstablishments(params.clienteId, params.estabelecimentoId);
    const cnpjs = establishments
      .map((establishment) => this.normalizeCnpj(establishment.cnpj))
      .filter((value): value is string => Boolean(value));

    return this.dominioXmlSource.listCatalog({
      cnpjs,
      limit: params.limit,
      dataEmissaoInicio: params.dataEmissaoInicio,
      dataEmissaoFim: params.dataEmissaoFim,
      chavesAcesso: params.chavesAcesso?.map((value) => this.normalizeChaveAcesso(value)).filter((value): value is string => Boolean(value)),
      catalogoIds: (params.catalogoIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
      catalogoIdMinExclusive: params.catalogoIdMinExclusive,
      sortDirection: params.sortDirection
    });
  }

  private async tryImportDominioAsNfse(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    xml: string;
  }): Promise<boolean> {
    if (!this.looksLikeNfseXml(params.xml)) {
      return false;
    }

    await this.nfseService.importXml({
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      xml: params.xml,
      ambiente: params.ambiente === NfeAmbiente.homologacao ? 'producao_restrita' : 'producao'
    });

    return true;
  }

  private looksLikeNfseXml(xml: string): boolean {
    return (
      /<(?:\w+:)?CompNfse\b/i.test(xml) ||
      /<(?:\w+:)?Nfse\b/i.test(xml) ||
      /<(?:\w+:)?NFSe\b/i.test(xml) ||
      /abrasf\.org\.br\/nfse/i.test(xml) ||
      (/sped\.fazenda\.gov\.br\/nfse/i.test(xml) &&
        (/<(?:\w+:)?(?:evento|procEvento)\b/i.test(xml) ||
          /<(?:\w+:)?pedRegEvento\b/i.test(xml) ||
          /<(?:\w+:)?infEvento\b/i.test(xml) ||
          /<(?:\w+:)?chNFSe\b/i.test(xml)))
    );
  }

  private isIgnorableDominioXml(xml: string): boolean {
    return /<(?:\w+:)?Baixas\b/i.test(xml) || /<(?:\w+:)?infBaixas\b/i.test(xml);
  }

  private async prepareDominioControls(params: {
    clienteId: string;
    estabelecimentoId?: string;
    ambiente: NfeAmbiente;
  }): Promise<{
    clienteId: string;
    ambiente: NfeAmbiente;
    controlesCriadosOuReativados: number;
    controlesInicializados: number;
    controlesReativados: number;
    falhas: number;
    detalhes: Array<{ estabelecimentoId: string; cnpjConsulta: string; status: 'inicializado' | 'reativado' | 'falha'; mensagem: string }>;
  }> {
    await this.ensureClientEligibleForNfeSync(params.clienteId);
    const establishments = await this.resolveTargetEstablishments(params.clienteId, params.estabelecimentoId);
    const detalhes: Array<{
      estabelecimentoId: string;
      cnpjConsulta: string;
      status: 'inicializado' | 'reativado' | 'falha';
      mensagem: string;
    }> = [];
    let controlesInicializados = 0;
    let controlesReativados = 0;
    let falhas = 0;

    for (const establishment of establishments) {
      const cnpjConsulta = establishment.cnpj;

      try {
        const existing = await this.prisma.nfeSyncControle.findFirst({
          where: {
            clienteId: params.clienteId,
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            ambiente: params.ambiente
          }
        });

        if (existing) {
          const isDominioControl = String(existing.ultimaMensagem || '').toLowerCase().includes('banco dominio');
          await this.prisma.nfeSyncControle.update({
            where: { id: existing.id },
            data: {
              status: NfeSyncStatus.ativo,
              ultimaExecucao: new Date(),
              ultimaMensagem: 'Busca de NF-e via banco Dominio reativada',
              ...(isDominioControl
                ? {}
                : {
                    ultimoNsuConsultado: 0n,
                    ultimoNsuDistribuido: 0n,
                    maxNsu: 0n
                  })
            }
          });
          controlesReativados += 1;
          detalhes.push({
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            status: 'reativado',
            mensagem: isDominioControl
              ? 'Controle existente reativado para importacao via banco Dominio'
              : 'Controle existente convertido para importacao via banco Dominio'
          });
          continue;
        }

        await this.prisma.nfeSyncControle.create({
          data: {
            clienteId: params.clienteId,
            estabelecimentoId: establishment.id,
            cnpjConsulta,
            ambiente: params.ambiente,
            status: NfeSyncStatus.ativo,
            ultimaExecucao: new Date(),
            ultimaMensagem: 'Busca de NF-e via banco Dominio habilitada'
          }
        });
        controlesInicializados += 1;
        detalhes.push({
          estabelecimentoId: establishment.id,
          cnpjConsulta,
          status: 'inicializado',
          mensagem: 'Controle criado para importacao via banco Dominio'
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          estabelecimentoId: establishment.id,
          cnpjConsulta,
          status: 'falha',
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      clienteId: params.clienteId,
      ambiente: params.ambiente,
      controlesCriadosOuReativados: controlesInicializados + controlesReativados,
      controlesInicializados,
      controlesReativados,
      falhas,
      detalhes
    };
  }

  private async prepareDominioControlsForAll(
    dto: EnableAllNfeSyncDto = {}
  ): Promise<{
    ambiente: NfeAmbiente;
    clientesProcessados: number;
    clientesComSucesso: number;
    controlesCriadosOuReativados: number;
    controlesInicializados: number;
    controlesReativados: number;
    falhas: number;
    detalhes: Array<{ clienteId: string; sucesso: boolean; mensagem: string }>;
  }> {
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const clients = await this.prisma.cliente.findMany({
      where: {
        ativo: true,
        nfeHabilitado: true
      },
      orderBy: { createdAt: 'asc' }
    });
    const detalhes: Array<{ clienteId: string; sucesso: boolean; mensagem: string }> = [];
    let clientesComSucesso = 0;
    let controlesCriadosOuReativados = 0;
    let controlesInicializados = 0;
    let controlesReativados = 0;
    let falhas = 0;

    for (const client of clients) {
      try {
        const result = await this.prepareDominioControls({
          clienteId: client.id,
          ambiente
        });
        const activated = result.controlesCriadosOuReativados;
        const hasSuccess = activated > 0 && result.falhas < result.detalhes.length;
        if (hasSuccess) {
          clientesComSucesso += 1;
        }
        controlesCriadosOuReativados += result.controlesCriadosOuReativados;
        controlesInicializados += result.controlesInicializados;
        controlesReativados += result.controlesReativados;
        falhas += result.falhas;
        detalhes.push({
          clienteId: client.id,
          sucesso: hasSuccess,
          mensagem: `${result.controlesCriadosOuReativados} controle(s) preparados para banco Dominio; ${result.falhas} falha(s)`
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          clienteId: client.id,
          sucesso: false,
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      ambiente,
      clientesProcessados: clients.length,
      clientesComSucesso,
      controlesCriadosOuReativados,
      controlesInicializados,
      controlesReativados,
      falhas,
      detalhes
    };
  }

  private async runNowViaDominio(params: {
    clienteId?: string;
    ambiente?: NfeAmbiente;
    estabelecimentoId?: string;
    limitControles?: number;
  }): Promise<NfeSyncRunResult> {
    const controls = await this.prisma.nfeSyncControle.findMany({
      where: {
        cliente: {
          ativo: true,
          nfeHabilitado: true
        },
        status: {
          in: [NfeSyncStatus.ativo, NfeSyncStatus.erro_api]
        },
        ...(params.clienteId ? { clienteId: params.clienteId } : {}),
        ...(params.ambiente ? { ambiente: params.ambiente } : {}),
        ...(params.estabelecimentoId ? { estabelecimentoId: params.estabelecimentoId } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: params.limitControles ?? 10
    });
    let documentsSaved = 0;
    let failures = 0;
    const executionDetails: NfeSyncRunFailureDetail[] = [];
    const failureDetails: NfeSyncRunFailureDetail[] = [];
    const limitPorControle = this.parsePositiveNumberEnv('NFE_DOMINIO_IMPORT_LIMIT_PER_RUN', 500);

    for (const control of controls) {
      try {
        const result = await this.importFromDominioInternal({
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          limit: limitPorControle,
          catalogoIdMinExclusive: this.toSafeCatalogoCursor(control.ultimoNsuConsultado),
          sortDirection: 'asc'
        });
        const cursorAtualizado = BigInt(result.cursorAtualizadoAte);
        const maxCatalogoEncontrado = BigInt(result.maxCatalogoIdEncontrado);
        documentsSaved += result.xmlsPersistidos;
        failures += result.falhas;
        executionDetails.push(
          ...result.detalhes.map((detail) => ({
            kind: 'documento' as const,
            status: detail.status,
            clientId: control.clienteId,
            estabelecimentoId: control.estabelecimentoId,
            ambiente: control.ambiente,
            cnpjConsulta: control.cnpjConsulta,
            catalogoId: detail.catalogoId,
            chaveAcesso: detail.chaveAcesso,
            numeroNfe: detail.numeroNfe,
            serie: detail.serie,
            modelo: detail.modelo,
            mensagem: detail.mensagem
          }))
        );
        failureDetails.push(
          ...result.detalhes
            .filter((detail) => detail.status === 'falha')
            .map((detail) => ({
              kind: 'documento' as const,
              status: 'falha' as const,
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: detail.catalogoId,
              chaveAcesso: detail.chaveAcesso,
              numeroNfe: detail.numeroNfe,
              serie: detail.serie,
              modelo: detail.modelo,
              mensagem: detail.mensagem
            }))
        );

        await this.prisma.nfeSyncControle.update({
          where: { id: control.id },
          data: {
            status: result.falhas > 0 ? NfeSyncStatus.erro_api : NfeSyncStatus.ativo,
            ultimoNsuConsultado: cursorAtualizado,
            ultimoNsuDistribuido: cursorAtualizado,
            maxNsu: maxCatalogoEncontrado > 0n ? maxCatalogoEncontrado : control.maxNsu,
            ultimaExecucao: new Date(),
            ultimaMensagem:
              result.falhas > 0
              ? `Importacao via banco Dominio executada com ${result.falhas} falha(s)`
                : result.xmlsPersistidos > 0
                  ? `Importacao via banco Dominio salvou ${result.xmlsPersistidos} XML(s)`
                  : 'Importacao via banco Dominio sem novos XMLs',
            totalDocumentosBaixados: {
              increment: result.xmlsPersistidos
            }
          }
        });
      } catch (error) {
        failures += 1;
        executionDetails.push({
          kind: 'controle',
          status: 'falha',
          clientId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          mensagem: this.toErrorMessage(error)
        });
        failureDetails.push({
          kind: 'controle',
          status: 'falha',
          clientId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          mensagem: this.toErrorMessage(error)
        });
        await this.prisma.nfeSyncControle.update({
          where: { id: control.id },
          data: {
            status: NfeSyncStatus.erro_api,
            ultimaExecucao: new Date(),
            ultimaMensagem: `Falha na importacao via banco Dominio: ${this.toErrorMessage(error)}`
          }
        });
      }
    }

    return {
      processed: controls.length,
      documentsSaved,
      failures,
      executionDetails,
      failureDetails
    };
  }

  private async runNowViaDominioConsultaChave(params: {
    clienteId?: string;
    ambiente?: NfeAmbiente;
    estabelecimentoId?: string;
    limitControles?: number;
  }): Promise<NfeSyncRunResult> {
    const controls = await this.prisma.nfeSyncControle.findMany({
      where: {
        cliente: {
          ativo: true,
          nfeHabilitado: true
        },
        status: {
          in: [NfeSyncStatus.ativo, NfeSyncStatus.erro_api]
        },
        ...(params.clienteId ? { clienteId: params.clienteId } : {}),
        ...(params.ambiente ? { ambiente: params.ambiente } : {}),
        ...(params.estabelecimentoId ? { estabelecimentoId: params.estabelecimentoId } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: params.limitControles ?? 10
    });

    let documentsSaved = 0;
    let failures = 0;
    const executionDetails: NfeSyncRunFailureDetail[] = [];
    const failureDetails: NfeSyncRunFailureDetail[] = [];
    const limitPorControle = this.parsePositiveNumberEnv('NFE_DOMINIO_IMPORT_LIMIT_PER_RUN', 500);

    for (const control of controls) {
      try {
        const establishment = await this.getEstablishmentOrThrow(control.estabelecimentoId, control.clienteId);
        const certificate = await this.findActiveCertificateOrThrow(
          control.clienteId,
          control.estabelecimentoId,
          control.cnpjConsulta
        );
        const cUfAutor = this.resolveCUfAutorFromEstablishment(establishment);
        const entries = await this.loadDominioCatalogForClient({
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          limit: limitPorControle,
          dataEmissaoInicio: NfeService.DOMINIO_CHAVE_DATA_EMISSAO_INICIO,
          catalogoIdMinExclusive: this.toSafeCatalogoCursor(control.ultimoNsuConsultado),
          sortDirection: 'asc'
        });

        let cursorAtualizadoAte = this.toSafeCatalogoCursor(control.ultimoNsuConsultado);
        let maxCatalogoEncontrado = this.toSafeCatalogoCursor(control.maxNsu);
        let controlFailures = 0;
        let controlSaved = 0;
        let travarCursor = false;

        for (const entry of entries) {
          maxCatalogoEncontrado = Math.max(maxCatalogoEncontrado, entry.catalogoId);
          const chaveAcesso = this.normalizeChaveAcesso(entry.chaveAcesso);
          const modelo = this.extractModeloFromChave(chaveAcesso);
          const documentLabel = modelo === '57' ? 'CT-e' : 'NF-e';

          if (!chaveAcesso) {
            if (!travarCursor) {
              cursorAtualizadoAte = entry.catalogoId;
            }
            executionDetails.push({
              kind: 'documento',
              status: 'ignorado_chave_invalida',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso: undefined,
              modelo: undefined,
              mensagem: 'Catalogo Dominio sem chave de acesso valida para consulta externa'
            });
            continue;
          }

          const existing = await this.prisma.nfeDocumento.findUnique({
            where: {
              ambiente_chaveAcesso: {
                ambiente: control.ambiente,
                chaveAcesso
              }
            },
            select: {
              xmlCompletoDisponivel: true
            }
          });

          if (existing?.xmlCompletoDisponivel) {
            if (!travarCursor) {
              cursorAtualizadoAte = entry.catalogoId;
            }
            executionDetails.push({
              kind: 'documento',
              status: 'ignorado_ja_completo',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              modelo,
              mensagem: `Chave ignorada porque o ${documentLabel} ja possui XML completo armazenado`
            });
            continue;
          }

          if (modelo === '57') {
            const result = await this.cteService.consultarChaveInternal({
              clienteId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              chaveAcesso,
              ambiente: control.ambiente,
              persistir: true,
              tentarEventos: true
            });

            if (result.statusCode !== 200) {
              controlFailures += 1;
              travarCursor = true;
              const detail: NfeSyncRunFailureDetail = {
                kind: 'documento',
                status: 'falha',
                clientId: control.clienteId,
                estabelecimentoId: control.estabelecimentoId,
                ambiente: control.ambiente,
                cnpjConsulta: control.cnpjConsulta,
                catalogoId: entry.catalogoId,
                chaveAcesso,
                modelo,
                mensagem: result.xMotivo ?? `Falha na consulta por chave do CT-e. HTTP ${result.statusCode}.`
              };
              executionDetails.push(detail);
              failureDetails.push(detail);
              continue;
            }

            if (result.documentosEncontrados === 0 && result.eventosEncontrados === 0) {
              if (!travarCursor) {
                cursorAtualizadoAte = entry.catalogoId;
              }
              executionDetails.push({
                kind: 'documento',
                status: 'ignorado_xml_nao_fiscal',
                clientId: control.clienteId,
                estabelecimentoId: control.estabelecimentoId,
                ambiente: control.ambiente,
                cnpjConsulta: control.cnpjConsulta,
                catalogoId: entry.catalogoId,
                chaveAcesso,
                modelo,
                mensagem: result.xMotivo || 'Consulta por chave sem documentos retornados'
              });
              continue;
            }

            documentsSaved += result.documentosPersistidos;
            controlSaved += result.documentosPersistidos;
            if (!travarCursor) {
              cursorAtualizadoAte = entry.catalogoId;
            }
            executionDetails.push({
              kind: 'documento',
              status: 'persistido',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              modelo,
              mensagem:
                result.documentosPersistidos === 1
                  ? 'CT-e consultado por chave e persistido com sucesso'
                  : `CT-e consultado por chave e persistido com ${result.documentosPersistidos} documento(s)`
            });
            continue;
          }

          const result = await this.distribuicaoClient.consultarPorChave({
            cnpjConsulta: control.cnpjConsulta,
            cUfAutor,
            chaveAcesso,
            ambiente: control.ambiente,
            certificateId: certificate.id
          });

          if (result.statusCode !== 200) {
            controlFailures += 1;
            travarCursor = true;
            const detail: NfeSyncRunFailureDetail = {
              kind: 'documento',
              status: 'falha',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              modelo,
              mensagem: result.xMotivo ?? `Falha na consulta por chave da NF-e. HTTP ${result.statusCode}.`
            };
            executionDetails.push(detail);
            failureDetails.push(detail);
            continue;
          }

          const cStat = String(result.cStat || '').trim();
          if (!['137', '138'].includes(cStat)) {
            controlFailures += 1;
            travarCursor = true;
            const detail: NfeSyncRunFailureDetail = {
              kind: 'documento',
              status: 'falha',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              modelo,
              mensagem: `Consulta por chave retornou cStat ${cStat || 'desconhecido'}: ${result.xMotivo || 'Sem xMotivo.'}`
            };
            executionDetails.push(detail);
            failureDetails.push(detail);
            continue;
          }

          if (result.documents.length === 0) {
            if (!travarCursor) {
              cursorAtualizadoAte = entry.catalogoId;
            }
            executionDetails.push({
              kind: 'documento',
              status: 'ignorado_xml_nao_fiscal',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              modelo,
              mensagem: result.xMotivo || 'Consulta por chave sem documentos retornados'
            });
            continue;
          }

          try {
            let persistedForKey = 0;
            for (const document of result.documents) {
              await this.persistDocument({
                clienteId: control.clienteId,
                estabelecimentoId: control.estabelecimentoId,
                ambiente: control.ambiente,
                cnpjConsulta: control.cnpjConsulta,
                document,
                origem: NfeDocumentoOrigem.distribuicao_nsu
              });
              persistedForKey += 1;
            }

            documentsSaved += persistedForKey;
            controlSaved += persistedForKey;
            if (!travarCursor) {
              cursorAtualizadoAte = entry.catalogoId;
            }
            executionDetails.push({
              kind: 'documento',
              status: 'persistido',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              numeroNfe: this.extractPrimaryNumeroNfe(result.documents),
              serie: this.extractPrimarySerie(result.documents),
              modelo,
              mensagem:
                persistedForKey === 1
                  ? 'NF-e consultada por chave e persistida com sucesso'
                  : `NF-e consultada por chave e persistida com ${persistedForKey} documento(s)`
            });
          } catch (error) {
            controlFailures += 1;
            travarCursor = true;
            const detail: NfeSyncRunFailureDetail = {
              kind: 'documento',
              status: 'falha',
              clientId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cnpjConsulta: control.cnpjConsulta,
              catalogoId: entry.catalogoId,
              chaveAcesso,
              numeroNfe: this.extractPrimaryNumeroNfe(result.documents),
              serie: this.extractPrimarySerie(result.documents),
              modelo,
              mensagem: this.toErrorMessage(error)
            };
            executionDetails.push(detail);
            failureDetails.push(detail);
          }
        }

        failures += controlFailures;
        await this.prisma.nfeSyncControle.update({
          where: { id: control.id },
          data: {
            status: controlFailures > 0 ? NfeSyncStatus.erro_api : NfeSyncStatus.ativo,
            ultimoNsuConsultado: BigInt(cursorAtualizadoAte),
            ultimoNsuDistribuido: BigInt(cursorAtualizadoAte),
            maxNsu: BigInt(maxCatalogoEncontrado),
            ultimaExecucao: new Date(),
            ultimaMensagem:
              controlFailures > 0
                ? `Consulta por chave via catalogo Dominio executada com ${controlFailures} falha(s)`
                : controlSaved > 0
                  ? `Consulta por chave via catalogo Dominio salvou ${controlSaved} documento(s)`
                  : 'Consulta por chave via catalogo Dominio sem novos documentos',
            totalDocumentosBaixados: {
              increment: controlSaved
            }
          }
        });
      } catch (error) {
        failures += 1;
        const detail: NfeSyncRunFailureDetail = {
          kind: 'controle',
          status: 'falha',
          clientId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          mensagem: this.toErrorMessage(error)
        };
        executionDetails.push(detail);
        failureDetails.push(detail);
        await this.prisma.nfeSyncControle.update({
          where: { id: control.id },
          data: {
            status: NfeSyncStatus.erro_api,
            ultimaExecucao: new Date(),
            ultimaMensagem: `Falha na consulta por chave via catalogo Dominio: ${this.toErrorMessage(error)}`
          }
        });
      }
    }

    return {
      processed: controls.length,
      documentsSaved,
      failures,
      executionDetails,
      failureDetails
    };
  }

  private async previewDownloadByKeyInternal(params: {
    clienteId?: string;
    ambiente?: NfeAmbiente;
    estabelecimentoId?: string;
    limitControles?: number;
  }): Promise<NfeDownloadByKeyPreviewResult> {
    const controls = await this.prisma.nfeSyncControle.findMany({
      where: {
        cliente: {
          ativo: true,
          nfeHabilitado: true
        },
        status: {
          in: [NfeSyncStatus.ativo, NfeSyncStatus.erro_api]
        },
        ...(params.clienteId ? { clienteId: params.clienteId } : {}),
        ...(params.ambiente ? { ambiente: params.ambiente } : {}),
        ...(params.estabelecimentoId ? { estabelecimentoId: params.estabelecimentoId } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: params.limitControles ?? 10
    });

    const rows: NfeDownloadByKeyPreviewRow[] = [];
    let failures = 0;
    const limitPorControle = this.parsePositiveNumberEnv('NFE_DOMINIO_IMPORT_LIMIT_PER_RUN', 500);

    for (const control of controls) {
      try {
        const establishment = await this.getEstablishmentOrThrow(control.estabelecimentoId, control.clienteId);
        await this.findActiveCertificateOrThrow(control.clienteId, control.estabelecimentoId, control.cnpjConsulta);

        const entries = await this.loadDominioCatalogForClient({
          clienteId: control.clienteId,
          estabelecimentoId: establishment.id,
          limit: limitPorControle,
          dataEmissaoInicio: NfeService.DOMINIO_CHAVE_DATA_EMISSAO_INICIO,
          catalogoIdMinExclusive: this.toSafeCatalogoCursor(control.ultimoNsuConsultado),
          sortDirection: 'asc'
        });

        for (const entry of entries) {
          const chaveAcesso = this.normalizeChaveAcesso(entry.chaveAcesso);
          if (!chaveAcesso) {
            continue;
          }

          const existing = await this.prisma.nfeDocumento.findUnique({
            where: {
              ambiente_chaveAcesso: {
                ambiente: control.ambiente,
                chaveAcesso
              }
            },
            select: {
              xmlCompletoDisponivel: true
            }
          });

          if (existing?.xmlCompletoDisponivel) {
            continue;
          }

          rows.push({
            kind: 'documento',
            clientId: control.clienteId,
            estabelecimentoId: control.estabelecimentoId,
            ambiente: control.ambiente,
            cnpjConsulta: control.cnpjConsulta,
            catalogoId: entry.catalogoId,
            chaveAcesso,
            modelo: this.extractModeloFromChave(chaveAcesso),
            mensagem: 'Chave localizada no catalogo Dominio e pronta para download oficial'
          });
        }
      } catch (error) {
        failures += 1;
        rows.push({
          kind: 'controle',
          clientId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      processed: controls.length,
      pendingDownloads: rows.filter((row) => row.kind === 'documento').length,
      failures,
      rows
    };
  }

  private async runNowInternal(params: {
    clienteId?: string;
    ambiente?: NfeAmbiente;
    estabelecimentoId?: string;
    limitControles?: number;
  }): Promise<NfeSyncRunResult> {
    const controls = await this.prisma.nfeSyncControle.findMany({
      where: {
        cliente: {
          ativo: true,
          nfeHabilitado: true
        },
        status: {
          in: [NfeSyncStatus.ativo, NfeSyncStatus.erro_api]
        },
        ...(params.clienteId ? { clienteId: params.clienteId } : {}),
        ...(params.ambiente ? { ambiente: params.ambiente } : {}),
        ...(params.estabelecimentoId ? { estabelecimentoId: params.estabelecimentoId } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: params.limitControles ?? 10
    });
    let documentsSaved = 0;

    for (const control of controls) {
      const establishment = await this.getEstablishmentOrThrow(control.estabelecimentoId, control.clienteId);
      const certificate = await this.findActiveCertificateOrThrow(
        control.clienteId,
        control.estabelecimentoId,
        control.cnpjConsulta
      );
      const cUfAutor = this.resolveCUfAutorFromEstablishment(establishment);
      const result = await this.distribuicaoClient.distribuirPorNsu({
        cnpjConsulta: control.cnpjConsulta,
        cUfAutor,
        ultNsu: control.ultimoNsuConsultado,
        ambiente: control.ambiente,
        certificateId: certificate.id
      });

      if (result.statusCode !== 200) {
        await this.prisma.nfeSyncControle.update({
          where: { id: control.id },
          data: {
            status: NfeSyncStatus.erro_api,
            ultimaExecucao: new Date(),
            ultimaMensagem: result.xMotivo ?? `Falha na distribuicao NF-e. HTTP ${result.statusCode}.`
          }
        });
        continue;
      }

      let highestDocumentNsu = control.ultimoNsuDistribuido;
      for (const document of result.documents) {
        await this.persistDocument({
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          document,
          origem: NfeDocumentoOrigem.distribuicao_nsu
        });
        documentsSaved += 1;
        if (document.nsu && document.nsu > highestDocumentNsu) {
          highestDocumentNsu = document.nsu;
        }
      }

      await this.prisma.nfeSyncControle.update({
        where: { id: control.id },
        data: {
          status: NfeSyncStatus.ativo,
          ultimoNsuConsultado: result.ultNsu,
          ultimoNsuDistribuido: highestDocumentNsu,
          maxNsu: result.maxNsu,
          ultimaExecucao: new Date(),
          ultimaMensagem: result.xMotivo ?? 'Distribuicao NF-e executada com sucesso',
          totalDocumentosBaixados: {
            increment: result.documents.length
          }
        }
      });
    }

    return {
      processed: controls.length,
      documentsSaved,
      failures: 0,
      executionDetails: [],
      failureDetails: []
    };
  }

  async consultarNsu(dto: QueryNfeByNsuDto) {
    await this.ensureClient(dto.clienteId);
    const establishment = await this.getEstablishmentOrThrow(dto.estabelecimentoId, dto.clienteId);
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const cnpjConsulta = establishment.cnpj;
    const certificate = await this.findActiveCertificateOrThrow(dto.clienteId, dto.estabelecimentoId, cnpjConsulta);
    const cUfAutor = this.resolveCUfAutorFromEstablishment(establishment);
    const result = await this.distribuicaoClient.consultarPorNsu({
      cnpjConsulta,
      cUfAutor,
      nsu: BigInt(dto.nsu),
      ambiente,
      certificateId: certificate.id
    });

    return this.handleManualConsultaResult({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      cnpjConsulta,
      persistir: dto.persistir !== false,
      result,
      requestedNsu: dto.nsu
    });
  }

  async consultarChave(dto: QueryNfeByChaveDto) {
    await this.ensureClient(dto.clienteId);
    const establishment = await this.getEstablishmentOrThrow(dto.estabelecimentoId, dto.clienteId);
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const cnpjConsulta = establishment.cnpj;
    const certificate = await this.findActiveCertificateOrThrow(dto.clienteId, dto.estabelecimentoId, cnpjConsulta);
    const cUfAutor = this.resolveCUfAutorFromEstablishment(establishment);
    const result = await this.distribuicaoClient.consultarPorChave({
      cnpjConsulta,
      cUfAutor,
      chaveAcesso: dto.chaveAcesso,
      ambiente,
      certificateId: certificate.id
    });

    return this.handleManualConsultaResult({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      cnpjConsulta,
      persistir: dto.persistir !== false,
      result,
      requestedChave: dto.chaveAcesso
    });
  }

  async persistEventDocumentFromExternalSource(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    document: NfeDistribuicaoDocument;
    origem: NfeDocumentoOrigem;
    tipoRelacaoForcada?: NfeTipoRelacao;
  }) {
    return this.persistDocument(params);
  }

  private async persistDocument(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    document: NfeDistribuicaoDocument;
    origem: NfeDocumentoOrigem;
    tipoRelacaoForcada?: NfeTipoRelacao;
  }) {
    const classifiedXml = this.parser.classify(params.document.xml);
    if (classifiedXml.contentType === 'evento') {
      return this.persistEventDocument(params);
    }
    if (classifiedXml.documentType === 'cte') {
      throw new BadRequestException('XML de CT-e nao pode ser importado no modulo de NF-e');
    }

    const parsed = this.parser.parse(params.document.xml);
    const existing = await this.findExistingDocumentoForPersist(params.ambiente, parsed.chaveAcesso);

    const cnpjConsulta = this.normalizeCnpj(params.cnpjConsulta);
    const tipoRelacao =
      params.tipoRelacaoForcada ??
      this.resolveTipoRelacao(cnpjConsulta, parsed) ??
      existing?.tipoRelacao ??
      null;

    const dataReferencia = parsed.dataEmissao ?? parsed.dataAutorizacao ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const cnpjPasta = parsed.cnpjEmitente ?? parsed.cnpjDestinatario ?? cnpjConsulta ?? 'sem-cnpj';
    const storagePrefix = `nfe/${params.ambiente}/${cnpjPasta}/${year}/${month}`;
    const fileName = `${parsed.chaveAcesso}.xml`;
    const isFull = parsed.contentType === 'completo';
    const storageKey = `${storagePrefix}/${isFull ? 'xml' : 'resumos'}/${fileName}`;
    await this.storage.putObject(storageKey, params.document.xml);
    const hash = this.parser.getHash(params.document.xml);
    const status = this.resolveDocumentoStatus(parsed.status, existing?.eventos);

    const updateData: Prisma.NfeDocumentoUncheckedUpdateInput = {
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      nsu: params.document.nsu,
      numeroNfe: parsed.numeroNfe,
      serie: parsed.serie,
      modelo: parsed.modelo ?? '55',
      dataEmissao: parsed.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao,
      status,
      tipoRelacao,
      schemaDoc: params.document.schema || parsed.schemaDoc,
      cnpjEmitente:
        parsed.cnpjEmitente ?? (tipoRelacao === NfeTipoRelacao.emitida ? cnpjConsulta : existing?.cnpjEmitente),
      razaoSocialEmitente: parsed.razaoSocialEmitente,
      cnpjDestinatario:
        parsed.cnpjDestinatario ?? (tipoRelacao === NfeTipoRelacao.recebida ? cnpjConsulta : existing?.cnpjDestinatario),
      razaoSocialDestinatario: parsed.razaoSocialDestinatario,
      valorTotal: this.toDecimal(parsed.valorTotal),
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
      nsu: params.document.nsu,
      chaveAcesso: parsed.chaveAcesso,
      numeroNfe: parsed.numeroNfe,
      serie: parsed.serie,
      modelo: parsed.modelo ?? '55',
      dataEmissao: parsed.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao,
      status,
      tipoRelacao,
      schemaDoc: params.document.schema || parsed.schemaDoc,
      resumoDisponivel: !isFull,
      xmlCompletoDisponivel: isFull,
      cnpjEmitente: parsed.cnpjEmitente ?? (tipoRelacao === NfeTipoRelacao.emitida ? cnpjConsulta : undefined),
      razaoSocialEmitente: parsed.razaoSocialEmitente,
      cnpjDestinatario:
        parsed.cnpjDestinatario ?? (tipoRelacao === NfeTipoRelacao.recebida ? cnpjConsulta : undefined),
      razaoSocialDestinatario: parsed.razaoSocialDestinatario,
      valorTotal: this.toDecimal(parsed.valorTotal),
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
          chaveAcesso: parsed.chaveAcesso
        }
      },
      update: updateData,
      create: createData
    });
  }

  private async persistEventDocument(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    document: NfeDistribuicaoDocument;
    origem: NfeDocumentoOrigem;
    tipoRelacaoForcada?: NfeTipoRelacao;
  }) {
    const parsedEvent = this.parser.parseEvento(params.document.xml);
    const hash = this.parser.getHash(params.document.xml);
    const dataReferencia = parsedEvent.dataEvento ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const cnpjPasta = parsedEvent.cnpjAutor ?? this.normalizeCnpj(params.cnpjConsulta) ?? 'sem-cnpj';
    const tipoEvento = this.toSafeFileName(parsedEvent.tipoEvento || 'evento');
    const suffix = parsedEvent.numeroSequencial ? `_${this.toSafeFileName(parsedEvent.numeroSequencial)}` : `_${hash.slice(0, 12)}`;
    const storageKey = `nfe/${params.ambiente}/${cnpjPasta}/${year}/${month}/eventos/${parsedEvent.chaveAcesso}_${tipoEvento}${suffix}.xml`;
    await this.storage.putObject(storageKey, params.document.xml);

    const documento = await this.upsertDocumentoForEvento({
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      ambiente: params.ambiente,
      cnpjConsulta: params.cnpjConsulta,
      parsedEvent
    });

    await this.prisma.nfeEvento.upsert({
      where: {
        nfeDocumentoId_tipoEvento_dataEvento_hashXml: {
          nfeDocumentoId: documento.id,
          tipoEvento: parsedEvent.tipoEvento,
          dataEvento: parsedEvent.dataEvento ?? new Date(0),
          hashXml: hash
        }
      },
      update: {
        descricao: parsedEvent.descricao,
        schemaDoc: params.document.schema || parsedEvent.schemaDoc,
        xmlPath: storageKey
      },
      create: {
        nfeDocumentoId: documento.id,
        chaveAcesso: parsedEvent.chaveAcesso,
        tipoEvento: parsedEvent.tipoEvento,
        dataEvento: parsedEvent.dataEvento ?? new Date(0),
        descricao: parsedEvent.descricao,
        schemaDoc: params.document.schema || parsedEvent.schemaDoc,
        xmlPath: storageKey,
        hashXml: hash
      }
    });

    return documento;
  }

  private async upsertDocumentoForEvento(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    parsedEvent: ParsedDfeEvento;
  }) {
    const existing = await this.prisma.nfeDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: params.parsedEvent.chaveAcesso
        }
      }
    });

    const cnpjConsulta = this.normalizeCnpj(params.cnpjConsulta);
    const tipoRelacao =
      params.parsedEvent.documentType === 'nfe'
        ? this.resolveTipoRelacaoByEvent(cnpjConsulta, params.parsedEvent, existing?.tipoRelacao ?? null)
        : existing?.tipoRelacao ?? null;
    const isCte = params.parsedEvent.documentType === 'cte';
    const status = params.parsedEvent.isCancelamento ? 'Cancelada' : existing?.status ?? 'Evento recebido';
    const schemaDoc = existing?.schemaDoc ?? params.parsedEvent.schemaDoc;
    const modelo = existing?.modelo ?? (isCte ? '57' : '55');

    return this.prisma.nfeDocumento.upsert({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: params.parsedEvent.chaveAcesso
        }
      },
      update: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        modelo,
        status,
        schemaDoc,
        tipoRelacao,
        ...(params.parsedEvent.isCancelamento
          ? { dataAutorizacao: existing?.dataAutorizacao, updatedAt: new Date() }
          : { updatedAt: new Date() })
      },
      create: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        ambiente: params.ambiente,
        chaveAcesso: params.parsedEvent.chaveAcesso,
        modelo,
        status,
        schemaDoc,
        tipoRelacao,
        cnpjEmitente:
          !isCte && tipoRelacao === NfeTipoRelacao.emitida ? cnpjConsulta : undefined,
        cnpjDestinatario:
          !isCte && tipoRelacao === NfeTipoRelacao.recebida ? cnpjConsulta : undefined,
        origem: NfeDocumentoOrigem.importacao_xml
      }
    });
  }

  private extractEventDocuments(documents: NfeDistribuicaoDocument[], filtro: 'nfe' | 'cte'): NfeDistribuicaoDocument[] {
    const seen = new Set<string>();
    const filtered: NfeDistribuicaoDocument[] = [];

    for (const document of documents) {
      const classification = this.parser.classify(document.xml);
      if (classification.contentType !== 'evento' || classification.documentType !== filtro) {
        continue;
      }

      const signature = `${document.schema}|${this.parser.getHash(document.xml)}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      filtered.push(document);
    }

    return filtered;
  }

  private async handleManualConsultaResult(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta: string;
    persistir: boolean;
    result: {
      statusCode: number;
      cStat?: string;
      xMotivo?: string;
      documents: NfeDistribuicaoDocument[];
      ultNsu: bigint;
      maxNsu: bigint;
    };
    requestedNsu?: string;
    requestedChave?: string;
  }) {
    let documentosPersistidos = 0;
    const documentos = params.result.documents.map((document) => ({
      nsu: document.nsu?.toString(),
      schema: document.schema,
      chaveAcesso: document.chaveAcesso
    }));

    if (params.persistir) {
      for (const document of params.result.documents) {
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
      ultNsu: params.result.ultNsu.toString(),
      maxNsu: params.result.maxNsu.toString(),
      requestedNsu: params.requestedNsu,
      requestedChave: params.requestedChave,
      persistido: params.persistir,
      documentosEncontrados: params.result.documents.length,
      documentosPersistidos,
      documentos
    };
  }

  private buildBaseWhere(query: QueryNfeDto): Prisma.NfeDocumentoWhereInput {
    const where: Prisma.NfeDocumentoWhereInput = {
      NOT: this.getCteSchemaDocFilters(),
      AND: []
    };
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

    if (query.numeroNfe) {
      andConditions.push({
        numeroNfe: {
          contains: query.numeroNfe
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
    filtro: 'nfe' | 'cte';
  }): Prisma.NfeDocumentoWhereInput {
    const where: Prisma.NfeDocumentoWhereInput =
      params.filtro === 'cte'
        ? {
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
          }
        : {
            NOT: this.getCteSchemaDocFilters(),
            AND: []
          };
    const andConditions = this.getAndConditions(where);
    andConditions.push({ clienteId: params.clienteId });

    if (params.documentoIds?.length) {
      andConditions.push({ id: { in: params.documentoIds } });
    }

    if (params.somenteSemEventos ?? true) {
      andConditions.push({ eventos: { none: {} } });
    }

    return where;
  }

  private nfeDocumentoInclude(): Prisma.NfeDocumentoInclude {
    return {
      eventos: {
        orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
      }
    };
  }

  private async findManyDocumentosWithEventos(
    args: Omit<Prisma.NfeDocumentoFindManyArgs, 'include'>
  ): Promise<Array<Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] })>> {
    try {
      return await this.prisma.nfeDocumento.findMany({
        ...args,
        include: this.nfeDocumentoInclude()
      });
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn('Tabela nfe_eventos indisponivel; retornando NF-e sem eventos vinculados. Aplique a migration pendente.');
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
        'Tabela nfe_eventos indisponivel durante sincronizacao de eventos de NF-e; repetindo consulta sem filtro relacional.'
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
        include: this.nfeDocumentoInclude()
      });
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn('Tabela nfe_eventos indisponivel; retornando detalhe de NF-e sem eventos vinculados. Aplique a migration pendente.');
      const documento = await this.prisma.nfeDocumento.findUnique(args);
      return documento ? { ...documento, eventos: [] } : null;
    }
  }

  private async findExistingDocumentoForPersist(
    ambiente: NfeAmbiente,
    chaveAcesso: string
  ): Promise<Prisma.NfeDocumentoGetPayload<{ include: { eventos: true } }> | (Prisma.NfeDocumentoGetPayload<Record<string, never>> & { eventos: [] }) | null> {
    try {
      return await this.prisma.nfeDocumento.findUnique({
        where: {
          ambiente_chaveAcesso: {
            ambiente,
            chaveAcesso
          }
        },
        include: this.nfeDocumentoInclude()
      });
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn('Tabela nfe_eventos indisponivel durante importacao de NF-e; continuando sem eventos vinculados.');
      const documento = await this.prisma.nfeDocumento.findUnique({
        where: {
          ambiente_chaveAcesso: {
            ambiente,
            chaveAcesso
          }
        }
      });
      return documento ? { ...documento, eventos: [] } : null;
    }
  }

  private resolveDocumentoStatus(
    status: string | null | undefined,
    eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null }>
  ) {
    if (this.hasCancellationEvent(eventos)) {
      return 'Cancelada';
    }

    return status ?? undefined;
  }

  private hasCancellationEvent(eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null }>) {
    return Array.isArray(eventos)
      ? eventos.some((evento) => {
          const tipoEvento = this.normalizeSearchText(evento?.tipoEvento);
          const descricao = this.normalizeSearchText(evento?.descricao);
          return tipoEvento === '110111' || tipoEvento.includes('cancel') || descricao.includes('cancel');
        })
      : false;
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

  private resolvePagination(query: QueryNfeDto): { page: number; pageSize: number; skip: number } {
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

  private getCteSchemaDocFilters(): Prisma.NfeDocumentoWhereInput[] {
    return [
      { modelo: '57' },
      { schemaDoc: { startsWith: 'CTe' } },
      { schemaDoc: { startsWith: 'cteProc' } },
      { schemaDoc: { startsWith: 'resCTe' } },
      { schemaDoc: { startsWith: 'eventoCTe' } },
      { schemaDoc: { startsWith: 'procEventoCTe' } }
    ];
  }

  private isCteSchemaDoc(schemaDoc?: string | null): boolean {
    if (!schemaDoc) {
      return false;
    }

    return ['CTe', 'cteProc', 'resCTe', 'eventoCTe', 'procEventoCTe'].some((prefix) => schemaDoc.startsWith(prefix));
  }

  private async runAutomaticSyncCycle(): Promise<void> {
    if (this.isDominioChaveSyncSource()) {
      return;
    }

    if (this.autoSyncRunning) {
      return;
    }

    this.autoSyncRunning = true;
    try {
      await this.runNowGlobal();
    } catch (error) {
      this.logger.warn(`Falha na execucao automatica de NF-e: ${this.toErrorMessage(error)}`);
    } finally {
      this.autoSyncRunning = false;
    }
  }

  private async runNightlySweepCycle(): Promise<void> {
    if (this.isDominioChaveSyncSource()) {
      return;
    }

    if (this.nightlySweepRunning) {
      return;
    }

    const executionKey = this.resolveCurrentNightlySweepExecutionKey(new Date());
    if (!executionKey) {
      return;
    }

    this.nightlySweepRunning = true;
    try {
      this.lastNightlySweepExecutionKey = executionKey;
      this.executedNightlySweepKeys.add(executionKey);
      const activation = await this.ativarSyncNoNsuAtualParaTodos({
        ambiente: NfeAmbiente.producao
      });
      const runResult = await this.runNowGlobal();
      this.logger.log(
        `Busca noturna NF-e executada (${executionKey}): ${activation.controlesCriadosOuReativados} controle(s) preparados, ${runResult.documentsSaved} documento(s) salvo(s)`
      );
    } catch (error) {
      this.logger.warn(`Falha na busca noturna de NF-e: ${this.toErrorMessage(error)}`);
    } finally {
      this.nightlySweepRunning = false;
    }
  }

  private resolveTipoRelacao(cnpjConsulta: string | undefined, parsed: ParsedNfe): NfeTipoRelacao | undefined {
    if (!cnpjConsulta) {
      return undefined;
    }

    if (parsed.cnpjEmitente === cnpjConsulta) {
      return NfeTipoRelacao.emitida;
    }

    if (parsed.cnpjDestinatario === cnpjConsulta) {
      return NfeTipoRelacao.recebida;
    }

    return undefined;
  }

  private resolveTipoRelacaoByEvent(
    cnpjConsulta: string | undefined,
    parsedEvent: ParsedDfeEvento,
    existing?: NfeTipoRelacao | null
  ): NfeTipoRelacao | null | undefined {
    if (existing) {
      return existing;
    }

    if (!cnpjConsulta || !parsedEvent.cnpjAutor) {
      return existing ?? null;
    }

    return parsedEvent.cnpjAutor === cnpjConsulta ? NfeTipoRelacao.emitida : existing ?? null;
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

  private async ensureClientEligibleForNfeSync(clienteId: string): Promise<void> {
    const found = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!found) {
      throw new NotFoundException('Cliente nao encontrado');
    }

    if (!found.nfeHabilitado) {
      throw new BadRequestException('Cliente com busca de NF-e desabilitada no cadastro');
    }
  }

  private async ensureEstablishment(estabelecimentoId: string, clienteId: string): Promise<void> {
    await this.getEstablishmentOrThrow(estabelecimentoId, clienteId);
  }

  private async getEstablishmentOrThrow(estabelecimentoId: string, clienteId: string) {
    const found = await this.prisma.clienteEstabelecimento.findUnique({ where: { id: estabelecimentoId } });
    if (!found || found.clienteId !== clienteId) {
      throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
    }

    return found;
  }

  private async resolveTargetEstablishments(clienteId: string, estabelecimentoId?: string) {
    if (estabelecimentoId) {
      const found = await this.prisma.clienteEstabelecimento.findUnique({ where: { id: estabelecimentoId } });
      if (!found || found.clienteId !== clienteId) {
        throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
      }
      return [found];
    }

    const found = await this.prisma.clienteEstabelecimento.findMany({
      where: { clienteId, ativo: true },
      orderBy: { createdAt: 'asc' }
    });

    if (found.length === 0) {
      throw new BadRequestException('Cliente nao possui estabelecimentos ativos para busca de NF-e');
    }

    return found;
  }

  private refreshNightlySweepTimer(): void {
    if (this.nightlySweepEnabled) {
      if (!this.nightlySweepTimer) {
        this.nightlySweepTimer = setInterval(() => {
          const executionKey = this.resolveCurrentNightlySweepExecutionKey(new Date());
          if (!executionKey || this.executedNightlySweepKeys.has(executionKey)) {
            return;
          }
          void this.runNightlySweepCycle();
        }, this.nightlySweepCheckIntervalMs);
        this.nightlySweepTimer.unref?.();
        const nightlySweepStartupTimer = setTimeout(() => {
          const executionKey = this.resolveCurrentNightlySweepExecutionKey(new Date());
          if (!executionKey || this.executedNightlySweepKeys.has(executionKey)) {
            return;
          }
          void this.runNightlySweepCycle();
        }, 5000);
        nightlySweepStartupTimer.unref?.();
      }

      this.logger.log(
        `Busca noturna NF-e habilitada para ${this.describeNightlySweepSlots()} (UTC${this.nightlySweepTimezoneOffsetMinutes >= 0 ? '+' : ''}${this.nightlySweepTimezoneOffsetMinutes / 60})`
      );
      return;
    }

    if (this.nightlySweepTimer) {
      clearInterval(this.nightlySweepTimer);
      this.nightlySweepTimer = null;
    }

    this.logger.log('Busca noturna NF-e desativada (NFE_SYNC_NIGHTLY_SWEEP_ENABLED=false)');
  }

  private resolveInitialNightlySweepSlots(): string[] {
    const envValue = process.env.NFE_SYNC_NIGHTLY_SWEEP_SLOTS;
    if (!envValue) {
      return this.normalizeNightlySweepSlots([this.formatTime(this.nightlySweepHour, this.nightlySweepMinute)]);
    }

    return this.normalizeNightlySweepSlots(envValue.split(','));
  }

  private normalizeNightlySweepSlots(slots: string[]): string[] {
    const valid = Array.from(
      new Set(slots.map((value) => value.trim()).filter((value) => NfeService.NIGHTLY_SWEEP_AVAILABLE_SLOTS.includes(value)))
    );
    return NfeService.NIGHTLY_SWEEP_AVAILABLE_SLOTS.filter((slot) => valid.includes(slot));
  }

  private getReferenceNightlySweepSlot(): NfeNightlySweepSlot {
    return this.parseNightlySweepSlot(this.nightlySweepActiveSlots[0] ?? this.formatTime(this.nightlySweepHour, this.nightlySweepMinute));
  }

  private parseNightlySweepSlot(slot: string): NfeNightlySweepSlot {
    const [hourRaw, minuteRaw] = slot.split(':');
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    return {
      time: slot,
      hour: Number.isInteger(hour) ? hour : this.nightlySweepHour,
      minute: Number.isInteger(minute) ? minute : this.nightlySweepMinute
    };
  }

  private describeNightlySweepSlots(): string {
    if (this.nightlySweepActiveSlots.length === 0) {
      return 'nenhum horario ativo';
    }

    return this.nightlySweepActiveSlots.join(', ');
  }

  private resolveCurrentNightlySweepExecutionKey(now: Date): string | null {
    if (!this.nightlySweepEnabled || this.nightlySweepActiveSlots.length === 0) {
      return null;
    }

    const localNow = this.toNightlySweepLocalDate(now);
    const currentMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();

    const matchedSlot = this.nightlySweepActiveSlots
      .map((slot) => this.parseNightlySweepSlot(slot))
      .find((slot) => currentMinutes >= slot.hour * 60 + slot.minute && currentMinutes < slot.hour * 60 + slot.minute + 1);

    if (!matchedSlot) {
      return null;
    }

    const year = localNow.getUTCFullYear();
    const month = String(localNow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localNow.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day} ${matchedSlot.time}`;
  }

  private resolveNextNightlySweepAt(now: Date): Date | null {
    if (!this.nightlySweepEnabled || this.nightlySweepActiveSlots.length === 0) {
      return null;
    }

    const localNow = this.toNightlySweepLocalDate(now);
    const currentMs = localNow.getTime();
    const slots = this.nightlySweepActiveSlots.map((slot) => this.parseNightlySweepSlot(slot));

    let nextActual: Date | null = null;

    for (let dayOffset = 0; dayOffset <= 2 && !nextActual; dayOffset += 1) {
      const baseLocal = new Date(
        Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + dayOffset, 0, 0, 0, 0)
      );

      for (const slot of slots) {
        const targetLocalUtcMs = Date.UTC(
          baseLocal.getUTCFullYear(),
          baseLocal.getUTCMonth(),
          baseLocal.getUTCDate(),
          slot.hour,
          slot.minute,
          0,
          0
        );
        const targetActualMs = targetLocalUtcMs - this.nightlySweepTimezoneOffsetMinutes * 60 * 1000;
        if (targetLocalUtcMs <= currentMs) {
          continue;
        }
        if (targetActualMs > now.getTime()) {
          nextActual = new Date(targetActualMs);
          break;
        }
      }
    }

    return nextActual;
  }

  private toNightlySweepLocalDate(now: Date): Date {
    return new Date(now.getTime() + this.nightlySweepTimezoneOffsetMinutes * 60 * 1000);
  }

  private async loadNightlySweepConfig(): Promise<void> {
    const absolutePath = this.storage.resolveKeyPath(NfeService.NIGHTLY_SWEEP_CONFIG_STORAGE_KEY);
    try {
      const raw = await readFile(absolutePath, 'utf8');
      const parsed = JSON.parse(raw) as NfeNightlySweepConfigFile;

      if (typeof parsed.enabled === 'boolean') {
        this.nightlySweepEnabled = parsed.enabled;
      }

      if (Array.isArray(parsed.activeSlots)) {
        this.nightlySweepActiveSlots = this.normalizeNightlySweepSlots(parsed.activeSlots);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(`Falha ao carregar configuracao de busca noturna NF-e: ${this.toErrorMessage(error)}`);
      }
    }
  }

  private async saveNightlySweepConfig(): Promise<void> {
    const absolutePath = this.storage.resolveKeyPath(NfeService.NIGHTLY_SWEEP_CONFIG_STORAGE_KEY);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(
      absolutePath,
      JSON.stringify(
        {
          enabled: this.nightlySweepEnabled,
          activeSlots: this.nightlySweepActiveSlots
        } satisfies NfeNightlySweepConfigFile,
        null,
        2
      ),
      'utf8'
    );
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

  private assertInitialCaptureResult(
    result: Pick<NfeDistribuicaoResult, 'cStat' | 'xMotivo' | 'maxNsu' | 'ultNsu'>,
    cnpjConsulta: string
  ): void {
    const normalizedCStat = String(result.cStat || '').trim();
    if (!['137', '138'].includes(normalizedCStat)) {
      throw new BadRequestException(
        `Distribuicao NF-e retornou cStat ${normalizedCStat || 'desconhecido'} para o CNPJ ${cnpjConsulta}. ${result.xMotivo || 'Sem xMotivo.'}`
      );
    }

    if (result.maxNsu <= 0n && result.ultNsu <= 0n) {
      throw new BadRequestException(
        `Distribuicao NF-e nao retornou NSU base valido para o CNPJ ${cnpjConsulta}. cStat ${normalizedCStat}: ${result.xMotivo || 'Sem xMotivo.'}`
      );
    }
  }

  private resolveCUfAutorFromEstablishment(establishment: {
    municipioCodigoIbge?: string | null;
    cnpj?: string | null;
  }): string | undefined {
    const configured = String(process.env.NFE_DISTRIBUICAO_CUF_AUTOR || '').replace(/\D/g, '');
    if (configured.length === 2) {
      return configured;
    }

    const digits = String(establishment?.municipioCodigoIbge || '').replace(/\D/g, '');
    return digits.length >= 2 ? digits.slice(0, 2) : undefined;
  }

  private assertClientScope(documentClientId: string, clienteId: string): void {
    if (documentClientId !== clienteId) {
      throw new NotFoundException('NF-e nao encontrada para o cliente informado');
    }
  }

  private getSyncSourceMode(): NfeSyncSourceMode {
    const mode = String(process.env.NFE_SYNC_SOURCE_MODE || '').trim().toLowerCase();
    if (mode === 'dominio') {
      return 'dominio';
    }
    if (mode === 'dominio_chave') {
      return 'dominio_chave';
    }
    return 'distribuicao';
  }

  private usesDominioSyncSource(): boolean {
    return this.getSyncSourceMode() !== 'distribuicao';
  }

  private isDominioXmlSyncSource(): boolean {
    return this.getSyncSourceMode() === 'dominio';
  }

  private isDominioChaveSyncSource(): boolean {
    return this.getSyncSourceMode() === 'dominio_chave';
  }

  private assertManualDownloadByKeyEnabled(): void {
    if (!this.usesDominioSyncSource()) {
      throw new BadRequestException(
        'O download manual por chave exige NFE_SYNC_SOURCE_MODE configurado para uma origem da Dominio.'
      );
    }
  }

  private extractModeloFromChave(chaveAcesso?: string | null): string | undefined {
    const normalized = this.normalizeChaveAcesso(chaveAcesso);
    if (!normalized || normalized.length < 22) {
      return undefined;
    }

    return normalized.slice(20, 22);
  }

  private extractPrimaryNumeroNfe(documents: NfeDistribuicaoDocument[]): string | undefined {
    for (const document of documents) {
      try {
        return this.parser.inspect(document.xml).numeroNfe;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private extractPrimarySerie(documents: NfeDistribuicaoDocument[]): string | undefined {
    for (const document of documents) {
      try {
        return this.parser.inspect(document.xml).serie;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private toSafeCatalogoCursor(value?: bigint | null): number {
    if (!value || value <= 0n) {
      return 0;
    }

    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber) || asNumber < 0) {
      throw new Error(`Cursor da Dominio fora do intervalo seguro: ${value.toString()}`);
    }

    return asNumber;
  }

  private decodeXml(xmlBase64: string): string {
    const buffer = Buffer.from(xmlBase64, 'base64');
    const declarationPreview = buffer.toString('latin1', 0, Math.min(buffer.length, 256));
    const declaredEncoding = declarationPreview.match(/encoding=["']([^"']+)["']/i)?.[1]?.trim().toLowerCase();

    if (declaredEncoding && ['iso-8859-1', 'latin1', 'windows-1252'].includes(declaredEncoding)) {
      return buffer.toString('latin1');
    }

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return buffer.toString('latin1');
    }
  }

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private normalizeChaveAcesso(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits.length === 44 ? digits : undefined;
  }

  private normalizeSearchText(value?: string | null): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private toSafeFileName(value?: string | null): string {
    return (
      String(value || 'arquivo')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .toLowerCase() || 'arquivo'
    );
  }

  private toDecimal(value?: string): Prisma.Decimal | undefined {
    if (!value) {
      return undefined;
    }

    return new Prisma.Decimal(value.replace(',', '.'));
  }

  private parsePositiveNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseBoundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  private formatTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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
}
