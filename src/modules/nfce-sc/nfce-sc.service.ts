import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { NfeAmbiente, NfeSyncStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NfeService } from '../nfe/nfe.service';
import { NFCE_SC_CLIENT, NfceScClient } from '../../integrations/nfce-sc/nfce-sc.types';
import { ConfigureNfceScSyncDto } from './dto/configure-nfce-sc-sync.dto';

@Injectable()
export class NfceScService implements OnModuleInit, OnModuleDestroy {
  private static readonly BATCH_SIZE = 50;
  private static readonly EXECUTION_LEASE_MS = 5 * 60 * 1000;
  private static readonly RECOVERY_INTERVAL_MS = 30 * 1000;
  private readonly logger = new Logger(NfceScService.name);
  private readonly runningControls = new Set<string>();
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfeService: NfeService,
    @Inject(NFCE_SC_CLIENT) private readonly client: NfceScClient
  ) {}

  onModuleInit(): void {
    this.recoveryTimer = setInterval(() => {
      void this.resumeExpiredExecutions();
    }, NfceScService.RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  async listControls(clienteId: string) {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
    return this.prisma.nfceScSyncControle.findMany({
      where: { clienteId },
      include: {
        estabelecimento: { select: { id: true, cnpj: true, razaoSocial: true } },
        certificado: { select: { id: true, nome: true, cnpjTitular: true, validadeFim: true, ativo: true } }
      },
      orderBy: [{ estabelecimento: { razaoSocial: 'asc' } }, { ambiente: 'asc' }]
    });
  }

  async listDocuments(clienteId: string) {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
    return this.prisma.nfeDocumento.findMany({
      where: { clienteId, modelo: '65', origem: 'sef_sc_nfce' },
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true, clienteId: true, estabelecimentoId: true, ambiente: true, nsu: true,
        chaveAcesso: true, numeroNfe: true, serie: true, modelo: true, dataEmissao: true,
        status: true, cnpjEmitente: true, razaoSocialEmitente: true, cnpjDestinatario: true,
        razaoSocialDestinatario: true, valorTotal: true, xmlCompletoDisponivel: true,
        xmlCompletoPath: true, origem: true, createdAt: true
      }
    });
  }

  async configure(dto: ConfigureNfceScSyncDto) {
    if (dto.ambiente !== NfeAmbiente.producao) {
      throw new BadRequestException('A especificacao atual da SEF/SC publica somente o ambiente de producao');
    }
    const [establishment, certificate] = await Promise.all([
      this.prisma.clienteEstabelecimento.findFirst({
        where: { id: dto.estabelecimentoId, clienteId: dto.clienteId, ativo: true }
      }),
      this.prisma.certificado.findFirst({
        where: {
          id: dto.certificadoId,
          ativo: true,
          OR: [{ clienteId: dto.clienteId }, { estabelecimentoId: dto.estabelecimentoId }, { clienteId: null }],
          AND: [{ OR: [{ estabelecimentoId: null }, { estabelecimentoId: dto.estabelecimentoId }] }]
        }
      })
    ]);
    if (!establishment) throw new NotFoundException('Estabelecimento ativo nao encontrado para o cliente');
    if (!certificate) throw new BadRequestException('Selecione um certificado ativo vinculado ao cliente ou estabelecimento');
    if (certificate.validadeFim && certificate.validadeFim < new Date()) {
      throw new BadRequestException('O certificado selecionado esta vencido');
    }
    const currentControl = await this.prisma.nfceScSyncControle.findUnique({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: dto.clienteId,
          cnpjConsulta: establishment.cnpj,
          ambiente: dto.ambiente
        }
      },
      select: { status: true }
    });
    if (currentControl?.status === NfeSyncStatus.processando) {
      throw new BadRequestException('Pause a consulta NFC-e SC antes de alterar a configuracao');
    }
    return this.prisma.nfceScSyncControle.upsert({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: dto.clienteId,
          cnpjConsulta: establishment.cnpj,
          ambiente: dto.ambiente
        }
      },
      create: {
        clienteId: dto.clienteId,
        estabelecimentoId: establishment.id,
        cnpjConsulta: establishment.cnpj,
        certificadoId: certificate.id,
        ambiente: dto.ambiente,
        indAtor: dto.indAtor,
        status: NfeSyncStatus.ativo
      },
      update: {
        estabelecimentoId: establishment.id,
        certificadoId: certificate.id,
        indAtor: dto.indAtor,
        status: NfeSyncStatus.ativo,
        proximaExecucao: null,
        ultimaMensagem: 'Configuracao atualizada; cursor NSU preservado.'
      },
      include: { estabelecimento: true, certificado: { select: { id: true, nome: true, cnpjTitular: true } } }
    });
  }

  async pause(clienteId: string, id: string) {
    const result = await this.prisma.nfceScSyncControle.updateMany({
      where: { id, clienteId },
      data: {
        status: NfeSyncStatus.pausado,
        proximaExecucao: null,
        ultimaMensagem: 'Controle pausado manualmente. A consulta em andamento sera interrompida ao concluir o lote atual.'
      }
    });
    if (!result.count) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    return { paused: true };
  }

  async run(clienteId: string, id: string) {
    const control = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
    if (!control) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    if (control.status === NfeSyncStatus.processando) return this.toRunResponse(control, false);
    if (control.proximaExecucao && control.proximaExecucao > new Date()) {
      throw new BadRequestException(`Proxima consulta permitida em ${control.proximaExecucao.toISOString()}`);
    }

    const now = new Date();
    const leaseUntil = this.newLease();
    const started = await this.prisma.nfceScSyncControle.updateMany({
      where: {
        id,
        clienteId,
        status: { notIn: [NfeSyncStatus.processando] },
        OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }]
      },
      data: {
        status: NfeSyncStatus.processando,
        proximaExecucao: leaseUntil,
        ultimaExecucao: now,
        ultimaMensagem: 'Consulta SEF/SC iniciada. A continuacao dos lotes de ate 50 documentos e automatica.'
      }
    });

    if (!started.count) {
      const current = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
      if (current?.status === NfeSyncStatus.processando) return this.toRunResponse(current, false);
      if (current?.status === NfeSyncStatus.pausado) throw new BadRequestException('O controle NFC-e SC esta pausado');
      if (current?.proximaExecucao && current.proximaExecucao > new Date()) {
        throw new BadRequestException(`Proxima consulta permitida em ${current.proximaExecucao.toISOString()}`);
      }
      throw new BadRequestException('Nao foi possivel iniciar a consulta NFC-e SC; atualize o controle e tente novamente');
    }

    const startedControl = {
      ...control,
      status: NfeSyncStatus.processando,
      ultimaMensagem: 'Consulta SEF/SC iniciada. A continuacao dos lotes de ate 50 documentos e automatica.'
    };
    this.startBackgroundExecution(id, leaseUntil);
    return this.toRunResponse(startedControl, true);
  }

  private toRunResponse(control: {
    ultimoNsuConsultado: bigint;
    totalDocumentosBaixados: number;
    ultimaMensagem: string | null;
  }, started: boolean) {
    return {
      accepted: true,
      started,
      status: NfeSyncStatus.processando,
      ultimoNsu: control.ultimoNsuConsultado.toString(),
      totalDocumentosBaixados: control.totalDocumentosBaixados,
      mensagem: control.ultimaMensagem || 'Consulta SEF/SC em andamento.'
    };
  }

  private startBackgroundExecution(id: string, leaseUntil: Date): void {
    if (this.runningControls.has(id)) return;
    this.runningControls.add(id);
    void this.processAllAvailableBatches(id, leaseUntil)
      .catch((error: unknown) => {
        this.logger.error(`Falha inesperada no sincronismo NFC-e SC ${id}: ${this.toErrorMessage(error)}`);
      })
      .finally(() => this.runningControls.delete(id));
  }

  private async processAllAvailableBatches(id: string, initialLease: Date): Promise<void> {
    let leaseUntil = initialLease;
    let savedInExecution = 0;

    while (true) {
      const control = await this.prisma.nfceScSyncControle.findUnique({ where: { id } });
      if (!control || control.status !== NfeSyncStatus.processando || !this.sameDate(control.proximaExecucao, leaseUntil)) return;

      const renewedLease = this.newLease();
      const renewed = await this.prisma.nfceScSyncControle.updateMany({
        where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
        data: { proximaExecucao: renewedLease }
      });
      if (!renewed.count) return;
      leaseUntil = renewedLease;

      let result;
      try {
        result = await this.client.download({
          clienteId: control.clienteId,
          cnpjConsulta: control.cnpjConsulta,
          certificadoId: control.certificadoId || '',
          ambiente: control.ambiente,
          ultimoNsu: control.ultimoNsuConsultado,
          indAtor: control.indAtor
        });
      } catch (error) {
        await this.stopAfterError(id, leaseUntil, error);
        return;
      }

      let cursor = control.ultimoNsuConsultado;
      try {
        for (const document of result.documentos) {
          await this.nfeService.persistNfceScDocument({
            clienteId: control.clienteId,
            estabelecimentoId: control.estabelecimentoId,
            ambiente: control.ambiente,
            cnpjConsulta: control.cnpjConsulta,
            xml: document.xml
          });
          savedInExecution += 1;
          if (document.nsu > cursor) cursor = document.nsu;
        }
      } catch (error) {
        await this.stopAfterError(id, leaseUntil, error);
        return;
      }

      const shouldContinue = result.cStat === '118' && result.documentos.length === NfceScService.BATCH_SIZE;
      if (shouldContinue && cursor <= control.ultimoNsuConsultado) {
        await this.stopAfterError(
          id,
          leaseUntil,
          new Error('A SEF/SC retornou um lote completo sem avancar o NSU; consulta interrompida para evitar repetir o mesmo lote.')
        );
        return;
      }

      const authFailure = result.cStat === '8002' || result.cStat === '8004';
      const certificateFailure = ['280', '281', '282', '283', '284', '285', '286'].includes(result.cStat);
      const status = authFailure
        ? NfeSyncStatus.erro_autorizacao
        : certificateFailure
          ? NfeSyncStatus.erro_certificado
          : NfeSyncStatus.ativo;
      const completed = result.cStat === '117' || (result.cStat === '118' && result.documentos.length < NfceScService.BATCH_SIZE);
      const retryOneHour = result.cStat !== '117' && result.cStat !== '118';
      const now = new Date();
      const next = shouldContinue
        ? this.newLease()
        : retryOneHour
          ? new Date(now.getTime() + 60 * 60 * 1000)
          : completed
            ? new Date(now.getTime() + 12 * 60 * 60 * 1000)
            : new Date(now.getTime() + 60 * 60 * 1000);
      const message = shouldContinue
        ? `SEF/SC ${result.cStat}: lote de ${result.documentos.length} documento(s) salvo. Continuando automaticamente; ${savedInExecution} documento(s) nesta execucao, NSU ${cursor}.`
        : `SEF/SC ${result.cStat}: ${result.xMotivo}. ${savedInExecution} documento(s) armazenado(s) nesta execucao. NSU ${cursor}.`;
      const updated = await this.prisma.nfceScSyncControle.updateMany({
        where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
        data: {
          status: shouldContinue ? NfeSyncStatus.processando : status,
          ultimoNsuConsultado: cursor,
          ultimaExecucao: now,
          proximaExecucao: next,
          totalDocumentosBaixados: { increment: result.documentos.length },
          ultimaMensagem: message
        }
      });
      if (!updated.count) return;
      if (!shouldContinue) return;
      leaseUntil = next;
    }
  }

  private async stopAfterError(id: string, leaseUntil: Date, error: unknown): Promise<void> {
    const message = this.toErrorMessage(error);
    const certificateError = /certificado|pfx|tls|handshake/i.test(message);
    await this.prisma.nfceScSyncControle.updateMany({
      where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
      data: {
        status: certificateError ? NfeSyncStatus.erro_certificado : NfeSyncStatus.erro_api,
        ultimaExecucao: new Date(),
        proximaExecucao: new Date(Date.now() + 60 * 60 * 1000),
        ultimaMensagem: message
      }
    });
    this.logger.warn(`Sincronismo NFC-e SC ${id} interrompido: ${message}`);
  }

  private async resumeExpiredExecutions(): Promise<void> {
    try {
      const now = new Date();
      const expired = await this.prisma.nfceScSyncControle.findMany({
        where: { status: NfeSyncStatus.processando, proximaExecucao: { lte: now } },
        select: { id: true }
      });
      for (const { id } of expired) {
        if (this.runningControls.has(id)) continue;
        const leaseUntil = this.newLease();
        const claimed = await this.prisma.nfceScSyncControle.updateMany({
          where: { id, status: NfeSyncStatus.processando, proximaExecucao: { lte: now } },
          data: {
            proximaExecucao: leaseUntil,
            ultimaMensagem: 'Retomando automaticamente a consulta SEF/SC a partir do ultimo NSU salvo.'
          }
        });
        if (claimed.count) this.startBackgroundExecution(id, leaseUntil);
      }
    } catch (error) {
      this.logger.warn(`Nao foi possivel verificar consultas NFC-e SC pendentes: ${this.toErrorMessage(error)}`);
    }
  }

  private newLease(): Date {
    return new Date(Date.now() + NfceScService.EXECUTION_LEASE_MS);
  }

  private sameDate(left: Date | null, right: Date): boolean {
    return left instanceof Date && left.getTime() === right.getTime();
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
