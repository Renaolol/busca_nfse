import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NFE_DISTRIBUICAO_CLIENT,
  NfeDistribuicaoClient,
  NfeDistribuicaoDocument,
  NfeDistribuicaoResult
} from '../../integrations/nfe-distribuicao/nfe-distribuicao.types';
import { DashboardNfeStatsQueryDto } from './dto/dashboard-stats.dto';
import { EnableAllNfeSyncDto } from './dto/enable-all-sync.dto';
import { EnableNfeSyncDto } from './dto/enable-sync.dto';
import { ImportNfeXmlDto } from './dto/import-xml.dto';
import { PauseNfeSyncDto } from './dto/pause-sync.dto';
import { QueryNfeByChaveDto } from './dto/query-by-chave.dto';
import { QueryNfeByNsuDto } from './dto/query-by-nsu.dto';
import { QueryNfeDto } from './dto/query-nfe.dto';
import { RunNfeSyncDto } from './dto/run-sync.dto';
import { StartNfeSyncDto } from './dto/start-sync.dto';
import { UpdateNfeSchedulerSettingsDto } from './dto/update-scheduler-settings.dto';
import { NfeXmlParserService, ParsedNfe } from './nfe-xml-parser.service';

type NfeNightlySweepConfigFile = {
  enabled?: boolean;
  activeSlots?: string[];
};

type NfeNightlySweepSlot = {
  time: string;
  hour: number;
  minute: number;
};

@Injectable()
export class NfeService implements OnModuleInit, OnModuleDestroy {
  private static readonly NIGHTLY_SWEEP_AVAILABLE_SLOTS = ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];
  private static readonly NIGHTLY_SWEEP_CONFIG_STORAGE_KEY = 'settings/nfe-nightly-sweep.json';
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
    private readonly storage: LocalStorageService,
    @Inject(NFE_DISTRIBUICAO_CLIENT) private readonly distribuicaoClient: NfeDistribuicaoClient
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
    await this.ensureClient(dto.clienteId);
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
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const clients = await this.prisma.cliente.findMany({
      where: { ativo: true },
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

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidas') {
        where.cnpjEmitente = cnpjConsulta;
      } else if (tipoRelacao === 'recebidas') {
        where.cnpjDestinatario = cnpjConsulta;
      } else {
        where.OR = [{ cnpjEmitente: cnpjConsulta }, { cnpjDestinatario: cnpjConsulta }];
      }
    }

    return this.prisma.nfeDocumento.findMany({
      where,
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: 500
    });
  }

  async getDashboardStats(query: DashboardNfeStatsQueryDto) {
    const where: Prisma.NfeDocumentoWhereInput = {};
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
    const found = await this.prisma.nfeDocumento.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('NF-e nao encontrada');
    }
    this.assertClientScope(found.clienteId, clienteId);
    return found;
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

  async iniciarSync(dto: StartNfeSyncDto): Promise<{ controlesCriadosOuAtualizados: number }> {
    await this.ensureClient(dto.clienteId);
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

  async runNow(dto: RunNfeSyncDto): Promise<{ processed: number; documentsSaved: number }> {
    await this.ensureClient(dto.clienteId);
    return this.runNowInternal({
      clienteId: dto.clienteId,
      ambiente: dto.ambiente,
      estabelecimentoId: dto.estabelecimentoId,
      limitControles: dto.limitControles
    });
  }

  async runNowGlobal(): Promise<{ processed: number; documentsSaved: number }> {
    return this.runNowInternal({
      limitControles: 50
    });
  }

  private async runNowInternal(params: {
    clienteId?: string;
    ambiente?: NfeAmbiente;
    estabelecimentoId?: string;
    limitControles?: number;
  }): Promise<{ processed: number; documentsSaved: number }> {
    const controls = await this.prisma.nfeSyncControle.findMany({
      where: {
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
      documentsSaved
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

  private async persistDocument(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    document: NfeDistribuicaoDocument;
    origem: NfeDocumentoOrigem;
    tipoRelacaoForcada?: NfeTipoRelacao;
  }) {
    const parsed = this.parser.parse(params.document.xml);
    const existing = await this.prisma.nfeDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: parsed.chaveAcesso
        }
      }
    });

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

    const updateData: Prisma.NfeDocumentoUncheckedUpdateInput = {
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      nsu: params.document.nsu,
      numeroNfe: parsed.numeroNfe,
      serie: parsed.serie,
      modelo: parsed.modelo ?? '55',
      dataEmissao: parsed.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao,
      status: parsed.status,
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
      status: parsed.status,
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
    const where: Prisma.NfeDocumentoWhereInput = {};

    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const cnpjEmitente = this.normalizeCnpj(query.cnpjEmitente);
    if (cnpjEmitente) {
      where.cnpjEmitente = cnpjEmitente;
    }

    const cnpjDestinatario = this.normalizeCnpj(query.cnpjDestinatario);
    if (cnpjDestinatario) {
      where.cnpjDestinatario = cnpjDestinatario;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.schemaDoc) {
      where.schemaDoc = query.schemaDoc;
    }

    if (query.dataInicio || query.dataFim) {
      where.dataEmissao = {
        gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
        lte: query.dataFim ? new Date(query.dataFim) : undefined
      };
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      where.valorTotal = {
        gte: query.valorMin,
        lte: query.valorMax
      };
    }

    if (query.somenteXmlCompleto) {
      where.xmlCompletoDisponivel = true;
    }

    return where;
  }

  private async runAutomaticSyncCycle(): Promise<void> {
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

  private async ensureClient(clienteId: string): Promise<void> {
    const found = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!found) {
      throw new NotFoundException('Cliente nao encontrado');
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
    const certificate = await this.prisma.certificado.findFirst({
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
      select: { id: true }
    });

    if (!certificate) {
      throw new BadRequestException(`Nenhum certificado ativo e valido encontrado para o CNPJ ${cnpjConsulta}`);
    }

    return certificate;
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

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
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
}
