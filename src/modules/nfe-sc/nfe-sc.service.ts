import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { NfeAmbiente, NfeSyncStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NFE_SC_CLIENT, NfeScClient } from '../../integrations/nfe-sc/nfe-sc.types';
import { NfeService } from '../nfe/nfe.service';
import { ConfigureNfeScSyncDto } from './dto/configure-nfe-sc-sync.dto';

@Injectable()
export class NfeScService implements OnModuleInit, OnModuleDestroy {
  private static readonly BATCH_SIZE = 50;
  private static readonly EXECUTION_LEASE_MS = 5 * 60 * 1000;
  private static readonly REQUEST_START_GAP_MS = 125;
  private static readonly MAX_CONCURRENT_REQUESTS = 8;
  private static readonly RECOVERY_INTERVAL_MS = 30 * 1000;
  private readonly logger = new Logger(NfeScService.name);
  private readonly runningControls = new Set<string>();
  private requestStartQueue: Promise<void> = Promise.resolve();
  private lastRequestStartedAt = 0;
  private activeRequests = 0;
  private readonly requestSlotWaiters: Array<(release: () => void) => void> = [];
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfeService: NfeService,
    @Inject(NFE_SC_CLIENT) private readonly client: NfeScClient
  ) {}

  onModuleInit(): void {
    this.recoveryTimer = setInterval(() => void this.resumeExpiredExecutions(), NfeScService.RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  async listControls(clienteId: string) {
    await this.ensureClient(clienteId);
    return this.prisma.nfeScSyncControle.findMany({
      where: { clienteId },
      select: {
        id: true,
        clienteId: true,
        estabelecimentoId: true,
        cnpjConsulta: true,
        certificadoId: true,
        ambiente: true,
        indAtor: true,
        autorizacaoConfirmadaEm: true,
        ultimoNsuConsultado: true,
        status: true,
        ultimaExecucao: true,
        proximaExecucao: true,
        ultimaMensagem: true,
        totalDocumentosBaixados: true,
        createdAt: true,
        updatedAt: true,
        estabelecimento: { select: { id: true, cnpj: true, razaoSocial: true } },
        certificado: { select: { id: true, nome: true, validadeFim: true, ativo: true } }
      },
      orderBy: [{ estabelecimento: { razaoSocial: 'asc' } }, { ambiente: 'asc' }]
    });
  }

  async listDocuments(clienteId: string, page = 1, pageSize = 100) {
    await this.ensureClient(clienteId);
    const where = { controle: { clienteId } };
    const [total, rows] = await Promise.all([
      this.prisma.nfeScDocumentoDistribuido.count({ where }),
      this.prisma.nfeScDocumentoDistribuido.findMany({
        where,
        orderBy: [{ nsu: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          controleId: true,
          nsu: true,
          schemaDoc: true,
          createdAt: true,
          documento: {
            select: {
              id: true,
              estabelecimentoId: true,
              ambiente: true,
              chaveAcesso: true,
              numeroNfe: true,
              serie: true,
              modelo: true,
              dataEmissao: true,
              status: true,
              tipoRelacao: true,
              xmlCompletoDisponivel: true,
              origem: true
            }
          }
        }
      })
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        nsu: row.nsu.toString(),
        origem: 'sef_sc_nfe' as const
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  async configure(dto: ConfigureNfeScSyncDto, usuarioId?: string) {
    if (dto.ambiente !== NfeAmbiente.producao) {
      throw new BadRequestException('A especificacao atual da SEF/SC publica este servico somente em producao');
    }
    if (!dto.autorizacaoContabilistaConfirmada) {
      throw new BadRequestException('Confirme que o vinculo do contabilista foi previamente verificado na SEF/SC');
    }
    if (!usuarioId) throw new BadRequestException('Usuario administrador obrigatorio para confirmar o vinculo SEF/SC');

    const establishment = await this.prisma.clienteEstabelecimento.findFirst({
      where: { id: dto.estabelecimentoId, clienteId: dto.clienteId, ativo: true }
    });
    if (!establishment) throw new NotFoundException('Estabelecimento ativo nao encontrado para o cliente');
    const cpfConsulta = String(establishment.cnpj || '').replace(/\D/g, '');
    if (!this.isValidCpf(cpfConsulta)) {
      throw new BadRequestException('Esta configuracao exige que o estabelecimento esteja cadastrado com um CPF valido de produtor rural');
    }

    const now = new Date();
    const certificate = await this.prisma.certificado.findFirst({
      where: {
        id: dto.certificadoId,
        ativo: true,
        tipo: 'A1',
        AND: [
          { OR: [{ clienteId: dto.clienteId }, { clienteId: null }] },
          { OR: [{ estabelecimentoId: dto.estabelecimentoId }, { estabelecimentoId: null }] },
          { OR: [{ validadeFim: null }, { validadeFim: { gt: now } }] }
        ]
      },
      select: { id: true }
    });
    if (!certificate) throw new BadRequestException('Selecione um certificado A1 ativo, valido e vinculado ao cliente ou estabelecimento');

    const current = await this.prisma.nfeScSyncControle.findUnique({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: dto.clienteId,
          cnpjConsulta: cpfConsulta,
          ambiente: dto.ambiente
        }
      },
      select: { id: true, ultimoNsuConsultado: true, indAtor: true, status: true }
    });
    if (current?.status === NfeSyncStatus.processando) {
      throw new ConflictException('Pause a consulta SEF/SC antes de alterar a configuracao');
    }
    if (current && current.ultimoNsuConsultado > 0n && current.indAtor !== dto.indAtor) {
      throw new BadRequestException('O filtro Emitente/Destinatario nao pode mudar depois do primeiro NSU; crie outro escopo para manter a rastreabilidade');
    }

    return this.prisma.nfeScSyncControle.upsert({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: dto.clienteId,
          cnpjConsulta: cpfConsulta,
          ambiente: dto.ambiente
        }
      },
      create: {
        clienteId: dto.clienteId,
        estabelecimentoId: establishment.id,
        cnpjConsulta: cpfConsulta,
        certificadoId: certificate.id,
        ambiente: dto.ambiente,
        indAtor: dto.indAtor,
        autorizacaoConfirmadaEm: now,
        autorizacaoConfirmadaPorId: usuarioId,
        status: NfeSyncStatus.ativo,
        ultimaMensagem: 'Configuracao registrada. O vinculo cadastral sera novamente validado pela SEF/SC a cada consulta.'
      },
      update: {
        estabelecimentoId: establishment.id,
        certificadoId: certificate.id,
        indAtor: dto.indAtor,
        autorizacaoConfirmadaEm: now,
        autorizacaoConfirmadaPorId: usuarioId,
        status: NfeSyncStatus.ativo,
        proximaExecucao: null,
        ultimaMensagem: 'Configuracao atualizada; cursor NSU preservado. A SEF/SC validara o vinculo em cada consulta.'
      },
      select: {
        id: true,
        clienteId: true,
        estabelecimentoId: true,
        ambiente: true,
        indAtor: true,
        autorizacaoConfirmadaEm: true,
        ultimoNsuConsultado: true,
        status: true,
        ultimaMensagem: true
      }
    });
  }

  async pause(clienteId: string, id: string) {
    const result = await this.prisma.nfeScSyncControle.updateMany({
      where: { id, clienteId },
      data: {
        status: NfeSyncStatus.pausado,
        proximaExecucao: null,
        ultimaMensagem: 'Controle pausado. O cursor registra somente documentos ja persistidos e rastreados.'
      }
    });
    if (!result.count) throw new NotFoundException('Controle SEF/SC de NF-e nao encontrado');
    return { paused: true };
  }

  async run(clienteId: string, id: string) {
    const control = await this.prisma.nfeScSyncControle.findFirst({ where: { id, clienteId } });
    if (!control) throw new NotFoundException('Controle SEF/SC de NF-e nao encontrado');
    if (!control.autorizacaoConfirmadaEm || !control.autorizacaoConfirmadaPorId) {
      throw new BadRequestException('Confirme o vinculo do contabilista na SEF/SC antes de consultar');
    }
    if (control.status === NfeSyncStatus.processando) return this.toRunResponse(control, false);
    const now = new Date();
    if (control.proximaExecucao && control.proximaExecucao > now) {
      throw new BadRequestException(`Proxima consulta permitida em ${control.proximaExecucao.toISOString()}`);
    }

    const leaseUntil = this.newLease();
    const started = await this.prisma.nfeScSyncControle.updateMany({
      where: {
        id,
        clienteId,
        status: { not: NfeSyncStatus.processando },
        OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }]
      },
      data: {
        status: NfeSyncStatus.processando,
        proximaExecucao: leaseUntil,
        ultimaExecucao: now,
        ultimaMensagem: 'Consulta SEF/SC iniciada.'
      }
    });
    if (!started.count) {
      const current = await this.prisma.nfeScSyncControle.findFirst({ where: { id, clienteId } });
      if (current?.status === NfeSyncStatus.processando) return this.toRunResponse(current, false);
      throw new ConflictException('Nao foi possivel iniciar a consulta; atualize o controle e tente novamente');
    }

    this.startBackgroundExecution(id, leaseUntil);
    return this.toRunResponse({ ...control, status: NfeSyncStatus.processando, ultimaMensagem: 'Consulta SEF/SC iniciada.' }, true);
  }

  private async processAllAvailableBatches(id: string, initialLease: Date): Promise<void> {
    let leaseUntil = initialLease;
    let savedInExecution = 0;
    while (true) {
      const control = await this.prisma.nfeScSyncControle.findUnique({ where: { id } });
      if (!control || control.status !== NfeSyncStatus.processando || !this.sameDate(control.proximaExecucao, leaseUntil)) return;

      const renewedLease = this.newLease();
      const renewed = await this.prisma.nfeScSyncControle.updateMany({
        where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
        data: { proximaExecucao: renewedLease }
      });
      if (!renewed.count) return;
      leaseUntil = renewedLease;

      let result;
      const releaseRequestSlot = await this.acquireRequestSlot();
      try {
        await this.reserveRequestStart();
        result = await this.client.download({
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          cpfConsulta: control.cnpjConsulta,
          certificadoId: control.certificadoId,
          ambiente: control.ambiente,
          ultimoNsu: control.ultimoNsuConsultado,
          indAtor: control.indAtor
        });
      } catch {
        await this.stopAfterError(id, leaseUntil, 'Falha de transporte ou certificado; verifique a configuracao antes de tentar novamente.');
        return;
      } finally {
        releaseRequestSlot();
      }

      if (result.cStat === '118') {
        if (result.documentos.length === 0 || result.documentos.length > NfeScService.BATCH_SIZE) {
          await this.stopAfterError(id, leaseUntil, 'Resposta SEF/SC inconsistente; cursor mantido no ultimo documento confirmado.');
          return;
        }
        let cursor = control.ultimoNsuConsultado;
        for (const document of result.documentos) {
          if (document.nsu <= cursor) {
            await this.stopAfterError(id, leaseUntil, 'NSU fora de ordem; cursor mantido no ultimo documento confirmado.');
            return;
          }
          try {
            const persisted = await this.nfeService.persistSefScNfeDocument({
              clienteId: control.clienteId,
              estabelecimentoId: control.estabelecimentoId,
              ambiente: control.ambiente,
              cpfConsulta: control.cnpjConsulta,
              xml: document.xml,
              schema: document.schema
            });
            const updated = await this.prisma.$transaction(async (tx) => {
              await tx.nfeScDocumentoDistribuido.upsert({
                where: { controleId_nsu: { controleId: id, nsu: document.nsu } },
                create: { controleId: id, nfeDocumentoId: persisted.id, nsu: document.nsu, schemaDoc: document.schema },
                update: { nfeDocumentoId: persisted.id, schemaDoc: document.schema }
              });
              return tx.nfeScSyncControle.updateMany({
                where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
                data: { ultimoNsuConsultado: document.nsu, totalDocumentosBaixados: { increment: 1 } }
              });
            });
            if (!updated.count) return;
          } catch {
            await this.stopAfterError(id, leaseUntil, 'Falha ao validar ou persistir documento; cursor mantido no ultimo documento confirmado.');
            return;
          }
          cursor = document.nsu;
          savedInExecution += 1;
        }

        const shouldContinue = result.documentos.length === NfeScService.BATCH_SIZE;
        if (shouldContinue && cursor <= control.ultimoNsuConsultado) {
          await this.stopAfterError(id, leaseUntil, 'Lote sem avanco de NSU; cursor preservado para evitar repeticao infinita.');
          return;
        }
        if (shouldContinue) {
          const nextLease = this.newLease();
          const updated = await this.prisma.nfeScSyncControle.updateMany({
            where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
            data: {
              proximaExecucao: nextLease,
              ultimaMensagem: `Lote de 50 documentos salvo. Continuando a partir do NSU ${cursor}.`
            }
          });
          if (!updated.count) return;
          leaseUntil = nextLease;
          continue;
        }
      }

      const isComplete = result.cStat === '117' || result.cStat === '118';
      const status = this.resolveStatus(result.cStat);
      const delayMs = this.resolveDelayMs(result.cStat, isComplete);
      const next = delayMs === null ? null : new Date(Date.now() + delayMs);
      const message = `SEF/SC ${result.cStat}: ${this.safeStatusDescription(result.cStat)} ${savedInExecution} documento(s) processado(s) nesta execucao.`;
      await this.prisma.nfeScSyncControle.updateMany({
        where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
        data: {
          status,
          proximaExecucao: next,
          ultimaMensagem: message
        }
      });
      return;
    }
  }

  private async stopAfterError(id: string, leaseUntil: Date, safeMessage: string): Promise<void> {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    const updated = await this.prisma.nfeScSyncControle.updateMany({
      where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
      data: {
        status: NfeSyncStatus.erro_api,
        proximaExecucao: next,
        ultimaMensagem: safeMessage
      }
    });
    if (updated.count) this.logger.warn(`Consulta SEF/SC interrompida para controle ${id}; cursor mantido no ultimo NSU confirmado.`);
  }

  private async resumeExpiredExecutions(): Promise<void> {
    const expired = await this.prisma.nfeScSyncControle.findMany({
      where: { status: NfeSyncStatus.processando, proximaExecucao: { lte: new Date() } },
      select: { id: true, proximaExecucao: true }
    });
    for (const control of expired) {
      if (control.proximaExecucao) this.startBackgroundExecution(control.id, control.proximaExecucao);
    }
  }

  private startBackgroundExecution(id: string, leaseUntil: Date): void {
    if (this.runningControls.has(id)) return;
    this.runningControls.add(id);
    void this.processAllAvailableBatches(id, leaseUntil)
      .catch(async () => {
        try {
          const current = await this.prisma.nfeScSyncControle.findUnique({ where: { id } });
          if (current?.status === NfeSyncStatus.processando && current.proximaExecucao) {
            await this.stopAfterError(id, current.proximaExecucao, 'Falha interna ao processar a distribuicao; cursor mantido no ultimo documento confirmado.');
          }
        } catch {
          this.logger.error(`Falha interna no consumidor SEF/SC para controle ${id}.`);
        }
      })
      .finally(() => this.runningControls.delete(id));
  }

  private async reserveRequestStart(): Promise<void> {
    const preceding = this.requestStartQueue;
    let release!: () => void;
    this.requestStartQueue = new Promise<void>((resolve) => { release = resolve; });
    await preceding;
    try {
      const waitMs = Math.max(0, NfeScService.REQUEST_START_GAP_MS - (Date.now() - this.lastRequestStartedAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.lastRequestStartedAt = Date.now();
    } finally {
      release();
    }
  }

  private acquireRequestSlot(): Promise<() => void> {
    if (this.activeRequests >= NfeScService.MAX_CONCURRENT_REQUESTS) {
      return new Promise((resolve) => this.requestSlotWaiters.push(resolve));
    }
    this.activeRequests += 1;
    return Promise.resolve(this.createRequestSlotRelease());
  }

  private createRequestSlotRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.requestSlotWaiters.shift();
      if (next) {
        next(this.createRequestSlotRelease());
      } else {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
      }
    };
  }

  private resolveStatus(cStat: string): NfeSyncStatus {
    if (['8001', '8002', '8004'].includes(cStat)) return NfeSyncStatus.erro_autorizacao;
    if (['280', '281', '282', '283', '284', '285', '286'].includes(cStat)) return NfeSyncStatus.erro_certificado;
    return ['117', '118'].includes(cStat) ? NfeSyncStatus.ativo : NfeSyncStatus.erro_api;
  }

  private resolveDelayMs(cStat: string, isComplete: boolean): number | null {
    if (cStat === '110') return 60 * 60 * 1000;
    if (cStat === '657') return 12 * 60 * 60 * 1000;
    if (cStat === '632') return null;
    if (isComplete) return 12 * 60 * 60 * 1000;
    return 60 * 60 * 1000;
  }

  private safeStatusDescription(cStat: string): string {
    const descriptions: Record<string, string> = {
      '110': 'DF-e em reprocessamento; nova tentativa aguardara uma hora.',
      '117': 'Nenhum DF-e localizado; proxima busca respeitara o intervalo oficial.',
      '118': 'DF-e localizados.',
      '657': 'Bloqueio por excesso de tentativas; proxima tentativa aguardara 12 horas.',
      '632': 'Solicitacao fora do periodo de disponibilidade; cursor preservado e nova tentativa automatica suspensa.',
      '8001': 'Vinculo do interessado com o NSU nao reconhecido pela SEF/SC.',
      '8002': 'Titular do certificado nao reconhecido como contabilista vinculado pela SEF/SC.',
      '8004': 'Vinculo do interessado com o documento nao reconhecido pela SEF/SC.'
    };
    return descriptions[cStat] || 'Resposta recebida; confira o codigo de status antes de tentar novamente.';
  }

  private async ensureClient(clienteId: string): Promise<void> {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
  }

  private isValidCpf(cpf: string): boolean {
    if (!/^\d{11}$/.test(cpf) || /^([0-9])\1{10}$/.test(cpf)) return false;
    const digits = cpf.split('').map(Number);
    const calculate = (length: number) => {
      const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return calculate(9) === digits[9] && calculate(10) === digits[10];
  }

  private toRunResponse(control: {
    ultimoNsuConsultado: bigint;
    totalDocumentosBaixados: number;
    status: NfeSyncStatus;
    ultimaMensagem: string | null;
  }, started: boolean) {
    return {
      accepted: true,
      started,
      status: control.status,
      ultimoNsu: control.ultimoNsuConsultado.toString(),
      totalDocumentosBaixados: control.totalDocumentosBaixados,
      mensagem: control.ultimaMensagem || 'Consulta SEF/SC em andamento.'
    };
  }

  private newLease(): Date {
    return new Date(Date.now() + NfeScService.EXECUTION_LEASE_MS);
  }

  private sameDate(left: Date | null, right: Date): boolean {
    return Boolean(left && left.getTime() === right.getTime());
  }
}
