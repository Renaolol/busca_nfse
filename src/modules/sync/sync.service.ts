import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Ambiente,
  Certificado,
  ClienteEstabelecimento,
  DocumentoOrigem,
  NfseDocumento,
  NfseSyncControle,
  Prisma,
  SyncMode,
  SyncStatus
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdnDFeDocument,
  AdnDFeResult,
  NFSE_ADN_CLIENT,
  NfseAdnClient
} from '../../integrations/nfse-adn/nfse-adn.types';
import { NfseDanfseService } from '../nfse/nfse-danfse.service';
import { NfseService } from '../nfse/nfse.service';
import { NfseXmlParserService, ParsedNfse, ParsedNfseEvento } from '../nfse/nfse-xml-parser.service';
import { LocalStorageService } from '../storage/storage.service';
import { TestSingleNsuDto } from './dto/test-single-nsu.dto';
import { StartSyncDto } from './dto/start-sync.dto';
import { ReprocessPastNsusDto } from './dto/reprocess-past-nsus.dto';
import { StartPastNsuRecoveryExecutionDto } from './dto/start-past-nsu-recovery-execution.dto';

type ReprocessPastNsusDetail = {
  controleId: string;
  clienteId: string;
  cnpjConsulta: string;
  ambiente: Ambiente;
  nsuInicial: string;
  nsuFinal: string;
  nsusAvaliados: number;
  nsusConsultados: number;
  nsusIgnoradosComDocumento: number;
  documentosSalvos: number;
  documentosGapResolvidos: number;
  documentosAdicionaisSalvos: number;
  documentosIgnoradosExistentes: number;
  semDocumento: number;
  falhas: number;
};

type ReprocessPastNsusResult = {
  controlesEncontrados: number;
  controlesProcessados: number;
  nsusAvaliados: number;
  nsusConsultados: number;
  nsusIgnoradosComDocumento: number;
  documentosSalvos: number;
  documentosGapResolvidos: number;
  documentosAdicionaisSalvos: number;
  documentosIgnoradosExistentes: number;
  semDocumento: number;
  falhas: number;
  interrompidoPorRateLimit: boolean;
  ultimaMensagem: string | null;
  detalhes: ReprocessPastNsusDetail[];
};

type PastNsuRecoveryExecutionRowStatus =
  | 'na_fila'
  | 'consultando'
  | 'ja_baixado'
  | 'baixado'
  | 'sem_documento'
  | 'erro';

type PastNsuRecoveryExecutionRowDocumentKind = 'evento' | 'nfse' | null;

type PastNsuRecoveryExecutionRow = {
  id: string;
  controleId: string;
  cnpjConsulta: string;
  ambiente: Ambiente;
  nsu: string;
  status: PastNsuRecoveryExecutionRowStatus;
  documentKind: PastNsuRecoveryExecutionRowDocumentKind;
  chaveAcesso: string | null;
  mensagem: string | null;
};

type PastNsuRecoveryExecutionState = {
  executionId: string;
  clienteId: string;
  requestSignature: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  currentMessage: string | null;
  summary: ReprocessPastNsusResult;
  rows: PastNsuRecoveryExecutionRow[];
};

type NormalizedGapAuditRange = {
  ambiente: Ambiente;
  serie: string | null;
  numeroInicial: number;
  numeroFinal: number;
  quantidade: number;
  label: string;
};

type StoredNfseNumberIndexItem = {
  nsu: bigint;
  numero: number;
  serie: string | null;
};

type PlannedPastNsuRange = {
  nsuInicial: bigint;
  nsuFinal: bigint;
  lacunaLabels: string[];
};

type PreparedPastNsuRecoveryControl = {
  control: NfseSyncControle;
  gaps: NormalizedGapAuditRange[];
  ranges: PlannedPastNsuRange[];
};

type PreparedPastNsuRecoveryPlan = {
  mode: 'full' | 'gap-audit';
  controls: PreparedPastNsuRecoveryControl[];
  currentMessage: string;
};

type PersistDfeDocumentResult = {
  nsu?: bigint;
  kind: 'evento' | 'nfse';
  outcome: 'saved' | 'existing' | 'updated';
  numeroNfse?: string | null;
  serie?: string | null;
};

type NightlySweepConfigFile = {
  enabled?: boolean;
  activeSlots?: string[];
};

type NightlySweepSlot = {
  time: string;
  hour: number;
  minute: number;
};

type AutoEventSyncStateEntry = {
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  lastStatus?: string;
};

type AutoEventSyncStateFile = {
  documents?: Record<string, AutoEventSyncStateEntry>;
};

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private static readonly NIGHTLY_SWEEP_AVAILABLE_SLOTS = ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];
  private static readonly NIGHTLY_SWEEP_CONFIG_STORAGE_KEY = 'settings/nightly-sweep.json';
  private static readonly AUTO_EVENT_SYNC_STATE_STORAGE_KEY = 'settings/nfse-event-auto-sync-state.json';
  private readonly logger = new Logger(SyncService.name);
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private nightlySweepTimer: NodeJS.Timeout | null = null;
  private autoSyncRunning = false;
  private nightlySweepRunning = false;
  private lastNightlySweepExecutionKey: string | null = null;
  private readonly executedNightlySweepKeys = new Set<string>();
  private readonly autoSyncEnabled = process.env.SYNC_AUTO_RUN_ENABLED !== 'false';
  private readonly autoSyncIntervalMs = this.parsePositiveNumberEnv('SYNC_AUTO_RUN_INTERVAL_MS', 30000);
  private readonly autoSyncStartupDelayMs = this.parsePositiveNumberEnv('SYNC_AUTO_RUN_STARTUP_DELAY_MS', 3000);
  private readonly autoEventSyncEnabled = process.env.SYNC_EVENTS_AUTO_RUN_ENABLED !== 'false';
  private readonly autoEventSyncPerControlLimit = this.parsePositiveNumberEnv('SYNC_EVENTS_AUTO_RUN_PER_CONTROL_LIMIT', 2);
  private readonly autoEventSyncCandidateWindow = this.parsePositiveNumberEnv('SYNC_EVENTS_AUTO_RUN_CANDIDATE_WINDOW', 25);
  private readonly autoEventSyncNoEventCooldownMs = this.parsePositiveNumberEnv(
    'SYNC_EVENTS_AUTO_RUN_NO_EVENT_COOLDOWN_MS',
    24 * 60 * 60 * 1000
  );
  private readonly autoEventSyncWithEventCooldownMs = this.parsePositiveNumberEnv(
    'SYNC_EVENTS_AUTO_RUN_WITH_EVENT_COOLDOWN_MS',
    12 * 60 * 60 * 1000
  );
  private readonly autoEventSyncFailureCooldownMs = this.parsePositiveNumberEnv(
    'SYNC_EVENTS_AUTO_RUN_FAILURE_COOLDOWN_MS',
    30 * 60 * 1000
  );
  private readonly autoEventSyncCertificateCooldownMs = this.parsePositiveNumberEnv(
    'SYNC_EVENTS_AUTO_RUN_CERTIFICATE_COOLDOWN_MS',
    6 * 60 * 60 * 1000
  );
  private readonly pastNsuRecoveryExecutions = new Map<string, PastNsuRecoveryExecutionState>();
  private readonly apiRetryDelayMs = this.parsePositiveNumberEnv('SYNC_API_RETRY_DELAY_MS', 120000);
  private readonly dailySyncIntervalMs = this.parsePositiveNumberEnv('SYNC_DAILY_INTERVAL_MS', 24 * 60 * 60 * 1000);
  private readonly dailySyncMaxNsuPerRun = this.parsePositiveNumberEnv('SYNC_DAILY_MAX_NSU_PER_RUN', 10);
  private readonly dailySyncStopOnFirstDocument = process.env.SYNC_DAILY_STOP_ON_FIRST_DOCUMENT === 'true';
  private readonly dailySyncSuccessCooldownMs = this.parsePositiveNumberEnv('SYNC_DAILY_SUCCESS_COOLDOWN_MS', 120000);
  private readonly adnRequestIntervalMs = this.parsePositiveNumberEnv('SYNC_ADN_REQUEST_INTERVAL_MS', 5000);
  private readonly pastNsuRetryCount = this.parseBoundedIntegerEnv('SYNC_PAST_NSU_RETRY_COUNT', 2, 0, 10);
  private readonly pastNsuRetryDelayMs = this.parsePositiveNumberEnv('SYNC_PAST_NSU_RETRY_DELAY_MS', 5000);
  private readonly apiRetryJitterMs = this.parsePositiveNumberEnv('SYNC_API_RETRY_JITTER_MS', 60000);
  private readonly rateLimitGlobalCooldownMs = this.parsePositiveNumberEnv('SYNC_ADN_RATE_LIMIT_COOLDOWN_MS', 300000);
  private readonly controlClaimTtlMs = this.parsePositiveNumberEnv('SYNC_CONTROL_CLAIM_TTL_MS', 10 * 60 * 1000);
  private readonly nsuConflictRetryCount = this.parseBoundedIntegerEnv('SYNC_NSU_CONFLICT_RETRY_COUNT', 2, 0, 10);
  private readonly nsuConflictRetryDelayMs = this.parsePositiveNumberEnv('SYNC_NSU_CONFLICT_RETRY_DELAY_MS', 150);
  private nightlySweepEnabled = process.env.SYNC_NIGHTLY_SWEEP_ENABLED !== 'false';
  private readonly nightlySweepCheckIntervalMs = this.parsePositiveNumberEnv('SYNC_NIGHTLY_SWEEP_CHECK_INTERVAL_MS', 60000);
  private readonly nightlySweepHour = this.parseBoundedIntegerEnv('SYNC_NIGHTLY_SWEEP_HOUR', 2, 0, 23);
  private readonly nightlySweepMinute = this.parseBoundedIntegerEnv('SYNC_NIGHTLY_SWEEP_MINUTE', 0, 0, 59);
  private nightlySweepActiveSlots = this.resolveInitialNightlySweepSlots();
  private readonly nightlySweepTimezoneOffsetMinutes = this.parseBoundedIntegerEnv(
    'SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES',
    -180,
    -720,
    840
  );
  private rateLimitCooldownUntil: Date | null = null;
  private lastAdnRequestAtMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly danfse: NfseDanfseService,
    private readonly parser: NfseXmlParserService,
    private readonly nfseService: NfseService,
    @Inject(NFSE_ADN_CLIENT) private readonly adnClient: NfseAdnClient
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

      this.logger.log(`Execucao automatica de sync habilitada a cada ${this.autoSyncIntervalMs}ms`);
    } else {
      this.logger.log('Execucao automatica de sync desativada (SYNC_AUTO_RUN_ENABLED=false)');
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

  async iniciarSync(clienteId: string, options?: StartSyncDto): Promise<{ controlesCriadosOuAtualizados: number }> {
    await this.ensureClient(clienteId);
    const modoSync = options?.modo === 'diario' ? SyncMode.somente_novas : SyncMode.historico_desde_nsu_1;
    const totalControles = await this.activateSyncControlsForClient(clienteId, modoSync, 'manual');

    await this.runNow();

    return { controlesCriadosOuAtualizados: totalControles };
  }

  async pausarSync(clienteId: string): Promise<{ total: number }> {
    await this.ensureClient(clienteId);
    const result = await this.prisma.nfseSyncControle.updateMany({
      where: { clienteId },
      data: {
        status: SyncStatus.pausado,
        ultimaMensagem: 'Sincronizacao pausada manualmente'
      }
    });

    return { total: result.count };
  }

  async retomarSync(clienteId: string): Promise<{ total: number }> {
    await this.ensureClient(clienteId);
    const result = await this.prisma.nfseSyncControle.updateMany({
      where: { clienteId },
      data: {
        status: SyncStatus.ativo,
        proximaExecucao: null,
        ultimaMensagem: 'Sincronizacao retomada manualmente'
      }
    });

    return { total: result.count };
  }

  async statusSync(clienteId: string) {
    await this.ensureClient(clienteId);

    const controles = await this.prisma.nfseSyncControle.findMany({
      where: { clienteId },
      orderBy: { updatedAt: 'desc' }
    });

    const logs = await this.prisma.nfseSyncLog.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return { controles, logs };
  }

  schedulerStatus(): {
    autoSync: {
      enabled: boolean;
      running: boolean;
      intervalMs: number;
      startupDelayMs: number;
    };
    autoEventSync: {
      enabled: boolean;
      perControlLimit: number;
      candidateWindow: number;
      noEventCooldownMs: number;
      withEventCooldownMs: number;
      failureCooldownMs: number;
      certificateCooldownMs: number;
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
    dailySync: {
      intervalMs: number;
      maxNsuPerRun: number;
      stopOnFirstDocument: boolean;
      successCooldownMs: number;
      requestIntervalMs: number;
      retryDelayMs: number;
      retryJitterMs: number;
      rateLimitCooldownMs: number;
      rateLimitCooldownUntil: string | null;
    };
  } {
    return {
      autoSync: {
        enabled: this.autoSyncEnabled,
        running: this.autoSyncRunning,
        intervalMs: this.autoSyncIntervalMs,
        startupDelayMs: this.autoSyncStartupDelayMs
      },
      autoEventSync: {
        enabled: this.autoEventSyncEnabled,
        perControlLimit: this.autoEventSyncPerControlLimit,
        candidateWindow: this.autoEventSyncCandidateWindow,
        noEventCooldownMs: this.autoEventSyncNoEventCooldownMs,
        withEventCooldownMs: this.autoEventSyncWithEventCooldownMs,
        failureCooldownMs: this.autoEventSyncFailureCooldownMs,
        certificateCooldownMs: this.autoEventSyncCertificateCooldownMs
      },
      nightlySweep: {
        enabled: this.nightlySweepEnabled,
        running: this.nightlySweepRunning,
        hour: this.getReferenceNightlySweepSlot().hour,
        minute: this.getReferenceNightlySweepSlot().minute,
        activeSlots: [...this.nightlySweepActiveSlots],
        availableSlots: [...SyncService.NIGHTLY_SWEEP_AVAILABLE_SLOTS],
        timezoneOffsetMinutes: this.nightlySweepTimezoneOffsetMinutes,
        checkIntervalMs: this.nightlySweepCheckIntervalMs,
        lastRunExecutionKey: this.lastNightlySweepExecutionKey,
        nextRunAt: this.nightlySweepEnabled ? this.resolveNextNightlySweepAt(new Date())?.toISOString() ?? null : null
      },
      dailySync: {
        intervalMs: this.dailySyncIntervalMs,
        maxNsuPerRun: this.dailySyncMaxNsuPerRun,
        stopOnFirstDocument: this.dailySyncStopOnFirstDocument,
        successCooldownMs: this.dailySyncSuccessCooldownMs,
        requestIntervalMs: this.adnRequestIntervalMs,
        retryDelayMs: this.apiRetryDelayMs,
        retryJitterMs: this.apiRetryJitterMs,
        rateLimitCooldownMs: this.rateLimitGlobalCooldownMs,
        rateLimitCooldownUntil: this.rateLimitCooldownUntil?.toISOString() ?? null
      }
    };
  }

  async runNow(): Promise<{ processed: number; documentsSaved: number }> {
    if (this.isRateLimitCooldownActive()) {
      const until = this.rateLimitCooldownUntil;
      this.logger.warn(
        `Consulta ADN pausada por cooldown de rate limit ate ${until ? until.toISOString() : 'desconhecido'}`
      );
      return {
        processed: 0,
        documentsSaved: 0
      };
    }

    const now = new Date();
    const controls = await this.prisma.nfseSyncControle.findMany({
      where: {
        status: SyncStatus.ativo,
        OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }]
      },
      include: {
        estabelecimento: true
      },
      take: 50
    });

    let documentsSaved = 0;
    let rateLimitTriggered = false;

    for (const control of controls) {
      if (rateLimitTriggered) {
        break;
      }

      const claimed = await this.tryClaimDueControl(control.id);
      if (!claimed) {
        this.logger.debug(`Controle ${control.id} ignorado nesta execucao porque ja foi reservado por outro worker.`);
        continue;
      }

      const certificate = await this.prisma.certificado.findFirst({
        where: {
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ativo: true
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!certificate) {
        await this.logSync(control.clienteId, control.id, null, control.ambiente, null, 'erro_certificado', 'Nenhum certificado ativo para o estabelecimento');
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            status: SyncStatus.erro_certificado,
            ultimaMensagem: 'Nenhum certificado ativo encontrado',
            ultimaExecucao: new Date()
          }
        });
        continue;
      }

      if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
        await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, null, 'erro_certificado', 'Certificado vencido');
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            status: SyncStatus.erro_certificado,
            ultimaMensagem: 'Certificado vencido',
            ultimaExecucao: new Date()
          }
        });
        continue;
      }

      const isDailyMode = control.modoSync === SyncMode.somente_novas;
      const maxSteps = isDailyMode ? this.dailySyncMaxNsuPerRun : 1;
      let currentNsu = control.ultimoNsuConsultado;
      let shouldStop = false;
      let documentsSavedForControl = 0;

      for (let step = 0; step < maxSteps && !shouldStop; step += 1) {
        const nextNsu = currentNsu + BigInt(1);
        await this.waitForAdnRequestSlot();
        const result = await this.adnClient.getDFeByNsu({
          cnpjConsulta: control.cnpjConsulta,
          nsu: nextNsu,
          ambiente:
            control.ambiente === Ambiente.producao
              ? NfseAmbiente.PRODUCAO
              : NfseAmbiente.PRODUCAO_RESTRITA,
          certificateId: certificate.id
        });

        if (this.isCertificateDecryptError(result)) {
          const message =
            'Falha ao descriptografar certificado/senha. Verifique CERT_MASTER_KEY e recadastre o certificado.';
          await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, 'erro_certificado', message);
          await this.prisma.nfseSyncControle.update({
            where: { id: control.id },
            data: {
              status: SyncStatus.erro_certificado,
              ultimaExecucao: new Date(),
              proximaExecucao: null,
              ultimaMensagem: message
            }
          });
          shouldStop = true;
          continue;
        }

        if (this.mustRetryWithoutAdvancingNsu(result)) {
          const isRateLimitError = result.statusCode === 429;
          const recoveredAtLeastOneDocument = documentsSavedForControl > 0;
          if (isRateLimitError) {
            this.activateRateLimitCooldown();
            rateLimitTriggered = true;
          }

          const retryAt = this.computeRetryDate(isRateLimitError);
          const rateLimitMessage =
            result.message ??
            (isRateLimitError ? 'Falha na consulta ADN. HTTP 429.' : 'Falha temporaria ao consultar ADN');
          const message = recoveredAtLeastOneDocument
            ? `${rateLimitMessage} Limite temporario apos sincronizacao parcial; retomada agendada automaticamente.`
            : rateLimitMessage;
          const status = isRateLimitError && recoveredAtLeastOneDocument ? 'rate_limit' : 'erro_api';
          await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, status, message);
          await this.prisma.nfseSyncControle.update({
            where: { id: control.id },
            data: {
              ultimaExecucao: new Date(),
              proximaExecucao: retryAt,
              ultimaMensagem: message
            }
          });
          shouldStop = true;
          continue;
        }

        const documents = this.getResultDocuments(result, nextNsu);
        if (!result.hasDocument || documents.length === 0) {
          const nextExecution = isDailyMode ? new Date(Date.now() + this.dailySyncIntervalMs) : null;
          const message =
            result.message ??
            (isDailyMode
              ? 'Sem documento para o NSU informado; proxima busca diaria agendada'
              : 'Sem documento para o NSU informado');
          await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, 'sem_documento', message);
          await this.prisma.nfseSyncControle.update({
            where: { id: control.id },
            data: {
              ultimoNsuConsultado: nextNsu,
              ultimaExecucao: new Date(),
              proximaExecucao: nextExecution,
              ultimaMensagem: message
            }
          });
          currentNsu = nextNsu;
          shouldStop = true;
          continue;
        }

        const persistedDocuments: PersistDfeDocumentResult[] = [];
        try {
          for (const document of documents) {
            const persisted = await this.persistDfeDocumentFromNsu({
              control,
              document
            });
            persistedDocuments.push(persisted);
            await this.logSync(
              control.clienteId,
              control.id,
              certificate.id,
              control.ambiente,
              persisted.nsu ?? nextNsu,
              'sucesso',
              persisted.outcome === 'existing'
                ? persisted.kind === 'evento'
                  ? 'Evento retornado pelo ADN ja estava armazenado'
                  : 'Documento retornado pelo ADN ja estava armazenado'
                : persisted.kind === 'evento'
                  ? 'Evento sincronizado'
                  : 'Documento sincronizado'
            );
          }
        } catch (error) {
          const message = this.toErrorMessage(error);
          await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, 'erro_api', message);
          await this.prisma.nfseSyncControle.update({
            where: { id: control.id },
            data: {
              ultimaExecucao: new Date(),
              proximaExecucao: this.computeRetryDate(false),
              ultimaMensagem: message
            }
          });
          shouldStop = true;
          continue;
        }

        const maxProcessedNsu = persistedDocuments.reduce(
          (max, document) => (document.nsu && document.nsu > max ? document.nsu : max),
          nextNsu
        );
        const savedDocuments = persistedDocuments.filter((document) => document.outcome === 'saved');
        const existingDocuments = persistedDocuments.filter((document) => document.outcome === 'existing');
        const lastKind = persistedDocuments[persistedDocuments.length - 1]?.kind ?? 'nfse';

        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            ultimoNsuConsultado: maxProcessedNsu,
            ultimoNsuComDocumento: maxProcessedNsu,
            ...(savedDocuments.length > 0
              ? {
                  totalDocumentosBaixados: {
                    increment: savedDocuments.length
                  }
                }
              : {}),
            ultimaExecucao: new Date(),
            proximaExecucao:
              isDailyMode && this.dailySyncStopOnFirstDocument
                ? new Date(Date.now() + this.dailySyncSuccessCooldownMs)
                : null,
            ultimaMensagem: this.buildSuccessMessage(savedDocuments.length, existingDocuments.length, lastKind)
          }
        });

        documentsSaved += savedDocuments.length;
        documentsSavedForControl += savedDocuments.length;
        currentNsu = maxProcessedNsu;

        if (isDailyMode && this.dailySyncStopOnFirstDocument) {
          shouldStop = true;
        }
      }

      if (isDailyMode && !this.dailySyncStopOnFirstDocument && !shouldStop && documentsSavedForControl > 0) {
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            proximaExecucao: new Date(Date.now() + this.dailySyncSuccessCooldownMs),
            ultimaMensagem: `Lote diario sincronizado com ${documentsSavedForControl} documento(s); proxima busca agendada`
          }
        });
      }
    }

    return {
      processed: controls.length,
      documentsSaved
    };
  }

  async reprocessPastNsus(options: ReprocessPastNsusDto = {}): Promise<ReprocessPastNsusResult> {
    return this.reprocessPastNsusInternal(options);
  }

  async startPastNsuRecoveryExecution(dto: StartPastNsuRecoveryExecutionDto): Promise<PastNsuRecoveryExecutionState> {
    await this.ensureClient(dto.clienteId);

    const requestOptions: ReprocessPastNsusDto = {
      clienteId: dto.clienteId,
      cnpjConsulta: dto.cnpjConsulta,
      ambiente: dto.ambiente,
      lacunas: dto.lacunas
    };
    const requestSignature = this.buildPastNsuRecoveryRequestSignature(requestOptions);

    const existingRunning = [...this.pastNsuRecoveryExecutions.values()].find(
      (execution) => execution.requestSignature === requestSignature && execution.status === 'running'
    );
    if (existingRunning) {
      return this.clonePastNsuRecoveryExecution(existingRunning);
    }

    const plan = await this.preparePastNsuRecoveryPlan(requestOptions);
    const summary = this.createEmptyReprocessPastNsusResult(plan.controls.length);
    const execution: PastNsuRecoveryExecutionState = {
      executionId: randomUUID(),
      clienteId: dto.clienteId,
      requestSignature,
      status: plan.controls.length > 0 ? 'running' : 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: plan.controls.length > 0 ? null : new Date().toISOString(),
      currentMessage: plan.currentMessage,
      summary,
      rows: this.createPastNsuRecoveryExecutionRows(plan.controls)
    };

    this.pastNsuRecoveryExecutions.set(execution.executionId, execution);

    if (plan.controls.length > 0) {
      void this.runPastNsuRecoveryExecution(execution.executionId, requestOptions, plan);
    }

    return this.clonePastNsuRecoveryExecution(execution);
  }

  getPastNsuRecoveryExecution(executionId: string): PastNsuRecoveryExecutionState {
    const execution = this.pastNsuRecoveryExecutions.get(executionId);
    if (!execution) {
      throw new NotFoundException('Execucao de reprocessamento de NSUs nao encontrada');
    }

    return this.clonePastNsuRecoveryExecution(execution);
  }

  private async reprocessPastNsusInternal(
    options: ReprocessPastNsusDto = {},
    execution?: PastNsuRecoveryExecutionState,
    preparedPlan?: PreparedPastNsuRecoveryPlan
  ): Promise<ReprocessPastNsusResult> {
    const plan = preparedPlan ?? (await this.preparePastNsuRecoveryPlan(options));
    const controls = plan.controls;
    const result = this.createEmptyReprocessPastNsusResult(controls.length);

    if (execution) {
      this.syncPastNsuRecoveryExecution(execution, result, plan.currentMessage);
    }

    for (const controlPlan of controls) {
      const control = controlPlan.control;
      const controlGaps = controlPlan.gaps;
      const plannedRanges = controlPlan.ranges;

      if (this.isRateLimitCooldownActive()) {
        result.interrompidoPorRateLimit = true;
        result.ultimaMensagem = 'Recuperacao interrompida por cooldown de rate limit do ADN';
        if (execution) {
          this.syncPastNsuRecoveryExecution(execution, result, result.ultimaMensagem);
        }
        break;
      }

      const detail = this.createReprocessDetail(control, plannedRanges);
      result.detalhes.push(detail);
      if (execution) {
        this.syncPastNsuRecoveryExecution(
          execution,
          result,
          plan.mode === 'gap-audit'
            ? `Preparando auditoria por NSU para ${control.cnpjConsulta} em ${String(control.ambiente)}.`
            : `Preparando controle ${control.cnpjConsulta} em ${String(control.ambiente)}.`
        );
      }

      if (plannedRanges.length === 0) {
        result.controlesProcessados += 1;
        if (execution) {
          this.syncPastNsuRecoveryExecution(
            execution,
            result,
            `Controle ${control.cnpjConsulta} sem faixa NSU elegivel para avaliar.`
          );
        }
        continue;
      }

      const certificate = await this.prisma.certificado.findFirst({
        where: {
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ativo: true
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!certificate || (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now())) {
        const message = certificate ? 'Certificado vencido' : 'Nenhum certificado ativo para o estabelecimento';
        detail.falhas += 1;
        result.falhas += 1;
        result.ultimaMensagem = message;
        if (execution) {
          for (const range of plannedRanges) {
            for (let nsu = range.nsuInicial; nsu <= range.nsuFinal; nsu += 1n) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
                status: 'erro',
                mensagem: message
              });
            }
          }
          this.syncPastNsuRecoveryExecution(execution, result, message);
        }
        await this.logSync(
          control.clienteId,
          control.id,
          certificate?.id ?? null,
          control.ambiente,
          null,
          'erro_certificado',
          message
        );
        result.controlesProcessados += 1;
        continue;
      }

      let maxRecoveredNsu: bigint | null = null;
      let shouldStopAll = false;

      for (const range of plannedRanges) {
        for (let nsu = range.nsuInicial; nsu <= range.nsuFinal; nsu += 1n) {
          detail.nsusAvaliados += 1;
          result.nsusAvaliados += 1;
          if (execution) {
            this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
              status: 'consultando',
              documentKind: null,
              mensagem: 'Verificando se o NSU ja possui documento salvo...'
            });
            this.syncPastNsuRecoveryExecution(
              execution,
              result,
              `Analisando NSU ${nsu.toString()} para ${control.cnpjConsulta}.`
            );
          }

          if (
            await this.hasFiscalDocumentForNsu({
              clienteId: control.clienteId,
              ambiente: control.ambiente,
              nsu
            })
          ) {
            detail.nsusIgnoradosComDocumento += 1;
            result.nsusIgnoradosComDocumento += 1;
            if (execution) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
                status: 'ja_baixado',
                documentKind: 'nfse',
                mensagem: 'NFS-e deste NSU ja estava armazenada.'
              });
              this.syncPastNsuRecoveryExecution(execution, result, `NSU ${nsu.toString()} ja estava baixado.`);
            }
            continue;
          }

          const { result: dfeResult, attempts } = await this.fetchPastNsuWithRetries({
            cnpjConsulta: control.cnpjConsulta,
            nsu,
            ambiente: this.toNfseAmbiente(control.ambiente),
            certificateId: certificate.id
          });
          detail.nsusConsultados += attempts;
          result.nsusConsultados += attempts;

          if (this.isCertificateDecryptError(dfeResult)) {
            const message =
              'Falha ao descriptografar certificado/senha. Verifique CERT_MASTER_KEY e recadastre o certificado.';
            detail.falhas += 1;
            result.falhas += 1;
            result.ultimaMensagem = message;
            if (execution) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
                status: 'erro',
                documentKind: null,
                mensagem: message
              });
              this.syncPastNsuRecoveryExecution(execution, result, message);
            }
            await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nsu, 'erro_certificado', message);
            break;
          }

          if (this.mustRetryWithoutAdvancingNsu(dfeResult)) {
            const isRateLimitError = dfeResult.statusCode === 429;
            const message =
              dfeResult.message ??
              (isRateLimitError ? 'Falha na consulta ADN. HTTP 429.' : 'Falha temporaria ao consultar ADN');

            if (isRateLimitError) {
              this.activateRateLimitCooldown();
              result.interrompidoPorRateLimit = true;
            }

            detail.falhas += 1;
            result.falhas += 1;
            result.ultimaMensagem = message;
            if (execution) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
                status: 'erro',
                documentKind: null,
                mensagem: message
              });
              this.syncPastNsuRecoveryExecution(execution, result, message);
            }
            await this.logSync(
              control.clienteId,
              control.id,
              certificate.id,
              control.ambiente,
              nsu,
              isRateLimitError ? 'rate_limit' : 'erro_api',
              message
            );

            if (isRateLimitError) {
              shouldStopAll = true;
              break;
            }

            continue;
          }

          const documents = this.getResultDocuments(dfeResult, nsu).filter(
            (document) => !document.nsu || document.nsu <= control.ultimoNsuConsultado
          );
          if (!dfeResult.hasDocument || documents.length === 0) {
            detail.semDocumento += 1;
            result.semDocumento += 1;
            if (execution) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
                status: 'sem_documento',
                documentKind: null,
                chaveAcesso: dfeResult.chaveAcesso ?? null,
                mensagem: dfeResult.message ?? 'NSU sem documento retornado pelo ADN.'
              });
              this.syncPastNsuRecoveryExecution(execution, result, `NSU ${nsu.toString()} nao retornou documento.`);
            }
            continue;
          }

          let requestedNsuResolved = false;
          for (const document of documents) {
            if (
              document.nsu &&
              (await this.hasFiscalDocumentForNsu({
                clienteId: control.clienteId,
                ambiente: control.ambiente,
                nsu: document.nsu
              }))
            ) {
              detail.documentosIgnoradosExistentes += 1;
              result.documentosIgnoradosExistentes += 1;
              requestedNsuResolved = requestedNsuResolved || document.nsu === nsu;
              const documentKind = this.inferDfeDocumentKind(document);
              if (execution) {
                this.updatePastNsuRecoveryExecutionRow(execution, control.id, document.nsu ?? nsu, {
                  status: 'ja_baixado',
                  documentKind,
                  mensagem:
                    documentKind === 'evento'
                      ? 'Evento deste NSU ja estava armazenado.'
                      : 'Documento retornado pelo ADN ja estava armazenado.',
                  chaveAcesso: dfeResult.chaveAcesso ?? null
                });
                this.syncPastNsuRecoveryExecution(
                  execution,
                  result,
                  `NSU ${(document.nsu ?? nsu).toString()} retornou documento ja existente.`
                );
              }
              continue;
            }

            const persisted = await this.persistDfeDocumentFromNsu({
              control,
              document
            });
            const persistedNsu = persisted.nsu ?? nsu;
            if (persisted.outcome === 'existing' || persisted.outcome === 'updated') {
              detail.documentosIgnoradosExistentes += 1;
              result.documentosIgnoradosExistentes += 1;
              requestedNsuResolved = requestedNsuResolved || persistedNsu === nsu;
              if (execution) {
                this.updatePastNsuRecoveryExecutionRow(execution, control.id, persistedNsu, {
                  status: 'ja_baixado',
                  documentKind: persisted.kind,
                  mensagem:
                    persisted.outcome === 'updated'
                      ? persisted.kind === 'evento'
                        ? 'Evento deste lote ja existia e teve apenas o registro atualizado.'
                        : 'Documento deste lote ja existia e teve apenas o registro atualizado.'
                      : persisted.kind === 'evento'
                        ? 'Evento retornado pelo ADN ja estava armazenado.'
                        : 'Documento retornado pelo ADN ja estava armazenado.',
                  chaveAcesso: dfeResult.chaveAcesso ?? null
                });
                this.syncPastNsuRecoveryExecution(
                  execution,
                  result,
                  persisted.outcome === 'updated'
                    ? `NSU ${persistedNsu.toString()} retornou documento ja existente com atualizacao de registro.`
                    : `NSU ${persistedNsu.toString()} retornou documento ja existente.`
                );
              }
              continue;
            }
            requestedNsuResolved = requestedNsuResolved || persistedNsu === nsu;
            maxRecoveredNsu =
              maxRecoveredNsu && maxRecoveredNsu > persistedNsu ? maxRecoveredNsu : persistedNsu;
            detail.documentosSalvos += 1;
            result.documentosSalvos += 1;
            if (this.matchesPersistedDocumentToGap(persisted, controlGaps)) {
              detail.documentosGapResolvidos += 1;
              result.documentosGapResolvidos += 1;
            } else {
              detail.documentosAdicionaisSalvos += 1;
              result.documentosAdicionaisSalvos += 1;
            }
            if (execution) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, persistedNsu, {
                status: 'baixado',
                documentKind: persisted.kind,
                mensagem:
                  persisted.kind === 'evento'
                    ? 'Evento recuperado com sucesso para este NSU.'
                    : 'Documento recuperado com sucesso para este NSU.',
                chaveAcesso: dfeResult.chaveAcesso ?? null
              });
              this.syncPastNsuRecoveryExecution(
                execution,
                result,
                `NSU ${persistedNsu.toString()} recuperado com sucesso.`
              );
            }
            await this.logSync(
              control.clienteId,
              control.id,
              certificate.id,
              control.ambiente,
              persistedNsu,
              'sucesso',
              persisted.kind === 'evento'
                ? 'Evento recuperado no reprocessamento de NSUs passados'
                : 'Documento recuperado no reprocessamento de NSUs passados'
            );
          }

          if (!requestedNsuResolved) {
            detail.semDocumento += 1;
            result.semDocumento += 1;
            if (execution) {
              this.updatePastNsuRecoveryExecutionRow(execution, control.id, nsu, {
                status: 'sem_documento',
                documentKind: null,
                chaveAcesso: dfeResult.chaveAcesso ?? null,
                mensagem: this.buildIndirectNsuDocumentMessage(nsu, documents)
              });
              this.syncPastNsuRecoveryExecution(
                execution,
                result,
                `NSU ${nsu.toString()} retornou apenas documentos vinculados a outros NSUs.`
              );
            }
          }
        }

        if (shouldStopAll) {
          break;
        }
      }

      await this.updateControlAfterPastNsuReprocess(control, detail, maxRecoveredNsu);
      result.controlesProcessados += 1;
      if (execution) {
        this.syncPastNsuRecoveryExecution(
          execution,
          result,
          plan.mode === 'gap-audit'
            ? `Controle ${control.cnpjConsulta} finalizado com ${detail.documentosGapResolvidos} lacuna(s) resolvida(s) e ${detail.documentosAdicionaisSalvos} XML(s) adicional(is).`
            : `Controle ${control.cnpjConsulta} finalizado com ${detail.documentosSalvos} documento(s) salvo(s).`
        );
      }

      if (shouldStopAll) {
        break;
      }
    }

    if (!result.ultimaMensagem) {
      result.ultimaMensagem =
        plan.mode === 'gap-audit'
          ? `Auditoria concluida com ${result.documentosGapResolvidos} lacuna(s) resolvida(s) e ${result.documentosAdicionaisSalvos} XML(s) adicional(is) salvo(s).`
          : `Recuperacao concluida com ${result.documentosSalvos} documento(s) salvo(s)`;
    }

    if (execution) {
      this.syncPastNsuRecoveryExecution(execution, result, result.ultimaMensagem);
    }

    return result;
  }

  async testSingleNsu(dto: TestSingleNsuDto): Promise<{
    clienteId: string;
    estabelecimentoId: string;
    ambiente: Ambiente;
    cnpjConsulta: string;
    nsu: string;
    hasDocument: boolean;
    chaveAcesso: string | null;
    statusCode: number;
    message: string | null;
    xml: string | null;
    rawResponse: unknown;
  }> {
    await this.ensureClient(dto.clienteId);
    const establishment = await this.ensureEstablishmentBelongsToClient(dto.clienteId, dto.estabelecimentoId);
    const certificate = await this.findUsableCertificate(dto.clienteId, dto.estabelecimentoId);
    const nsu = this.parseNsu(dto.nsu);
    const ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;

    await this.waitForAdnRequestSlot();
    const result = await this.adnClient.getDFeByNsu({
      cnpjConsulta: establishment.cnpj,
      nsu,
      ambiente: this.toNfseAmbiente(ambiente),
      certificateId: certificate.id
    });

    return {
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      cnpjConsulta: establishment.cnpj,
      nsu: nsu.toString(),
      hasDocument: result.hasDocument,
      chaveAcesso: result.chaveAcesso ?? null,
      statusCode: result.statusCode,
      message: result.message ?? null,
      xml: result.xml ?? null,
      rawResponse: result.rawResponse
    };
  }

  async listLogs(clienteId: string) {
    if (!clienteId) {
      throw new BadRequestException('clienteId obrigatorio para consulta de logs');
    }

    await this.ensureClient(clienteId);

    return this.prisma.nfseSyncLog.findMany({
      where: {
        clienteId
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }

  async updateSchedulerSettings(params: { enabled?: boolean; activeSlots?: string[] }) {
    if (typeof params.enabled === 'boolean') {
      this.nightlySweepEnabled = params.enabled;
    }

    if (params.activeSlots) {
      this.nightlySweepActiveSlots = this.normalizeNightlySweepSlots(params.activeSlots);
    }

    await this.persistNightlySweepConfig();
    this.refreshNightlySweepTimer();
    return this.schedulerStatus();
  }

  private async activateSyncControlsForClient(
    clienteId: string,
    modoSync: SyncMode,
    origem: 'manual' | 'noturna'
  ): Promise<number> {
    const establishments = await this.prisma.clienteEstabelecimento.findMany({
      where: { clienteId, ativo: true }
    });

    for (const establishment of establishments) {
      const existingControl = await this.prisma.nfseSyncControle.findUnique({
        where: {
          clienteId_cnpjConsulta_ambiente: {
            clienteId,
            cnpjConsulta: establishment.cnpj,
            ambiente: Ambiente.producao
          }
        }
      });

      if (existingControl) {
        await this.prisma.nfseSyncControle.update({
          where: { id: existingControl.id },
          data: {
            clienteId,
            estabelecimentoId: establishment.id,
            status: SyncStatus.ativo,
            modoSync,
            proximaExecucao: this.buildActivationSchedule(origem),
            ultimaMensagem: this.buildActivationMessage(modoSync, origem)
          }
        });
        continue;
      }

      const initialNsu =
        modoSync === SyncMode.somente_novas
          ? await this.resolveInitialNsuForOnlyNew(clienteId, establishment.cnpj, Ambiente.producao)
          : BigInt(0);

      await this.prisma.nfseSyncControle.create({
        data: {
          clienteId,
          estabelecimentoId: establishment.id,
          cnpjConsulta: establishment.cnpj,
          ambiente: Ambiente.producao,
          ultimoNsuConsultado: initialNsu,
          ultimoNsuComDocumento: initialNsu,
          nsuInicial: initialNsu + BigInt(1),
          modoSync,
          status: SyncStatus.ativo,
          proximaExecucao: this.buildActivationSchedule(origem),
          ultimaMensagem: this.buildActivationMessage(modoSync, origem)
        }
      });
    }

    return establishments.length;
  }

  private async tryRunNightlySweep(): Promise<void> {
    if (this.nightlySweepRunning) {
      return;
    }

    const localReference = this.getNightlyReferenceDate(new Date());
    const currentSlot = this.formatTime(localReference.getUTCHours(), localReference.getUTCMinutes());
    const dateKey = this.toDateKey(localReference);
    this.pruneNightlySweepExecutionKeys(dateKey);

    if (!this.nightlySweepEnabled || !this.nightlySweepActiveSlots.includes(currentSlot)) {
      return;
    }

    const executionKey = `${dateKey}T${currentSlot}`;
    if (this.executedNightlySweepKeys.has(executionKey)) {
      return;
    }

    this.executedNightlySweepKeys.add(executionKey);
    this.lastNightlySweepExecutionKey = executionKey;
    this.nightlySweepRunning = true;

    try {
      await this.runNightlySweepForAllClients();
    } catch (error) {
      this.logger.error(`Falha na busca noturna automatica: ${this.toErrorMessage(error)}`);
    } finally {
      this.nightlySweepRunning = false;
    }
  }

  private async runNightlySweepForAllClients(): Promise<void> {
    const clients = await this.prisma.cliente.findMany({
      select: { id: true }
    });

    if (clients.length === 0) {
      this.logger.log('Busca noturna: nenhum cliente cadastrado.');
      return;
    }

    let totalControlesAtivados = 0;
    let totalFalhas = 0;

    for (const client of clients) {
      try {
        totalControlesAtivados += await this.activateSyncControlsForClient(client.id, SyncMode.somente_novas, 'noturna');
      } catch (error) {
        totalFalhas += 1;
        this.logger.warn(
          `Busca noturna: falha ao ativar sync diario para cliente ${client.id}: ${this.toErrorMessage(error)}`
        );
      }
    }

    this.logger.log(
      `Busca noturna: clientes=${clients.length}, controles_ativados=${totalControlesAtivados}, falhas=${totalFalhas}`
    );

    if (totalControlesAtivados > 0) {
      await this.runAutomaticSyncCycle();
    }
  }

  private buildActivationMessage(modoSync: SyncMode, origem: 'manual' | 'noturna'): string {
    if (modoSync === SyncMode.somente_novas) {
      return origem === 'noturna'
        ? 'Sincronizacao diaria ativada automaticamente pela busca noturna'
        : 'Sincronizacao diaria ativada manualmente';
    }

    return origem === 'noturna'
      ? 'Sincronizacao ativada automaticamente pela busca noturna'
      : 'Sincronizacao ativada manualmente';
  }

  private buildActivationSchedule(origem: 'manual' | 'noturna'): Date | null {
    if (origem !== 'noturna') {
      return null;
    }

    const jitterMs = Math.floor(Math.random() * 5 * 60 * 1000);
    return new Date(Date.now() + jitterMs);
  }

  private async ensureClient(clienteId: string): Promise<void> {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!client) {
      throw new NotFoundException('Cliente nao encontrado');
    }
  }

  private async ensureEstablishmentBelongsToClient(
    clienteId: string,
    estabelecimentoId: string
  ): Promise<ClienteEstabelecimento> {
    const establishment = await this.prisma.clienteEstabelecimento.findUnique({
      where: { id: estabelecimentoId }
    });

    if (!establishment || establishment.clienteId !== clienteId) {
      throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
    }

    if (!establishment.ativo) {
      throw new BadRequestException('Estabelecimento inativo');
    }

    return establishment;
  }

  private async findUsableCertificate(clienteId: string, estabelecimentoId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findFirst({
      where: {
        clienteId,
        estabelecimentoId,
        ativo: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!certificate) {
      throw new BadRequestException('Nenhum certificado ativo para o estabelecimento');
    }

    if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
      throw new BadRequestException('Certificado vencido');
    }

    return certificate;
  }

  private parseNsu(value: string): bigint {
    try {
      const nsu = BigInt(value);
      if (nsu < 0n) {
        throw new BadRequestException('NSU deve ser maior ou igual a zero');
      }

      return nsu;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('NSU invalido');
    }
  }

  private toNfseAmbiente(ambiente: Ambiente): NfseAmbiente {
    return ambiente === Ambiente.producao ? NfseAmbiente.PRODUCAO : NfseAmbiente.PRODUCAO_RESTRITA;
  }

  private resolveNfseAmbienteFromParsed(parsed: Pick<ParsedNfse, 'tpAmb'> | null | undefined, fallback: Ambiente): Ambiente {
    if (parsed?.tpAmb === '1') {
      return Ambiente.producao;
    }

    if (parsed?.tpAmb === '2') {
      return Ambiente.producao_restrita;
    }

    return fallback;
  }

  private async resolveInitialNsuForOnlyNew(clienteId: string, cnpjConsulta: string, ambiente: Ambiente): Promise<bigint> {
    const documento = await this.prisma.nfseDocumento.findFirst({
      where: {
        clienteId,
        ambiente,
        nsu: {
          not: null
        },
        OR: [{ cnpjPrestador: cnpjConsulta }, { cnpjTomador: cnpjConsulta }]
      },
      orderBy: {
        nsu: 'desc'
      },
      select: {
        nsu: true
      }
    });

    return documento?.nsu ?? BigInt(0);
  }

  private async runAutomaticSyncCycle(): Promise<void> {
    if (this.autoSyncRunning) {
      return;
    }

    this.autoSyncRunning = true;
    try {
      await this.runNow();
      if (this.autoEventSyncEnabled && !this.isRateLimitCooldownActive()) {
        await this.runAutomaticEventSyncCycle();
      }
    } catch (error) {
      this.logger.error(`Falha na execucao automatica de sync: ${this.toErrorMessage(error)}`);
    } finally {
      this.autoSyncRunning = false;
    }
  }

  private async runAutomaticEventSyncCycle(): Promise<void> {
    const controls = await this.prisma.nfseSyncControle.findMany({
      where: {
        status: SyncStatus.ativo
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: 50
    });

    if (!controls.length) {
      return;
    }

    const now = new Date();
    const state = await this.loadAutoEventSyncState();
    const documentsState = state.documents ?? (state.documents = {});
    let stateChanged = false;

    for (const control of controls) {
      if (this.isRateLimitCooldownActive()) {
        break;
      }

      const candidates = await this.findEligibleDocumentsForAutomaticEventSync(control, state, now);
      if (!candidates.length) {
        continue;
      }

      const summary = await this.nfseService.sincronizarEventos({
        clienteId: control.clienteId,
        estabelecimentoId: control.estabelecimentoId,
        ambiente: control.ambiente === Ambiente.producao ? 'producao' : 'producao_restrita',
        documentoIds: candidates.map((doc) => doc.id),
        somenteSemEventos: false,
        limit: candidates.length
      });

      for (const detail of summary.detalhes) {
        const doc = candidates.find((candidate) => candidate.id === detail.documentoId);
        if (!doc) {
          continue;
        }

        const nextAttemptAt = this.resolveAutomaticEventNextAttemptAt(doc, detail, now);
        documentsState[doc.id] = {
          nextAttemptAt: nextAttemptAt.toISOString(),
          lastAttemptAt: now.toISOString(),
          lastStatus: detail.status
        };
        stateChanged = true;

        if (this.isRateLimitMessage(detail.mensagem)) {
          this.activateRateLimitCooldown();
        }
      }
    }

    if (stateChanged) {
      await this.saveAutoEventSyncState(state);
    }
  }

  private async findEligibleDocumentsForAutomaticEventSync(
    control: Pick<NfseSyncControle, 'clienteId' | 'estabelecimentoId' | 'ambiente'>,
    state: AutoEventSyncStateFile,
    now: Date
  ): Promise<
    Array<{
      id: string;
      status: string | null;
      dataCancelamento: Date | null;
      createdAt: Date;
      updatedAt: Date;
      eventos: Array<{ tipoEvento: string | null; descricao: string | null; dataEvento: Date | null }>;
    }>
  > {
    const docs = await this.prisma.nfseDocumento.findMany({
      where: {
        clienteId: control.clienteId,
        estabelecimentoId: control.estabelecimentoId,
        ambiente: control.ambiente,
        xmlPath: {
          not: null
        }
      },
      select: {
        id: true,
        status: true,
        dataCancelamento: true,
        createdAt: true,
        updatedAt: true,
        eventos: {
          select: {
            tipoEvento: true,
            descricao: true,
            dataEvento: true
          },
          orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
        }
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: this.autoEventSyncCandidateWindow
    });

    return docs
      .filter((doc) => !this.hasDocumentoCancelamento(doc))
      .filter((doc) => this.isAutomaticEventSyncAttemptDue(doc.id, state, now))
      .sort((left, right) => {
        const leftHasEvents = left.eventos.length > 0 ? 1 : 0;
        const rightHasEvents = right.eventos.length > 0 ? 1 : 0;
        return leftHasEvents - rightHasEvents || left.updatedAt.getTime() - right.updatedAt.getTime();
      })
      .slice(0, this.autoEventSyncPerControlLimit);
  }

  private hasDocumentoCancelamento(doc: {
    status?: string | null;
    dataCancelamento?: Date | null;
    eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
  }): boolean {
    return (
      this.normalizeSearchText(doc.status ?? undefined) === 'cancelada' ||
      Boolean(doc.dataCancelamento) ||
      (doc.eventos ?? []).some((evento) => this.isEventoCancelamento(evento))
    );
  }

  private isAutomaticEventSyncAttemptDue(docId: string, state: AutoEventSyncStateFile, now: Date): boolean {
    const nextAttemptAt = state.documents?.[docId]?.nextAttemptAt;
    if (!nextAttemptAt) {
      return true;
    }

    const timestamp = Date.parse(nextAttemptAt);
    return !Number.isFinite(timestamp) || timestamp <= now.getTime();
  }

  private resolveAutomaticEventNextAttemptAt(
    doc: { eventos?: Array<unknown> },
    detail: {
      status: 'sincronizado' | 'sem_eventos' | 'nao_localizado_endpoint_eventos' | 'falha_api' | 'falha_certificado';
      mensagem?: string;
    },
    now: Date
  ): Date {
    if (detail.status === 'falha_certificado') {
      return new Date(now.getTime() + this.autoEventSyncCertificateCooldownMs);
    }

    if (detail.status === 'falha_api' || detail.status === 'nao_localizado_endpoint_eventos') {
      return new Date(now.getTime() + this.autoEventSyncFailureCooldownMs);
    }

    if (detail.status === 'sincronizado' && (doc.eventos?.length ?? 0) > 0) {
      return new Date(now.getTime() + this.autoEventSyncWithEventCooldownMs);
    }

    if (detail.status === 'sincronizado') {
      return new Date(now.getTime() + this.autoEventSyncWithEventCooldownMs);
    }

    return new Date(now.getTime() + this.autoEventSyncNoEventCooldownMs);
  }

  private async loadAutoEventSyncState(): Promise<AutoEventSyncStateFile> {
    try {
      const raw = await this.storage.getObject(SyncService.AUTO_EVENT_SYNC_STATE_STORAGE_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as AutoEventSyncStateFile;
      return {
        documents: parsed.documents ?? {}
      };
    } catch (error) {
      const message = this.toErrorMessage(error);
      if (message.includes('ENOENT')) {
        return { documents: {} };
      }

      this.logger.warn(`Falha ao carregar estado da rotina automatica de eventos: ${message}`);
      return { documents: {} };
    }
  }

  private async saveAutoEventSyncState(state: AutoEventSyncStateFile): Promise<void> {
    await this.storage.putObject(
      SyncService.AUTO_EVENT_SYNC_STATE_STORAGE_KEY,
      JSON.stringify(
        {
          documents: state.documents ?? {}
        } satisfies AutoEventSyncStateFile,
        null,
        2
      )
    );
  }

  private isRateLimitMessage(message?: string | null): boolean {
    return this.normalizeSearchText(message ?? undefined).includes('http 429');
  }

  private createEmptyReprocessPastNsusResult(controlesEncontrados: number): ReprocessPastNsusResult {
    return {
      controlesEncontrados,
      controlesProcessados: 0,
      nsusAvaliados: 0,
      nsusConsultados: 0,
      nsusIgnoradosComDocumento: 0,
      documentosSalvos: 0,
      documentosGapResolvidos: 0,
      documentosAdicionaisSalvos: 0,
      documentosIgnoradosExistentes: 0,
      semDocumento: 0,
      falhas: 0,
      interrompidoPorRateLimit: false,
      ultimaMensagem: null,
      detalhes: []
    };
  }

  private async preparePastNsuRecoveryPlan(options: ReprocessPastNsusDto = {}): Promise<PreparedPastNsuRecoveryPlan> {
    if (options.clienteId) {
      await this.ensureClient(options.clienteId);
    }

    const normalizedGaps = this.normalizeGapAuditRanges(options.lacunas);
    const cnpjConsulta = this.normalizeCnpj(options.cnpjConsulta);
    const where: Prisma.NfseSyncControleWhereInput = {};

    if (options.clienteId) {
      where.clienteId = options.clienteId;
    }

    if (cnpjConsulta) {
      where.cnpjConsulta = cnpjConsulta;
    }

    if (options.ambiente) {
      where.ambiente = options.ambiente;
    } else if (normalizedGaps.length > 0) {
      const ambientes = [...new Set(normalizedGaps.map((gap) => gap.ambiente))];
      where.ambiente = ambientes.length === 1 ? ambientes[0] : { in: ambientes };
    }

    const controls = await this.prisma.nfseSyncControle.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }]
    });

    if (normalizedGaps.length === 0) {
      return {
        mode: 'full',
        controls: controls.map((control) => ({
          control,
          gaps: [],
          ranges:
            control.ultimoNsuConsultado >= 1n
              ? [
                  {
                    nsuInicial: 1n,
                    nsuFinal: control.ultimoNsuConsultado,
                    lacunaLabels: []
                  }
                ]
              : []
        })),
        currentMessage:
          controls.length > 0
            ? 'Preparando reprocessamento dos NSUs do cliente...'
            : 'Nenhum controle encontrado para este cliente.'
      };
    }

    const preparedControls: PreparedPastNsuRecoveryControl[] = [];

    for (const control of controls) {
      const controlGaps = normalizedGaps.filter((gap) => gap.ambiente === control.ambiente);
      if (controlGaps.length === 0) {
        continue;
      }

      const storedDocs = await this.prisma.nfseDocumento.findMany({
        where: {
          clienteId: control.clienteId,
          ambiente: control.ambiente,
          cnpjPrestador: control.cnpjConsulta,
          nsu: {
            not: null
          },
          numeroNfse: {
            not: null
          }
        },
        select: {
          nsu: true,
          numeroNfse: true,
          serie: true
        },
        orderBy: [{ nsu: 'asc' }]
      });

      const ranges = this.buildGapAuditRangesForControl(control, controlGaps, storedDocs);
      if (ranges.length > 0) {
        preparedControls.push({
          control,
          gaps: controlGaps,
          ranges
        });
      }
    }

    return {
      mode: 'gap-audit',
      controls: preparedControls,
      currentMessage:
        preparedControls.length > 0
          ? 'Preparando auditoria das lacunas pelos NSUs provaveis...'
          : 'Nenhuma faixa NSU provavel foi encontrada para as lacunas informadas.'
    };
  }

  private normalizeGapAuditRanges(gaps?: Array<{
    ambiente?: Ambiente;
    serie?: string | null;
    numeroInicial?: number;
    numeroFinal?: number;
  }>): NormalizedGapAuditRange[] {
    const normalized: NormalizedGapAuditRange[] = [];

    for (const gap of gaps ?? []) {
      const numeroInicial = Math.trunc(Number(gap?.numeroInicial || 0));
      const numeroFinal = Math.trunc(Number(gap?.numeroFinal || 0));
      if (numeroInicial <= 0 || numeroFinal < numeroInicial) {
        continue;
      }

      const serie = this.normalizeSerie(gap?.serie);
      const ambiente = gap?.ambiente === Ambiente.producao_restrita ? Ambiente.producao_restrita : Ambiente.producao;
      normalized.push({
        ambiente,
        serie,
        numeroInicial,
        numeroFinal,
        quantidade: numeroFinal - numeroInicial + 1,
        label: this.buildGapLabel({
          ambiente,
          serie,
          numeroInicial,
          numeroFinal
        })
      });
    }

    return normalized;
  }

  private buildGapAuditRangesForControl(
    control: Pick<NfseSyncControle, 'ultimoNsuConsultado'>,
    gaps: NormalizedGapAuditRange[],
    storedDocs: Array<{ nsu: bigint | null; numeroNfse: string | null; serie: string | null }>
  ): PlannedPastNsuRange[] {
    const index = this.buildStoredNfseNumberIndex(storedDocs);
    const ranges = gaps
      .map((gap) => this.inferGapAuditRange(control, gap, index))
      .filter((range): range is PlannedPastNsuRange => Boolean(range));

    return this.mergePlannedPastNsuRanges(ranges);
  }

  private buildStoredNfseNumberIndex(
    storedDocs: Array<{ nsu: bigint | null; numeroNfse: string | null; serie: string | null }>
  ): Map<string, StoredNfseNumberIndexItem[]> {
    const grouped = new Map<string, StoredNfseNumberIndexItem[]>();

    for (const doc of storedDocs) {
      if (doc.nsu == null) {
        continue;
      }

      const numero = this.parseNumeroNfse(doc.numeroNfse);
      if (!numero) {
        continue;
      }

      const serie = this.normalizeSerie(doc.serie);
      const key = serie ?? '';
      const items = grouped.get(key) ?? [];
      items.push({
        nsu: doc.nsu,
        numero,
        serie
      });
      grouped.set(key, items);
    }

    for (const items of grouped.values()) {
      items.sort((left, right) => left.numero - right.numero || (left.nsu < right.nsu ? -1 : left.nsu > right.nsu ? 1 : 0));
    }

    return grouped;
  }

  private inferGapAuditRange(
    control: Pick<NfseSyncControle, 'ultimoNsuConsultado'>,
    gap: NormalizedGapAuditRange,
    index: Map<string, StoredNfseNumberIndexItem[]>
  ): PlannedPastNsuRange | null {
    const items = index.get(gap.serie ?? '') ?? [];
    const lower = [...items].reverse().find((item) => item.numero < gap.numeroInicial);
    const upper = items.find((item) => item.numero > gap.numeroFinal);
    const trailingFallbackWindow = Math.min(250, Math.max(60, gap.quantidade * 20));

    if (lower && upper && upper.nsu > lower.nsu) {
      const nsuDistance = this.toSafeNumber(upper.nsu - lower.nsu);
      if (nsuDistance <= 250) {
        return this.createPlannedPastNsuRange(lower.nsu + 1n, upper.nsu - 1n, gap.label);
      }

      const numeroDistance = upper.numero - lower.numero;
      const buffer = Math.max(10, Math.min(60, gap.quantidade * 8));
      if (numeroDistance > 0) {
        const startApprox = this.toSafeNumber(lower.nsu) + Math.floor(((gap.numeroInicial - lower.numero) / numeroDistance) * nsuDistance);
        const endApprox = this.toSafeNumber(lower.nsu) + Math.ceil(((gap.numeroFinal - lower.numero) / numeroDistance) * nsuDistance);
        return this.createPlannedPastNsuRange(
          BigInt(Math.max(this.toSafeNumber(lower.nsu) + 1, startApprox - buffer)),
          BigInt(Math.min(this.toSafeNumber(upper.nsu) - 1, endApprox + buffer)),
          gap.label
        );
      }
    }

    if (lower) {
      return this.createPlannedPastNsuRange(
        lower.nsu + 1n,
        this.minBigInt(control.ultimoNsuConsultado, lower.nsu + BigInt(trailingFallbackWindow)),
        gap.label
      );
    }

    if (upper) {
      return this.createPlannedPastNsuRange(
        this.maxBigInt(1n, upper.nsu - BigInt(trailingFallbackWindow)),
        upper.nsu - 1n,
        gap.label
      );
    }

    if (control.ultimoNsuConsultado < 1n) {
      return null;
    }

    return this.createPlannedPastNsuRange(
      this.maxBigInt(1n, control.ultimoNsuConsultado - BigInt(trailingFallbackWindow - 1)),
      control.ultimoNsuConsultado,
      gap.label
    );
  }

  private createPlannedPastNsuRange(nsuInicial: bigint, nsuFinal: bigint, lacunaLabel: string): PlannedPastNsuRange | null {
    if (nsuFinal < nsuInicial) {
      return null;
    }

    return {
      nsuInicial,
      nsuFinal,
      lacunaLabels: lacunaLabel ? [lacunaLabel] : []
    };
  }

  private mergePlannedPastNsuRanges(ranges: PlannedPastNsuRange[]): PlannedPastNsuRange[] {
    if (ranges.length === 0) {
      return [];
    }

    const sorted = [...ranges].sort((left, right) =>
      left.nsuInicial < right.nsuInicial ? -1 : left.nsuInicial > right.nsuInicial ? 1 : 0
    );
    const merged: PlannedPastNsuRange[] = [];

    for (const range of sorted) {
      const current = merged[merged.length - 1];
      if (!current) {
        merged.push({
          ...range,
          lacunaLabels: [...range.lacunaLabels]
        });
        continue;
      }

      if (range.nsuInicial <= current.nsuFinal + 1n) {
        current.nsuFinal = this.maxBigInt(current.nsuFinal, range.nsuFinal);
        current.lacunaLabels = [...new Set([...current.lacunaLabels, ...range.lacunaLabels])];
        continue;
      }

      merged.push({
        ...range,
        lacunaLabels: [...range.lacunaLabels]
      });
    }

    return merged;
  }

  private buildPastNsuRecoveryRequestSignature(options: ReprocessPastNsusDto): string {
    const clienteId = String(options.clienteId || '').trim();
    const cnpjConsulta = this.normalizeCnpj(options.cnpjConsulta) ?? '';
    const ambiente = options.ambiente ?? '';
    const gaps = this.normalizeGapAuditRanges(options.lacunas)
      .map((gap) => `${gap.ambiente}:${gap.serie ?? ''}:${gap.numeroInicial}-${gap.numeroFinal}`)
      .join('|');
    return `${clienteId}:${cnpjConsulta}:${ambiente}:${gaps || 'full'}`;
  }

  private buildGapLabel(params: {
    ambiente: Ambiente;
    serie: string | null;
    numeroInicial: number;
    numeroFinal: number;
  }): string {
    const prefix = params.serie ? `Serie ${params.serie}` : 'Serie padrao';
    const range = params.numeroInicial === params.numeroFinal ? String(params.numeroInicial) : `${params.numeroInicial} a ${params.numeroFinal}`;
    return `${prefix} (${params.ambiente}): ${range}`;
  }

  private matchesPersistedDocumentToGap(
    persisted: Pick<PersistDfeDocumentResult, 'kind' | 'numeroNfse' | 'serie'>,
    gaps: NormalizedGapAuditRange[]
  ): boolean {
    if (persisted.kind !== 'nfse') {
      return false;
    }

    const numero = this.parseNumeroNfse(persisted.numeroNfse);
    if (!numero) {
      return false;
    }

    const serie = this.normalizeSerie(persisted.serie);
    return gaps.some((gap) => gap.serie === serie && numero >= gap.numeroInicial && numero <= gap.numeroFinal);
  }

  private createPastNsuRecoveryExecutionRows(
    controls: PreparedPastNsuRecoveryControl[]
  ): PastNsuRecoveryExecutionRow[] {
    const rows: PastNsuRecoveryExecutionRow[] = [];

    for (const { control, ranges } of controls) {
      for (const range of ranges) {
        const waitingMessage = range.lacunaLabels.length > 0 ? `Aguardando processamento deste NSU. ${range.lacunaLabels.join(' • ')}` : 'Aguardando processamento deste NSU.';
        for (let nsu = range.nsuInicial; nsu <= range.nsuFinal; nsu += 1n) {
          rows.push({
            id: `${control.id}:${nsu.toString()}`,
            controleId: control.id,
            cnpjConsulta: control.cnpjConsulta,
            ambiente: control.ambiente,
            nsu: nsu.toString(),
            status: 'na_fila',
            documentKind: null,
            chaveAcesso: null,
            mensagem: waitingMessage
          });
        }
      }
    }

    return rows;
  }

  private updatePastNsuRecoveryExecutionRow(
    execution: PastNsuRecoveryExecutionState,
    controleId: string,
    nsu: bigint,
    patch: Partial<Omit<PastNsuRecoveryExecutionRow, 'id' | 'controleId' | 'cnpjConsulta' | 'ambiente' | 'nsu'>>
  ): void {
    const rowId = `${controleId}:${nsu.toString()}`;
    const row = execution.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    Object.assign(row, patch);
  }

  private cloneReprocessPastNsusResult(result: ReprocessPastNsusResult): ReprocessPastNsusResult {
    return {
      ...result,
      detalhes: result.detalhes.map((detail) => ({ ...detail }))
    };
  }

  private clonePastNsuRecoveryExecution(execution: PastNsuRecoveryExecutionState): PastNsuRecoveryExecutionState {
    return {
      ...execution,
      summary: this.cloneReprocessPastNsusResult(execution.summary),
      rows: execution.rows.map((row) => ({ ...row }))
    };
  }

  private syncPastNsuRecoveryExecution(
    execution: PastNsuRecoveryExecutionState,
    result: ReprocessPastNsusResult,
    currentMessage?: string | null
  ): void {
    execution.summary = this.cloneReprocessPastNsusResult(result);
    execution.currentMessage = currentMessage ?? result.ultimaMensagem ?? execution.currentMessage;
  }

  private async runPastNsuRecoveryExecution(
    executionId: string,
    options: ReprocessPastNsusDto,
    preparedPlan?: PreparedPastNsuRecoveryPlan
  ): Promise<void> {
    const execution = this.pastNsuRecoveryExecutions.get(executionId);
    if (!execution) {
      return;
    }

    try {
      const result = await this.reprocessPastNsusInternal(options, execution, preparedPlan);
      execution.status = 'completed';
      execution.finishedAt = new Date().toISOString();
      execution.summary = this.cloneReprocessPastNsusResult(result);
      execution.currentMessage = result.ultimaMensagem;
    } catch (error) {
      execution.status = 'failed';
      execution.finishedAt = new Date().toISOString();
      execution.currentMessage = this.toErrorMessage(error);
      execution.summary = {
        ...execution.summary,
        falhas: execution.summary.falhas + 1,
        ultimaMensagem: execution.currentMessage
      };
    }
  }

  private createReprocessDetail(control: NfseSyncControle, ranges: PlannedPastNsuRange[]): ReprocessPastNsusDetail {
    const firstRange = ranges[0];
    const lastRange = ranges[ranges.length - 1];
    return {
      controleId: control.id,
      clienteId: control.clienteId,
      cnpjConsulta: control.cnpjConsulta,
      ambiente: control.ambiente,
      nsuInicial: firstRange?.nsuInicial?.toString() ?? '0',
      nsuFinal: lastRange?.nsuFinal?.toString() ?? '0',
      nsusAvaliados: 0,
      nsusConsultados: 0,
      nsusIgnoradosComDocumento: 0,
      documentosSalvos: 0,
      documentosGapResolvidos: 0,
      documentosAdicionaisSalvos: 0,
      documentosIgnoradosExistentes: 0,
      semDocumento: 0,
      falhas: 0
    };
  }

  private async hasFiscalDocumentForNsu(params: {
    clienteId: string;
    ambiente: Ambiente;
    nsu: bigint;
  }): Promise<boolean> {
    const document = await this.prisma.nfseDocumento.findFirst({
      where: {
        clienteId: params.clienteId,
        ambiente: params.ambiente,
        nsu: params.nsu
      },
      select: {
        xmlPath: true,
        numeroNfse: true,
        dataEmissao: true
      }
    });

    return Boolean(document && this.hasDocumentoFiscalData(document));
  }

  private async updateControlAfterPastNsuReprocess(
    control: NfseSyncControle,
    detail: ReprocessPastNsusDetail,
    maxRecoveredNsu: bigint | null
  ): Promise<void> {
    const message =
      detail.documentosGapResolvidos > 0 || detail.documentosAdicionaisSalvos > 0
        ? `Auditoria de lacunas por NSU: ${detail.documentosGapResolvidos} lacuna(s) resolvida(s), ${detail.documentosAdicionaisSalvos} XML(s) adicional(is), ${detail.semDocumento} NSU(s) sem documento proprio.`
        : `Recuperacao de NSUs passados: ${detail.documentosSalvos} documento(s) salvo(s), ${detail.nsusIgnoradosComDocumento + detail.documentosIgnoradosExistentes} ja existente(s), ${detail.semDocumento} sem documento.`;
    const data: Prisma.NfseSyncControleUpdateInput = {
      ultimaExecucao: new Date(),
      ultimaMensagem: message
    };

    if (detail.documentosSalvos > 0) {
      data.totalDocumentosBaixados = {
        increment: detail.documentosSalvos
      };
    }

    if (maxRecoveredNsu && maxRecoveredNsu > control.ultimoNsuComDocumento) {
      data.ultimoNsuComDocumento = maxRecoveredNsu;
    }

    await this.prisma.nfseSyncControle.update({
      where: { id: control.id },
      data
    });
  }

  private getResultDocuments(result: AdnDFeResult, requestedNsu: bigint): AdnDFeDocument[] {
    const documents = (result.documents ?? []).filter((document) => document.xml.trim());
    if (documents.length > 0) {
      return documents.map((document) => ({
        ...document,
        nsu: document.nsu ?? (documents.length === 1 ? requestedNsu : undefined)
      }));
    }

    if (!result.xml?.trim()) {
      return [];
    }

    return [
      {
        nsu: result.nsu ?? requestedNsu,
        xml: result.xml,
        chaveAcesso: result.chaveAcesso,
        message: result.message
      }
    ];
  }

  private async persistDfeDocumentFromNsu(params: {
    control: {
      clienteId: string;
      estabelecimentoId: string;
      cnpjConsulta: string;
      ambiente: Ambiente;
    };
    document: AdnDFeDocument;
  }): Promise<PersistDfeDocumentResult> {
    let chave = params.document.chaveAcesso;
    let parsedXml: ParsedNfse | null = null;
    let parsedEvento: ParsedNfseEvento | null = null;

    try {
      const parsedAny = this.parser.parseAny(params.document.xml);
      if (parsedAny.kind === 'evento') {
        parsedEvento = parsedAny.evento;
        chave = parsedEvento.chaveAcesso;
      } else {
        parsedXml = parsedAny.nfse;
        chave = parsedXml.chaveAcesso;
      }
    } catch (error) {
      this.logger.warn(`Falha ao parsear XML da chave ${chave ?? 'desconhecida'}: ${this.toErrorMessage(error)}`);
    }

    if (!chave) {
      throw new Error('Nao foi possivel localizar chave de acesso no XML retornado pelo ADN');
    }

    if (parsedEvento) {
      const hash = this.parser.getHash(params.document.xml);
      await this.persistEventoFromNsu({
        control: params.control,
        nsu: params.document.nsu,
        xml: params.document.xml,
        evento: parsedEvento,
        hash
      });

      return {
        nsu: params.document.nsu,
        kind: 'evento',
        outcome: 'saved',
        numeroNfse: null,
        serie: null
      };
    }

    const hash = this.parser.getHash(params.document.xml);
    const effectiveAmbiente = this.resolveNfseAmbienteFromParsed(parsedXml, params.control.ambiente);
    const existingDocument = await this.prisma.nfseDocumento.findFirst({
      where: {
        clienteId: params.control.clienteId,
        chaveAcesso: chave
      },
      select: {
        id: true,
        ambiente: true,
        status: true,
        dataCancelamento: true,
        nsu: true,
        xmlPath: true,
        numeroNfse: true,
        dataEmissao: true,
        hashXml: true
      }
    });
    const hadPersistedFiscalData = Boolean(existingDocument && this.hasDocumentoFiscalData(existingDocument));
    if (this.shouldSkipPersistedDocumento(existingDocument, hash, params.document.nsu)) {
      return {
        nsu: params.document.nsu ?? existingDocument?.nsu ?? undefined,
        kind: 'nfse',
        outcome: 'existing',
        numeroNfse: parsedXml?.numeroNfse ?? existingDocument?.numeroNfse ?? null,
        serie: parsedXml?.serie ?? null
      };
    }
    if (existingDocument?.ambiente && existingDocument.ambiente !== effectiveAmbiente) {
      this.logger.warn(
        `NFS-e ${chave} recebida via NSU com tpAmb=${parsedXml?.tpAmb ?? 'desconhecido'}; corrigindo ambiente de ${existingDocument.ambiente} para ${effectiveAmbiente}.`
      );
    }
    const normalizedStatus = this.normalizeStatus(parsedXml?.status) ?? 'autorizada';
    const isCanceledDocument =
      normalizedStatus === 'cancelada' ||
      existingDocument?.status === 'cancelada' ||
      Boolean(existingDocument?.dataCancelamento);
    const documentStatus = isCanceledDocument ? 'cancelada' : normalizedStatus;
    const documentCancelamentoDate = existingDocument?.dataCancelamento;

    const dataReferencia = parsedXml?.dataEmissao ?? new Date();
    const competencia =
      parsedXml?.competencia ??
      (parsedXml?.dataEmissao
        ? new Date(Date.UTC(parsedXml.dataEmissao.getUTCFullYear(), parsedXml.dataEmissao.getUTCMonth(), 1))
        : undefined);
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const cnpjPasta =
      this.normalizeCnpj(parsedXml?.cnpjPrestador) ??
      this.normalizeCnpj(parsedXml?.cnpjTomador) ??
      params.control.cnpjConsulta;
    const xmlKey = `nfse/${effectiveAmbiente}/${cnpjPasta}/${year}/${month}/xml/${chave}.xml`;
    await this.storage.putObject(xmlKey, params.document.xml);
    const danfseKey = `nfse/${effectiveAmbiente}/${cnpjPasta}/${year}/${month}/danfse/${chave}.pdf`;
    const municipioFallback = await this.buildDanfseMunicipioFallback({
      cnpjPrestador: parsedXml?.cnpjPrestador ?? params.control.cnpjConsulta,
      cnpjTomador: parsedXml?.cnpjTomador,
      municipioPrestacaoCodigo: parsedXml?.municipioPrestacaoCodigo,
      municipioPrestacaoNome: parsedXml?.municipioPrestacaoNome
    });
    const danfsePdf = this.danfse.generateFromXml(params.document.xml, {
      chaveAcesso: chave,
      numeroNfse: parsedXml?.numeroNfse,
      dataEmissao: parsedXml?.dataEmissao,
      status: this.normalizeStatus(parsedXml?.status),
      cnpjPrestador: parsedXml?.cnpjPrestador ?? params.control.cnpjConsulta,
      razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
      cnpjTomador: parsedXml?.cnpjTomador,
      razaoSocialTomador: parsedXml?.razaoSocialTomador,
      ...municipioFallback,
      valorServico: parsedXml?.valorServico,
      descricaoServico: parsedXml?.descricaoServico
    });
    await this.storage.putObject(danfseKey, danfsePdf);
    const updateData: Prisma.NfseDocumentoUncheckedUpdateInput = {
      nsu: params.document.nsu,
      numeroNfse: parsedXml?.numeroNfse,
      serie: parsedXml?.serie,
      dataEmissao: parsedXml?.dataEmissao,
      competencia,
      dataCancelamento: documentCancelamentoDate,
      status: documentStatus,
      cnpjPrestador: parsedXml?.cnpjPrestador ?? params.control.cnpjConsulta,
      razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
      cnpjTomador: parsedXml?.cnpjTomador,
      razaoSocialTomador: parsedXml?.razaoSocialTomador,
      municipioPrestacaoCodigo: parsedXml?.municipioPrestacaoCodigo,
      municipioPrestacaoNome: parsedXml?.municipioPrestacaoNome,
      valorServico: this.toDecimal(parsedXml?.valorServico),
      valorDeducoes: this.toDecimal(parsedXml?.valorDeducoes),
      valorIss: this.toDecimal(parsedXml?.valorIss),
      aliquotaIss: this.toDecimal(parsedXml?.aliquotaIss),
      codigoServicoNacional: parsedXml?.codigoServicoNacional,
      itemListaServico: parsedXml?.itemListaServico,
      descricaoServico: parsedXml?.descricaoServico,
      chaveSubstituida: parsedXml?.chaveSubstituida ?? null,
      xmlPath: xmlKey,
      danfsePath: isCanceledDocument ? null : danfseKey,
      hashXml: hash,
      origem: DocumentoOrigem.adn_nsu,
      updatedAt: new Date()
    };
    const createData: Prisma.NfseDocumentoUncheckedCreateInput = {
      clienteId: params.control.clienteId,
      estabelecimentoId: params.control.estabelecimentoId,
      ambiente: effectiveAmbiente,
      nsu: params.document.nsu,
      chaveAcesso: chave,
      numeroNfse: parsedXml?.numeroNfse,
      serie: parsedXml?.serie,
      dataEmissao: parsedXml?.dataEmissao,
      competencia,
      dataCancelamento: documentCancelamentoDate,
      status: documentStatus,
      cnpjPrestador: parsedXml?.cnpjPrestador ?? params.control.cnpjConsulta,
      razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
      cnpjTomador: parsedXml?.cnpjTomador,
      razaoSocialTomador: parsedXml?.razaoSocialTomador,
      municipioPrestacaoCodigo: parsedXml?.municipioPrestacaoCodigo,
      municipioPrestacaoNome: parsedXml?.municipioPrestacaoNome,
      valorServico: this.toDecimal(parsedXml?.valorServico),
      valorDeducoes: this.toDecimal(parsedXml?.valorDeducoes),
      valorIss: this.toDecimal(parsedXml?.valorIss),
      aliquotaIss: this.toDecimal(parsedXml?.aliquotaIss),
      codigoServicoNacional: parsedXml?.codigoServicoNacional,
      itemListaServico: parsedXml?.itemListaServico,
      descricaoServico: parsedXml?.descricaoServico,
      chaveSubstituida: parsedXml?.chaveSubstituida ?? null,
      xmlPath: xmlKey,
      danfsePath: isCanceledDocument ? null : danfseKey,
      hashXml: hash,
      origem: DocumentoOrigem.adn_nsu
    };

    await this.upsertDocumentoResolvingNsuConflict({
      ambiente: effectiveAmbiente,
      clienteId: params.control.clienteId,
      chaveAcesso: chave,
      nsu: params.document.nsu,
      updateData,
      createData
    });

    return {
      nsu: params.document.nsu,
      kind: 'nfse',
      outcome: hadPersistedFiscalData ? 'updated' : 'saved',
      numeroNfse: parsedXml?.numeroNfse ?? null,
      serie: parsedXml?.serie ?? null
    };
  }

  private buildSuccessMessage(savedCount: number, existingCount: number, kind: 'evento' | 'nfse'): string {
    if (savedCount === 0 && existingCount > 0) {
      return existingCount === 1
        ? kind === 'evento'
          ? 'Evento ja existente'
          : 'Documento ja existente'
        : `Lote ADN sem novos documentos; ${existingCount} item(ns) ja existia(m)`;
    }

    if (savedCount === 1) {
      return kind === 'evento' ? 'Evento sincronizado com sucesso' : 'Documento sincronizado com sucesso';
    }

    return `Lote ADN sincronizado com ${savedCount} documento(s)`;
  }

  private buildIndirectNsuDocumentMessage(requestedNsu: bigint, documents: AdnDFeDocument[]): string {
    const relatedNsus = [...new Set(documents.map((document) => document.nsu).filter((nsu): nsu is bigint => nsu !== undefined))];
    const onlyEventos = documents.length > 0 && documents.every((document) => this.inferDfeDocumentKind(document) === 'evento');

    if (relatedNsus.length === 0) {
      return onlyEventos
        ? `O ADN retornou apenas eventos no lote, mas nenhum item trouxe NSU individual para associacao ao NSU ${requestedNsu.toString()}.`
        : `O ADN retornou documentos no lote, mas nenhum item trouxe NSU individual para associacao ao NSU ${requestedNsu.toString()}.`;
    }

    const nsuList = relatedNsus.map((nsu) => nsu.toString()).join(', ');
    return onlyEventos
      ? `O ADN retornou apenas eventos vinculados aos NSUs ${nsuList}; nenhum item ficou associado ao NSU ${requestedNsu.toString()}.`
      : `O ADN retornou apenas documentos vinculados aos NSUs ${nsuList}; nenhum item ficou associado ao NSU ${requestedNsu.toString()}.`;
  }

  private inferDfeDocumentKind(document: Pick<AdnDFeDocument, 'xml'>): Exclude<PastNsuRecoveryExecutionRowDocumentKind, null> {
    return this.parser.isEventoXml(document.xml) ? 'evento' : 'nfse';
  }

  private async persistEventoFromNsu(params: {
    control: {
      clienteId: string;
      estabelecimentoId: string;
      cnpjConsulta: string;
      ambiente: Ambiente;
    };
    nsu?: bigint;
    xml: string;
    evento: ParsedNfseEvento;
    hash: string;
  }): Promise<void> {
    const existing = await this.findDocumentoForEvento({
      clienteId: params.control.clienteId,
      chaveAcesso: params.evento.chaveAcesso,
      ambientePreferencial: params.control.ambiente
    });
    const ambiente = existing?.ambiente ?? params.control.ambiente;
    const dataReferencia = params.evento.dataEvento ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const cnpjPasta =
      this.normalizeCnpj(params.evento.cnpjAutor) ??
      this.normalizeCnpj(existing?.cnpjPrestador) ??
      this.normalizeCnpj(existing?.cnpjTomador) ??
      params.control.cnpjConsulta;
    const xmlKey = `nfse/${ambiente}/${cnpjPasta}/${year}/${month}/eventos/${this.toSafeFileName(
      params.evento.chaveAcesso
    )}_${this.toSafeFileName(params.evento.tipoEvento)}.xml`;

    await this.storage.putObject(xmlKey, params.xml);

    const cancelamentoData = this.buildCancelamentoDocumentoData(params.evento);
    const nfse = await this.upsertDocumentoResolvingNsuConflict({
      ambiente,
      clienteId: params.control.clienteId,
      chaveAcesso: params.evento.chaveAcesso,
      nsu: params.nsu,
      updateData: {
        clienteId: params.control.clienteId,
        estabelecimentoId: params.control.estabelecimentoId,
        ...cancelamentoData
      },
      createData: {
        clienteId: params.control.clienteId,
        estabelecimentoId: params.control.estabelecimentoId,
        ambiente,
        nsu: params.nsu,
        chaveAcesso: params.evento.chaveAcesso,
        ...cancelamentoData,
        origem: DocumentoOrigem.adn_nsu
      }
    });

    const tipoEvento = params.evento.tipoEvento || 'evento';
    const dataEvento = params.evento.dataEvento ?? new Date(0);
    await this.prisma.nfseEvento.upsert({
      where: {
        chaveAcesso_tipoEvento_dataEvento_hashXml: {
          chaveAcesso: params.evento.chaveAcesso,
          tipoEvento,
          dataEvento,
          hashXml: params.hash
        }
      },
      update: {
        nfseDocumentoId: nfse.id,
        descricao: params.evento.descricao,
        xmlPath: xmlKey
      },
      create: {
        nfseDocumentoId: nfse.id,
        chaveAcesso: params.evento.chaveAcesso,
        tipoEvento,
        dataEvento,
        descricao: params.evento.descricao,
        xmlPath: xmlKey,
        hashXml: params.hash
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

  private shouldSkipPersistedDocumento(
    doc:
      | Pick<NfseDocumento, 'nsu' | 'xmlPath' | 'numeroNfse' | 'dataEmissao' | 'hashXml'>
      | null
      | undefined,
    incomingHash: string,
    incomingNsu?: bigint
  ): boolean {
    if (!doc || !this.hasDocumentoFiscalData(doc)) {
      return false;
    }

    if (doc.hashXml && doc.hashXml !== incomingHash) {
      return false;
    }

    return incomingNsu === undefined || doc.nsu === incomingNsu;
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

  private async upsertDocumentoResolvingNsuConflict(params: {
    ambiente: Ambiente;
    clienteId: string;
    chaveAcesso: string;
    nsu?: bigint;
    updateData: Prisma.NfseDocumentoUncheckedUpdateInput;
    createData: Prisma.NfseDocumentoUncheckedCreateInput;
  }): Promise<NfseDocumento> {
    const resolvedExisting = await this.resolveExistingDocumentoBeforeUpsert(params);
    if (resolvedExisting) {
      return resolvedExisting;
    }

    for (let attempt = 0; attempt <= this.nsuConflictRetryCount; attempt += 1) {
      try {
        return await this.prisma.nfseDocumento.upsert({
          where: {
            ambiente_chaveAcesso: {
              ambiente: params.ambiente,
              chaveAcesso: params.chaveAcesso
            }
          },
          update: params.updateData,
          create: params.createData
        });
      } catch (error) {
        if (!this.isUniqueConstraintViolation(error) || params.nsu === undefined) {
          throw error;
        }

        const reconciled = await this.tryReconcileDocumentoByNsu(params);
        if (reconciled) {
          return reconciled;
        }

        if (attempt >= this.nsuConflictRetryCount) {
          throw error;
        }

        await this.sleep(this.nsuConflictRetryDelayMs * (attempt + 1));
      }
    }

    throw new Error('Falha inesperada ao reconciliar documento por NSU');
  }

  private async resolveExistingDocumentoBeforeUpsert(params: {
    ambiente: Ambiente;
    clienteId: string;
    chaveAcesso: string;
    nsu?: bigint;
    updateData: Prisma.NfseDocumentoUncheckedUpdateInput;
    createData: Prisma.NfseDocumentoUncheckedCreateInput;
  }): Promise<NfseDocumento | null> {
    const existingByChave = await this.prisma.nfseDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: params.chaveAcesso
        }
      },
      select: {
        id: true,
        chaveAcesso: true
      }
    });

    if (params.nsu === undefined) {
      if (!existingByChave) {
        return null;
      }

      return this.updateDocumentoById(existingByChave.id, params);
    }

    const existingByNsu = await this.prisma.nfseDocumento.findUnique({
      where: {
        clienteId_ambiente_nsu: {
          clienteId: params.clienteId,
          ambiente: params.ambiente,
          nsu: params.nsu
        }
      },
      select: {
        id: true,
        chaveAcesso: true
      }
    });

    if (!existingByChave && !existingByNsu) {
      return null;
    }

    if (existingByChave && existingByNsu && existingByChave.id !== existingByNsu.id) {
      await this.mergeDocumentoDuplicates({
        canonicalId: existingByChave.id,
        duplicateId: existingByNsu.id,
        ambiente: params.ambiente,
        nsu: params.nsu,
        chaveAnterior: existingByNsu.chaveAcesso,
        chaveAtual: params.chaveAcesso
      });

      return this.updateDocumentoById(existingByChave.id, params);
    }

    const target = existingByChave ?? existingByNsu;
    if (!target) {
      return null;
    }

    if (existingByNsu && existingByNsu.chaveAcesso !== params.chaveAcesso) {
      this.logger.warn(
        `Documento reconciliado por NSU ${params.nsu.toString()} em ${params.ambiente}; chave anterior ${existingByNsu.chaveAcesso}, nova chave ${params.chaveAcesso}`
      );
      await this.detachStaleEventosOnIdentityChange(target.id, params.chaveAcesso);
      return this.updateDocumentoById(target.id, params, { identityChanged: true });
    }

    return this.updateDocumentoById(target.id, params);
  }

  private async tryReconcileDocumentoByNsu(params: {
    ambiente: Ambiente;
    clienteId: string;
    chaveAcesso: string;
    nsu?: bigint;
    updateData: Prisma.NfseDocumentoUncheckedUpdateInput;
    createData: Prisma.NfseDocumentoUncheckedCreateInput;
  }): Promise<NfseDocumento | null> {
    if (params.nsu === undefined) {
      return null;
    }

    const nsu = params.nsu;
    const existing = await this.prisma.nfseDocumento.findUnique({
      where: {
        clienteId_ambiente_nsu: {
          clienteId: params.clienteId,
          ambiente: params.ambiente,
          nsu
        }
      },
      select: {
        id: true,
        chaveAcesso: true
      }
    });

    if (!existing) {
      return null;
    }

    this.logger.warn(
      `Documento reconciliado por NSU ${nsu.toString()} em ${params.ambiente}; chave anterior ${existing.chaveAcesso}, nova chave ${params.chaveAcesso}`
    );

    await this.detachStaleEventosOnIdentityChange(existing.id, params.chaveAcesso);

    try {
      return await this.prisma.nfseDocumento.update({
        where: { id: existing.id },
        data: {
          ...params.updateData,
          clienteId: params.createData.clienteId,
          estabelecimentoId: params.createData.estabelecimentoId,
          ambiente: params.ambiente,
          nsu,
          chaveAcesso: params.chaveAcesso,
          dataCancelamento: params.updateData.dataCancelamento ?? null,
          origem: params.createData.origem
        }
      });
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }

      return this.prisma.nfseDocumento.findUnique({
        where: {
          ambiente_chaveAcesso: {
            ambiente: params.ambiente,
            chaveAcesso: params.chaveAcesso
          }
        }
      });
    }
  }

  private async updateDocumentoById(
    documentoId: string,
    params: {
      ambiente: Ambiente;
      chaveAcesso: string;
      nsu?: bigint;
      updateData: Prisma.NfseDocumentoUncheckedUpdateInput;
      createData: Prisma.NfseDocumentoUncheckedCreateInput;
    },
    options: { identityChanged?: boolean } = {}
  ): Promise<NfseDocumento> {
    return this.prisma.nfseDocumento.update({
      where: { id: documentoId },
      data: {
        ...params.updateData,
        clienteId: params.createData.clienteId,
        estabelecimentoId: params.createData.estabelecimentoId,
        ambiente: params.ambiente,
        nsu: params.nsu,
        chaveAcesso: params.chaveAcesso,
        origem: params.createData.origem,
        ...(options.identityChanged ? { dataCancelamento: params.updateData.dataCancelamento ?? null } : {})
      }
    });
  }

  /**
   * Ao reaproveitar uma linha de NfseDocumento existente para representar uma chave de acesso
   * diferente (colisao de NSU), qualquer NfseEvento ja vinculado aquele id pertence a identidade
   * ANTERIOR da linha. Sem essa limpeza, o novo documento herdaria eventos (ex: cancelamento) que
   * nunca ocorreram para ele.
   */
  private async detachStaleEventosOnIdentityChange(documentoId: string, novaChaveAcesso: string): Promise<void> {
    const removed = await this.prisma.nfseEvento.deleteMany({
      where: {
        nfseDocumentoId: documentoId,
        chaveAcesso: { not: novaChaveAcesso }
      }
    });

    if (removed.count > 0) {
      this.logger.warn(
        `Removidos ${removed.count} evento(s) orfao(s) do documento ${documentoId} ao reconciliar por NSU para a chave ${novaChaveAcesso}.`
      );
    }
  }

  private async mergeDocumentoDuplicates(params: {
    canonicalId: string;
    duplicateId: string;
    ambiente: Ambiente;
    nsu: bigint;
    chaveAnterior: string;
    chaveAtual: string;
  }): Promise<void> {
    const relinked = await this.prisma.nfseEvento.updateMany({
      where: {
        nfseDocumentoId: params.duplicateId,
        chaveAcesso: params.chaveAtual
      },
      data: {
        nfseDocumentoId: params.canonicalId
      }
    });

    const removed = await this.prisma.nfseEvento.deleteMany({
      where: {
        nfseDocumentoId: params.duplicateId
      }
    });

    await this.prisma.nfseDocumento.delete({
      where: {
        id: params.duplicateId
      }
    });

    this.logger.warn(
      `Documento duplicado mesclado por NSU ${params.nsu.toString()} em ${params.ambiente}; chave antiga ${params.chaveAnterior}, chave canonica ${params.chaveAtual}. ` +
        `Eventos realocados: ${relinked.count}, eventos orfaos removidos: ${removed.count}.`
    );
  }

  private isUniqueConstraintViolation(error: unknown): error is { code: string } {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return false;
    }

    return error.code === 'P2002';
  }

  private async tryClaimDueControl(controlId: string): Promise<boolean> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.controlClaimTtlMs);
    const result = await this.prisma.nfseSyncControle.updateMany({
      where: {
        id: controlId,
        status: SyncStatus.ativo,
        OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }]
      },
      data: {
        proximaExecucao: leaseUntil
      }
    });

    return result.count > 0;
  }

  private async waitForAdnRequestSlot(): Promise<void> {
    if (this.adnRequestIntervalMs <= 0) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastAdnRequestAtMs;
    if (elapsed < this.adnRequestIntervalMs) {
      await this.sleep(this.adnRequestIntervalMs - elapsed);
    }

    this.lastAdnRequestAtMs = Date.now();
  }

  private async fetchPastNsuWithRetries(params: {
    cnpjConsulta: string;
    nsu: bigint;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<{ result: AdnDFeResult; attempts: number }> {
    const maxAttempts = this.pastNsuRetryCount + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForAdnRequestSlot();
      const result = await this.adnClient.getDFeByNsu(params);

      if (!this.shouldRetryPastNsuRequest(result) || attempt === maxAttempts) {
        return { result, attempts: attempt };
      }

      this.logger.warn(
        `Reprocessamento ADN falhou temporariamente para o NSU ${params.nsu.toString()} do CNPJ ${params.cnpjConsulta}; tentativa ${attempt} de ${maxAttempts}. Nova tentativa em ${this.pastNsuRetryDelayMs}ms.`
      );
      await this.sleep(this.pastNsuRetryDelayMs);
    }

    return {
      result: {
        nsu: params.nsu,
        hasDocument: false,
        statusCode: 0,
        message: 'Falha temporaria ao consultar ADN',
        rawResponse: null
      },
      attempts: maxAttempts
    };
  }

  private computeRetryDate(rateLimited: boolean): Date {
    const nowMs = Date.now();
    const jitterMs = rateLimited ? Math.floor(Math.random() * this.apiRetryJitterMs) : 0;
    let retryAtMs = nowMs + this.apiRetryDelayMs + jitterMs;

    if (rateLimited && this.rateLimitCooldownUntil) {
      retryAtMs = Math.max(retryAtMs, this.rateLimitCooldownUntil.getTime());
    }

    return new Date(retryAtMs);
  }

  private activateRateLimitCooldown(): void {
    const nextCooldown = new Date(Date.now() + this.rateLimitGlobalCooldownMs);
    if (!this.rateLimitCooldownUntil || nextCooldown.getTime() > this.rateLimitCooldownUntil.getTime()) {
      this.rateLimitCooldownUntil = nextCooldown;
    }

    this.logger.warn(
      `ADN retornou 429. Novas consultas ficarao pausadas ate ${this.rateLimitCooldownUntil.toISOString()}`
    );
  }

  private isRateLimitCooldownActive(): boolean {
    if (!this.rateLimitCooldownUntil) {
      return false;
    }

    if (this.rateLimitCooldownUntil.getTime() <= Date.now()) {
      this.rateLimitCooldownUntil = null;
      return false;
    }

    return true;
  }

  private mustRetryWithoutAdvancingNsu(result: AdnDFeResult): boolean {
    if (result.hasDocument) {
      return false;
    }

    if (result.statusCode === 429 || result.statusCode === 0) {
      return true;
    }

    return result.statusCode >= 500;
  }

  private shouldRetryPastNsuRequest(result: AdnDFeResult): boolean {
    return this.mustRetryWithoutAdvancingNsu(result) && result.statusCode !== 429 && !this.isCertificateDecryptError(result);
  }

  private isCertificateDecryptError(result: AdnDFeResult): boolean {
    if (result.hasDocument || result.statusCode !== 0) {
      return false;
    }

    const message = (result.message ?? '').toLowerCase();
    return (
      message.includes('falha ao descriptografar certificado/senha') ||
      message.includes('unable to authenticate data') ||
      message.includes('unsupported state or unable to authenticate data')
    );
  }

  private parsePositiveNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }

  private parseBoundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return fallback;
    }

    return parsed;
  }

  private getNightlyReferenceDate(now: Date): Date {
    return new Date(now.getTime() + this.nightlySweepTimezoneOffsetMinutes * 60 * 1000);
  }

  private toDateKey(referenceDate: Date): string {
    const year = referenceDate.getUTCFullYear();
    const month = String(referenceDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(referenceDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private resolveNextNightlySweepAt(now: Date): Date | null {
    if (!this.nightlySweepEnabled || this.nightlySweepActiveSlots.length === 0) {
      return null;
    }

    const localReference = this.getNightlyReferenceDate(now);
    let nextRunAt: Date | null = null;

    for (const slot of this.getActiveNightlySweepSlots()) {
      let targetLocalUtcMs = Date.UTC(
        localReference.getUTCFullYear(),
        localReference.getUTCMonth(),
        localReference.getUTCDate(),
        slot.hour,
        slot.minute,
        0,
        0
      );
      let targetActualMs = targetLocalUtcMs - this.nightlySweepTimezoneOffsetMinutes * 60 * 1000;

      if (targetActualMs <= now.getTime()) {
        targetLocalUtcMs += 24 * 60 * 60 * 1000;
        targetActualMs = targetLocalUtcMs - this.nightlySweepTimezoneOffsetMinutes * 60 * 1000;
      }

      const candidate = new Date(targetActualMs);
      if (!nextRunAt || candidate.getTime() < nextRunAt.getTime()) {
        nextRunAt = candidate;
      }
    }

    return nextRunAt;
  }

  private refreshNightlySweepTimer(): void {
    if (this.nightlySweepEnabled) {
      if (!this.nightlySweepTimer) {
        this.nightlySweepTimer = setInterval(() => {
          void this.tryRunNightlySweep();
        }, this.nightlySweepCheckIntervalMs);
        this.nightlySweepTimer.unref?.();
        const nightlySweepStartupTimer = setTimeout(() => {
          void this.tryRunNightlySweep();
        }, 5000);
        nightlySweepStartupTimer.unref?.();
      }

      this.logger.log(
        `Busca noturna habilitada para ${this.describeNightlySweepSlots()} (UTC${this.nightlySweepTimezoneOffsetMinutes >= 0 ? '+' : ''}${this.nightlySweepTimezoneOffsetMinutes / 60})`
      );
      return;
    }

    if (this.nightlySweepTimer) {
      clearInterval(this.nightlySweepTimer);
      this.nightlySweepTimer = null;
    }

    this.logger.log('Busca noturna desativada (SYNC_NIGHTLY_SWEEP_ENABLED=false)');
  }

  private resolveInitialNightlySweepSlots(): string[] {
    const envSlots = process.env.SYNC_NIGHTLY_SWEEP_SLOTS
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (envSlots?.length) {
      return this.normalizeNightlySweepSlots(envSlots);
    }

    return this.normalizeNightlySweepSlots([this.formatTime(this.nightlySweepHour, this.nightlySweepMinute)]);
  }

  private normalizeNightlySweepSlots(slots: string[]): string[] {
    const valid = Array.from(
      new Set(slots.map((value) => value.trim()).filter((value) => SyncService.NIGHTLY_SWEEP_AVAILABLE_SLOTS.includes(value)))
    );

    return SyncService.NIGHTLY_SWEEP_AVAILABLE_SLOTS.filter((slot) => valid.includes(slot));
  }

  private getReferenceNightlySweepSlot(): NightlySweepSlot {
    return this.parseNightlySweepSlot(this.nightlySweepActiveSlots[0] ?? this.formatTime(this.nightlySweepHour, this.nightlySweepMinute));
  }

  private getActiveNightlySweepSlots(): NightlySweepSlot[] {
    return this.nightlySweepActiveSlots.map((slot) => this.parseNightlySweepSlot(slot));
  }

  private parseNightlySweepSlot(time: string): NightlySweepSlot {
    const [hourRaw, minuteRaw] = time.split(':');
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    return {
      time,
      hour: Number.isInteger(hour) ? hour : this.nightlySweepHour,
      minute: Number.isInteger(minute) ? minute : this.nightlySweepMinute
    };
  }

  private describeNightlySweepSlots(): string {
    if (this.nightlySweepActiveSlots.length === 0) {
      return 'nenhum horario selecionado';
    }

    return this.nightlySweepActiveSlots.join(', ');
  }

  private formatTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private pruneNightlySweepExecutionKeys(currentDateKey: string): void {
    for (const key of Array.from(this.executedNightlySweepKeys)) {
      const [dateKey] = key.split('T');
      if (dateKey < currentDateKey) {
        this.executedNightlySweepKeys.delete(key);
      }
    }
  }

  private async loadNightlySweepConfig(): Promise<void> {
    const absolutePath = this.storage.resolveKeyPath(SyncService.NIGHTLY_SWEEP_CONFIG_STORAGE_KEY);

    try {
      const raw = await readFile(absolutePath, 'utf8');
      const parsed = JSON.parse(raw) as NightlySweepConfigFile;

      if (typeof parsed.enabled === 'boolean') {
        this.nightlySweepEnabled = parsed.enabled;
      }

      if (Array.isArray(parsed.activeSlots)) {
        this.nightlySweepActiveSlots = this.normalizeNightlySweepSlots(parsed.activeSlots);
      }
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : null;
      if (code !== 'ENOENT') {
        this.logger.warn(`Falha ao carregar configuracao da rotina noturna: ${this.toErrorMessage(error)}`);
      }
    }
  }

  private async persistNightlySweepConfig(): Promise<void> {
    const absolutePath = this.storage.resolveKeyPath(SyncService.NIGHTLY_SWEEP_CONFIG_STORAGE_KEY);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(
      absolutePath,
      JSON.stringify(
        {
          enabled: this.nightlySweepEnabled,
          activeSlots: this.nightlySweepActiveSlots
        },
        null,
        2
      ),
      'utf8'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
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

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private normalizeSerie(value?: string | null): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private parseNumeroNfse(value?: string | null): number | null {
    if (!value) {
      return null;
    }

    const digits = String(value).replace(/\D/g, '');
    if (!digits) {
      return null;
    }

    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private toSafeNumber(value: bigint): number {
    const converted = Number(value);
    if (!Number.isSafeInteger(converted)) {
      throw new Error(`Valor bigint fora do intervalo seguro para number: ${value.toString()}`);
    }

    return converted;
  }

  private maxBigInt(left: bigint, right: bigint): bigint {
    return left > right ? left : right;
  }

  private minBigInt(left: bigint, right: bigint): bigint {
    return left < right ? left : right;
  }

  private async buildDanfseMunicipioFallback(params: {
    cnpjPrestador?: string | null;
    cnpjTomador?: string | null;
    municipioPrestacaoCodigo?: string | null;
    municipioPrestacaoNome?: string | null;
  }): Promise<{
    municipioPrestador?: string;
    municipioTomador?: string;
    municipioPrestacaoCodigo?: string;
    municipioPrestacaoNome?: string;
    localPrestacao?: string;
    municipioIncidenciaIssqn?: string;
  }> {
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

  private normalizeSearchText(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private toSafeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async logSync(
    clienteId: string,
    controleSyncId: string,
    certificadoId: string | null,
    ambiente: Ambiente,
    nsu: bigint | null,
    status: string,
    mensagem: string
  ): Promise<void> {
    await this.prisma.nfseSyncLog.create({
      data: {
        clienteId,
        controleSyncId,
        certificadoId,
        ambiente,
        nsuConsultado: nsu,
        status,
        mensagem
      }
    });
  }
}
