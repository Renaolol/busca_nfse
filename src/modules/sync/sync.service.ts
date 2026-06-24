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
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdnDFeDocument,
  AdnDFeResult,
  NFSE_ADN_CLIENT,
  NfseAdnClient
} from '../../integrations/nfse-adn/nfse-adn.types';
import { NfseDanfseService } from '../nfse/nfse-danfse.service';
import { NfseXmlParserService, ParsedNfse, ParsedNfseEvento } from '../nfse/nfse-xml-parser.service';
import { LocalStorageService } from '../storage/storage.service';
import { TestSingleNsuDto } from './dto/test-single-nsu.dto';
import { StartSyncDto } from './dto/start-sync.dto';
import { ReprocessPastNsusDto } from './dto/reprocess-past-nsus.dto';

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
  documentosIgnoradosExistentes: number;
  semDocumento: number;
  falhas: number;
  interrompidoPorRateLimit: boolean;
  ultimaMensagem: string | null;
  detalhes: ReprocessPastNsusDetail[];
};

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private nightlySweepTimer: NodeJS.Timeout | null = null;
  private autoSyncRunning = false;
  private nightlySweepRunning = false;
  private lastNightlySweepDateKey: string | null = null;
  private readonly autoSyncEnabled = process.env.SYNC_AUTO_RUN_ENABLED !== 'false';
  private readonly autoSyncIntervalMs = this.parsePositiveNumberEnv('SYNC_AUTO_RUN_INTERVAL_MS', 30000);
  private readonly autoSyncStartupDelayMs = this.parsePositiveNumberEnv('SYNC_AUTO_RUN_STARTUP_DELAY_MS', 3000);
  private readonly apiRetryDelayMs = this.parsePositiveNumberEnv('SYNC_API_RETRY_DELAY_MS', 120000);
  private readonly dailySyncIntervalMs = this.parsePositiveNumberEnv('SYNC_DAILY_INTERVAL_MS', 24 * 60 * 60 * 1000);
  private readonly dailySyncMaxNsuPerRun = this.parsePositiveNumberEnv('SYNC_DAILY_MAX_NSU_PER_RUN', 10);
  private readonly dailySyncStopOnFirstDocument = process.env.SYNC_DAILY_STOP_ON_FIRST_DOCUMENT === 'true';
  private readonly dailySyncSuccessCooldownMs = this.parsePositiveNumberEnv('SYNC_DAILY_SUCCESS_COOLDOWN_MS', 120000);
  private readonly adnRequestIntervalMs = this.parsePositiveNumberEnv('SYNC_ADN_REQUEST_INTERVAL_MS', 5000);
  private readonly apiRetryJitterMs = this.parsePositiveNumberEnv('SYNC_API_RETRY_JITTER_MS', 60000);
  private readonly rateLimitGlobalCooldownMs = this.parsePositiveNumberEnv('SYNC_ADN_RATE_LIMIT_COOLDOWN_MS', 300000);
  private readonly nightlySweepEnabled = process.env.SYNC_NIGHTLY_SWEEP_ENABLED !== 'false';
  private readonly nightlySweepCheckIntervalMs = this.parsePositiveNumberEnv('SYNC_NIGHTLY_SWEEP_CHECK_INTERVAL_MS', 60000);
  private readonly nightlySweepHour = this.parseBoundedIntegerEnv('SYNC_NIGHTLY_SWEEP_HOUR', 2, 0, 23);
  private readonly nightlySweepMinute = this.parseBoundedIntegerEnv('SYNC_NIGHTLY_SWEEP_MINUTE', 0, 0, 59);
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
    @Inject(NFSE_ADN_CLIENT) private readonly adnClient: NfseAdnClient
  ) {}

  onModuleInit(): void {
    if (this.autoSyncEnabled) {
      this.autoSyncTimer = setInterval(() => {
        void this.runAutomaticSyncCycle();
      }, this.autoSyncIntervalMs);

      setTimeout(() => {
        void this.runAutomaticSyncCycle();
      }, this.autoSyncStartupDelayMs);

      this.logger.log(`Execucao automatica de sync habilitada a cada ${this.autoSyncIntervalMs}ms`);
    } else {
      this.logger.log('Execucao automatica de sync desativada (SYNC_AUTO_RUN_ENABLED=false)');
    }

    if (this.nightlySweepEnabled) {
      this.nightlySweepTimer = setInterval(() => {
        void this.tryRunNightlySweep();
      }, this.nightlySweepCheckIntervalMs);
      setTimeout(() => {
        void this.tryRunNightlySweep();
      }, 5000);

      this.logger.log(
        `Busca noturna habilitada para ${String(this.nightlySweepHour).padStart(2, '0')}:${String(this.nightlySweepMinute).padStart(2, '0')} (UTC${this.nightlySweepTimezoneOffsetMinutes >= 0 ? '+' : ''}${this.nightlySweepTimezoneOffsetMinutes / 60})`
      );
    } else {
      this.logger.log('Busca noturna desativada (SYNC_NIGHTLY_SWEEP_ENABLED=false)');
    }
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
    nightlySweep: {
      enabled: boolean;
      running: boolean;
      hour: number;
      minute: number;
      timezoneOffsetMinutes: number;
      checkIntervalMs: number;
      lastRunDateKey: string | null;
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
      nightlySweep: {
        enabled: this.nightlySweepEnabled,
        running: this.nightlySweepRunning,
        hour: this.nightlySweepHour,
        minute: this.nightlySweepMinute,
        timezoneOffsetMinutes: this.nightlySweepTimezoneOffsetMinutes,
        checkIntervalMs: this.nightlySweepCheckIntervalMs,
        lastRunDateKey: this.lastNightlySweepDateKey,
        nextRunAt: this.nightlySweepEnabled ? this.resolveNextNightlySweepAt(new Date()).toISOString() : null
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

        const persistedDocuments: Array<{ nsu?: bigint; kind: 'evento' | 'nfse' }> = [];
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
              persisted.kind === 'evento' ? 'Evento sincronizado' : 'Documento sincronizado'
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
        const lastKind = persistedDocuments[persistedDocuments.length - 1]?.kind ?? 'nfse';

        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            ultimoNsuConsultado: maxProcessedNsu,
            ultimoNsuComDocumento: maxProcessedNsu,
            totalDocumentosBaixados: {
              increment: persistedDocuments.length
            },
            ultimaExecucao: new Date(),
            proximaExecucao:
              isDailyMode && this.dailySyncStopOnFirstDocument
                ? new Date(Date.now() + this.dailySyncSuccessCooldownMs)
                : null,
            ultimaMensagem: this.buildSuccessMessage(persistedDocuments.length, lastKind)
          }
        });

        documentsSaved += persistedDocuments.length;
        documentsSavedForControl += persistedDocuments.length;
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
    if (options.clienteId) {
      await this.ensureClient(options.clienteId);
    }

    const controls = await this.prisma.nfseSyncControle.findMany({
      where: options.clienteId ? { clienteId: options.clienteId } : {},
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }]
    });

    const result: ReprocessPastNsusResult = {
      controlesEncontrados: controls.length,
      controlesProcessados: 0,
      nsusAvaliados: 0,
      nsusConsultados: 0,
      nsusIgnoradosComDocumento: 0,
      documentosSalvos: 0,
      documentosIgnoradosExistentes: 0,
      semDocumento: 0,
      falhas: 0,
      interrompidoPorRateLimit: false,
      ultimaMensagem: null,
      detalhes: []
    };

    for (const control of controls) {
      if (this.isRateLimitCooldownActive()) {
        result.interrompidoPorRateLimit = true;
        result.ultimaMensagem = 'Recuperacao interrompida por cooldown de rate limit do ADN';
        break;
      }

      const startNsu = 1n;
      const detail = this.createReprocessDetail(control, startNsu);
      result.detalhes.push(detail);

      if (control.ultimoNsuConsultado < startNsu) {
        result.controlesProcessados += 1;
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

      for (let nsu = startNsu; nsu <= control.ultimoNsuConsultado; nsu += 1n) {
        detail.nsusAvaliados += 1;
        result.nsusAvaliados += 1;

        if (
          await this.hasFiscalDocumentForNsu({
            clienteId: control.clienteId,
            ambiente: control.ambiente,
            nsu
          })
        ) {
          detail.nsusIgnoradosComDocumento += 1;
          result.nsusIgnoradosComDocumento += 1;
          continue;
        }

        await this.waitForAdnRequestSlot();
        const dfeResult = await this.adnClient.getDFeByNsu({
          cnpjConsulta: control.cnpjConsulta,
          nsu,
          ambiente: this.toNfseAmbiente(control.ambiente),
          certificateId: certificate.id
        });
        detail.nsusConsultados += 1;
        result.nsusConsultados += 1;

        if (this.isCertificateDecryptError(dfeResult)) {
          const message =
            'Falha ao descriptografar certificado/senha. Verifique CERT_MASTER_KEY e recadastre o certificado.';
          detail.falhas += 1;
          result.falhas += 1;
          result.ultimaMensagem = message;
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
          await this.logSync(
            control.clienteId,
            control.id,
            certificate.id,
            control.ambiente,
            nsu,
            isRateLimitError ? 'rate_limit' : 'erro_api',
            message
          );
          shouldStopAll = true;
          break;
        }

        const documents = this.getResultDocuments(dfeResult, nsu).filter(
          (document) => !document.nsu || document.nsu <= control.ultimoNsuConsultado
        );
        if (!dfeResult.hasDocument || documents.length === 0) {
          detail.semDocumento += 1;
          result.semDocumento += 1;
          continue;
        }

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
            continue;
          }

          const persisted = await this.persistDfeDocumentFromNsu({
            control,
            document
          });
          const persistedNsu = persisted.nsu ?? nsu;
          maxRecoveredNsu =
            maxRecoveredNsu && maxRecoveredNsu > persistedNsu ? maxRecoveredNsu : persistedNsu;
          detail.documentosSalvos += 1;
          result.documentosSalvos += 1;
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
      }

      await this.updateControlAfterPastNsuReprocess(control, detail, maxRecoveredNsu);
      result.controlesProcessados += 1;

      if (shouldStopAll) {
        break;
      }
    }

    if (!result.ultimaMensagem) {
      result.ultimaMensagem = `Recuperacao concluida com ${result.documentosSalvos} documento(s) salvo(s)`;
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
    const hour = localReference.getUTCHours();
    const minute = localReference.getUTCMinutes();
    const dateKey = this.toDateKey(localReference);

    if (hour !== this.nightlySweepHour || minute !== this.nightlySweepMinute) {
      return;
    }

    if (this.lastNightlySweepDateKey === dateKey) {
      return;
    }

    this.lastNightlySweepDateKey = dateKey;
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
    } catch (error) {
      this.logger.error(`Falha na execucao automatica de sync: ${this.toErrorMessage(error)}`);
    } finally {
      this.autoSyncRunning = false;
    }
  }

  private createReprocessDetail(control: NfseSyncControle, startNsu: bigint): ReprocessPastNsusDetail {
    return {
      controleId: control.id,
      clienteId: control.clienteId,
      cnpjConsulta: control.cnpjConsulta,
      ambiente: control.ambiente,
      nsuInicial: startNsu.toString(),
      nsuFinal: control.ultimoNsuConsultado.toString(),
      nsusAvaliados: 0,
      nsusConsultados: 0,
      nsusIgnoradosComDocumento: 0,
      documentosSalvos: 0,
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
    const message = `Recuperacao de NSUs passados: ${detail.documentosSalvos} documento(s) salvo(s), ${detail.nsusIgnoradosComDocumento + detail.documentosIgnoradosExistentes} ja existente(s), ${detail.semDocumento} sem documento.`;
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
  }): Promise<{ nsu?: bigint; kind: 'evento' | 'nfse' }> {
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
        kind: 'evento'
      };
    }

    const existingDocument = await this.prisma.nfseDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.control.ambiente,
          chaveAcesso: chave
        }
      },
      select: {
        status: true,
        dataCancelamento: true
      }
    });
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
    const xmlKey = `nfse/${params.control.ambiente}/${cnpjPasta}/${year}/${month}/xml/${chave}.xml`;
    await this.storage.putObject(xmlKey, params.document.xml);
    const danfseKey = `nfse/${params.control.ambiente}/${cnpjPasta}/${year}/${month}/danfse/${chave}.pdf`;
    const danfsePdf = this.danfse.generateFromXml(params.document.xml, {
      chaveAcesso: chave,
      numeroNfse: parsedXml?.numeroNfse,
      dataEmissao: parsedXml?.dataEmissao,
      status: this.normalizeStatus(parsedXml?.status),
      cnpjPrestador: parsedXml?.cnpjPrestador ?? params.control.cnpjConsulta,
      razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
      cnpjTomador: parsedXml?.cnpjTomador,
      razaoSocialTomador: parsedXml?.razaoSocialTomador,
      valorServico: parsedXml?.valorServico,
      descricaoServico: parsedXml?.descricaoServico
    });
    await this.storage.putObject(danfseKey, danfsePdf);
    const hash = this.parser.getHash(params.document.xml);

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
      xmlPath: xmlKey,
      danfsePath: isCanceledDocument ? null : danfseKey,
      hashXml: hash,
      origem: DocumentoOrigem.adn_nsu,
      updatedAt: new Date()
    };
    const createData: Prisma.NfseDocumentoUncheckedCreateInput = {
      clienteId: params.control.clienteId,
      estabelecimentoId: params.control.estabelecimentoId,
      ambiente: params.control.ambiente,
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
      xmlPath: xmlKey,
      danfsePath: isCanceledDocument ? null : danfseKey,
      hashXml: hash,
      origem: DocumentoOrigem.adn_nsu
    };

    await this.upsertDocumentoResolvingNsuConflict({
      ambiente: params.control.ambiente,
      clienteId: params.control.clienteId,
      chaveAcesso: chave,
      nsu: params.document.nsu,
      updateData,
      createData
    });

    return {
      nsu: params.document.nsu,
      kind: 'nfse'
    };
  }

  private buildSuccessMessage(count: number, kind: 'evento' | 'nfse'): string {
    if (count === 1) {
      return kind === 'evento' ? 'Evento sincronizado com sucesso' : 'Documento sincronizado com sucesso';
    }

    return `Lote ADN sincronizado com ${count} documento(s)`;
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
    const tipoEvento = (evento.tipoEvento ?? '').trim().toLowerCase();
    const descricao = this.normalizeSearchText(evento.descricao ?? undefined);

    return (
      Boolean(evento.isCancelamento) ||
      tipoEvento === 'e101101' ||
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
      if (!this.isDocumentoNsuUniqueViolation(error, params.nsu)) {
        throw error;
      }

      const nsu = params.nsu as bigint;
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
        throw error;
      }

      this.logger.warn(
        `Documento reconciliado por NSU ${nsu.toString()} em ${params.ambiente}; chave anterior ${existing.chaveAcesso}, nova chave ${params.chaveAcesso}`
      );

      return this.prisma.nfseDocumento.update({
        where: { id: existing.id },
        data: {
          ...params.updateData,
          clienteId: params.createData.clienteId,
          estabelecimentoId: params.createData.estabelecimentoId,
          ambiente: params.ambiente,
          nsu,
          chaveAcesso: params.chaveAcesso,
          origem: params.createData.origem
        }
      });
    }
  }

  private isDocumentoNsuUniqueViolation(
    error: unknown,
    nsu?: bigint
  ): error is { code: string; meta?: { target?: unknown } } {
    if (nsu === undefined || !error || typeof error !== 'object' || !('code' in error)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? (error.meta as { target?: unknown }) : null;
    const target = meta?.target;
    if (!Array.isArray(target)) {
      return false;
    }

    const normalizedTarget = target
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    return normalizedTarget.includes('cliente_id') && normalizedTarget.includes('ambiente') && normalizedTarget.includes('nsu');
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

  private resolveNextNightlySweepAt(now: Date): Date {
    const localReference = this.getNightlyReferenceDate(now);
    let targetLocalUtcMs = Date.UTC(
      localReference.getUTCFullYear(),
      localReference.getUTCMonth(),
      localReference.getUTCDate(),
      this.nightlySweepHour,
      this.nightlySweepMinute,
      0,
      0
    );
    let targetActualMs = targetLocalUtcMs - this.nightlySweepTimezoneOffsetMinutes * 60 * 1000;

    if (targetActualMs <= now.getTime()) {
      targetLocalUtcMs += 24 * 60 * 60 * 1000;
      targetActualMs = targetLocalUtcMs - this.nightlySweepTimezoneOffsetMinutes * 60 * 1000;
    }

    return new Date(targetActualMs);
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
