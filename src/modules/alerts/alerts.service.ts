import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertResolution, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NfseDanfseService } from '../nfse/nfse-danfse.service';
import { LocalStorageService } from '../storage/storage.service';
import { AlertResponseDto } from './dto/alert-response.dto';
import { AlertResolutionResponseDto } from './dto/alert-resolution-response.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';
import { UpdateAlertResolutionDto } from './dto/update-alert-resolution.dto';

type CteDesacordoAlertRow = Prisma.NfeEventoGetPayload<{
  include: {
    cteDesacordoResolucao: true;
    nfeDocumento: {
      include: {
        cliente: true;
      };
    };
  };
}>;

type NfseRetencaoAlertRow = Prisma.NfseDocumentoGetPayload<{
  include: {
    cliente: true;
    estabelecimento: true;
  };
}>;

const NFSE_RETENTION_ALERT_START_DATE = new Date('2026-07-01T00:00:00.000Z');

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly nfseDanfse: NfseDanfseService
  ) {}

  async findAll(query: QueryAlertsDto = {}): Promise<AlertResponseDto[]> {
    const [cteRows, nfseRows] = await Promise.all([
      this.prisma.nfeEvento.findMany({
        where: {
          nfeDocumento: {
            modelo: '57',
            ...(query.clienteId ? { clienteId: query.clienteId } : {})
          },
          descricao: {
            contains: 'desacordo',
            mode: 'insensitive'
          }
        },
        include: {
          cteDesacordoResolucao: true,
          nfeDocumento: {
            include: {
              cliente: true
            }
          }
        },
        orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
      }),
      this.prisma.nfseDocumento.findMany({
        where: {
          ...(query.clienteId ? { clienteId: query.clienteId } : {}),
          xmlPath: { not: null },
          cnpjTomador: { not: null },
          dataCancelamento: null,
          dataEmissao: { gte: NFSE_RETENTION_ALERT_START_DATE }
        },
        include: {
          cliente: true,
          estabelecimento: true
        },
        orderBy: [{ dataEmissao: 'desc' }, { updatedAt: 'desc' }]
      })
    ]);

    const cteAlerts = cteRows.filter((row) => this.isDesacordoEvent(row)).map((row) => this.toCteAlertDto(row));
    const nfseAlertsRaw = await Promise.all(nfseRows.map((row) => this.toNfseRetentionAlertDto(row)));
    const alerts = [...cteAlerts, ...nfseAlertsRaw.filter((row): row is AlertResponseDto => Boolean(row))];

    await this.applyGenericResolutionState(alerts);

    return alerts
      .filter((alert) => this.matchesStatusFilter(alert, query.status))
      .sort((left, right) => Date.parse(right.dataHora || '') - Date.parse(left.dataHora || ''));
  }

  async updateCteDesacordoResolution(eventId: string, resolved: boolean): Promise<AlertResponseDto> {
    const event = await this.prisma.nfeEvento.findUnique({
      where: { id: eventId },
      include: {
        cteDesacordoResolucao: true,
        nfeDocumento: {
          include: {
            cliente: true
          }
        }
      }
    });

    if (!event || event.nfeDocumento.modelo !== '57' || !this.isDesacordoEvent(event)) {
      throw new NotFoundException('Alerta de desacordo de CT-e nao encontrado');
    }

    if (resolved) {
      await this.prisma.cteDesacordoResolucao.upsert({
        where: { nfeEventoId: eventId },
        update: { resolvidoEm: new Date() },
        create: {
          nfeEventoId: eventId,
          resolvidoEm: new Date()
        }
      });
    } else {
      await this.prisma.cteDesacordoResolucao.deleteMany({
        where: { nfeEventoId: eventId }
      });
    }

    const refreshed = await this.prisma.nfeEvento.findUnique({
      where: { id: eventId },
      include: {
        cteDesacordoResolucao: true,
        nfeDocumento: {
          include: {
            cliente: true
          }
        }
      }
    });

    if (!refreshed) {
      throw new NotFoundException('Alerta de desacordo de CT-e nao encontrado');
    }

    return this.toCteAlertDto(refreshed);
  }

  async listResolutions(query: QueryAlertsDto = {}): Promise<AlertResolutionResponseDto[]> {
    const rows = await this.prisma.alertResolution.findMany({
      where: query.clienteId ? { clienteId: query.clienteId } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 1000
    });

    return rows.map((row) => this.toResolutionDto(row));
  }

  async updateResolution(alertId: string, dto: UpdateAlertResolutionDto): Promise<AlertResolutionResponseDto> {
    if (!dto.resolvido) {
      await this.prisma.alertResolution.deleteMany({
        where: { alertId }
      });

      return {
        alertId,
        fingerprint: dto.fingerprint,
        clientId: dto.clientId ?? null,
        origem: dto.origem ?? null,
        titulo: dto.titulo ?? null,
        resolvedAt: null
      };
    }

    const resolution = await this.prisma.alertResolution.upsert({
      where: { alertId },
      update: {
        fingerprint: dto.fingerprint,
        clienteId: dto.clientId ?? null,
        origem: dto.origem ?? null,
        titulo: dto.titulo ?? null,
        resolvedAt: new Date()
      },
      create: {
        alertId,
        fingerprint: dto.fingerprint,
        clienteId: dto.clientId ?? null,
        origem: dto.origem ?? null,
        titulo: dto.titulo ?? null,
        resolvedAt: new Date()
      }
    });

    return this.toResolutionDto(resolution);
  }

  private toCteAlertDto(row: CteDesacordoAlertRow): AlertResponseDto {
    const numeroDocumento = String(row.nfeDocumento.numeroNfe || '').trim() || row.chaveAcesso;
    const eventoDescricao = String(row.descricao || 'Evento de desacordo').trim() || 'Evento de desacordo';

    return {
      id: `cte-desacordo-${row.id}`,
      eventId: row.id,
      severity: 'Atencao',
      tipo: 'CT-e',
      titulo: 'CT-e com evento de desacordo',
      descricao: `O CT-e ${numeroDocumento} recebeu o evento "${eventoDescricao}".`,
      clientId: row.nfeDocumento.clienteId,
      cliente: row.nfeDocumento.cliente?.razaoSocial || 'Cliente nao identificado',
      dataHora: (row.dataEvento ?? row.createdAt).toISOString(),
      status: row.cteDesacordoResolucao ? 'Resolvido' : 'Aberto',
      origem: 'cte-desacordo',
      mensagemTecnica: `Evento ${row.tipoEvento || 'desconhecido'} vinculado ao CT-e ${row.chaveAcesso}.`,
      sugestaoAcao: 'Conferir o desacordo com a empresa e validar se o CT-e precisa de tratamento operacional.',
      historicoTentativas: [],
      allowsReprocess: false,
      persistence: 'server',
      canToggleResolved: true,
      documentoId: row.nfeDocumentoId,
      chaveAcesso: row.chaveAcesso,
      numeroDocumento,
      eventoTipo: row.tipoEvento || '',
      eventoDescricao,
      resolvedAt: row.cteDesacordoResolucao?.resolvidoEm.toISOString() ?? null,
      emissor: row.nfeDocumento.cliente?.razaoSocial || 'Emissor nao identificado',
      retencoes: []
    };
  }

  private async toNfseRetentionAlertDto(row: NfseRetencaoAlertRow): Promise<AlertResponseDto | null> {
    if (!this.isNfseTomada(row) || !this.isNfseRetentionDateEligible(row.dataEmissao)) {
      return null;
    }

    const xmlPath = String(row.xmlPath || '').trim();
    if (!xmlPath) {
      return null;
    }

    try {
      const xml = (await this.storage.getObject(xmlPath)).toString('utf8');
      const retentionData = this.nfseDanfse.extractRetentionAlertData(xml);
      if (!retentionData.hasRetention) {
        return null;
      }

      const numeroDocumento = String(row.numeroNfse || '').trim() || row.chaveAcesso;
      const emissor = String(row.razaoSocialPrestador || '').trim() || 'Emissor nao identificado';
      const retencoes = retentionData.entries.map((entry) => (entry.amount ? `${entry.label}: ${entry.amount}` : entry.label));
      const descricao =
        retencoes.length > 0
          ? `A NFS-e ${numeroDocumento} de entrada possui retencoes: ${retencoes.join(', ')}.`
          : `A NFS-e ${numeroDocumento} de entrada possui retencoes.`;

      return {
        id: `nfse-retencao-${row.id}`,
        eventId: row.id,
        severity: 'Atencao',
        tipo: 'NFS-e',
        titulo: 'NFS-e de entrada com retencao',
        descricao,
        clientId: row.clienteId,
        cliente: row.cliente?.razaoSocial || 'Cliente nao identificado',
        dataHora: (row.dataEmissao ?? row.updatedAt ?? row.createdAt).toISOString(),
        status: 'Aberto',
        origem: 'nfse-retencao-entrada',
        mensagemTecnica: `Prestador ${emissor}; chave ${row.chaveAcesso}.`,
        sugestaoAcao: 'Conferir as retencoes da NFS-e com a empresa e validar o tratamento fiscal e operacional.',
        historicoTentativas: [],
        allowsReprocess: false,
        persistence: 'client',
        canToggleResolved: true,
        documentoId: row.id,
        chaveAcesso: row.chaveAcesso,
        numeroDocumento,
        eventoTipo: '',
        eventoDescricao: '',
        resolvedAt: null,
        emissor,
        retencoes
      };
    } catch {
      return null;
    }
  }

  private isDesacordoEvent(row: Pick<CteDesacordoAlertRow, 'descricao' | 'tipoEvento'>): boolean {
    const description = this.normalizeSearchText(row.descricao);
    const eventType = this.normalizeSearchText(row.tipoEvento);
    return description.includes('desacordo') || eventType.includes('desacordo');
  }

  private isNfseTomada(row: Pick<NfseRetencaoAlertRow, 'cnpjTomador' | 'estabelecimento'>): boolean {
    return this.normalizeDigits(row.cnpjTomador) === this.normalizeDigits(row.estabelecimento?.cnpj);
  }

  private isNfseRetentionDateEligible(value?: Date | null): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime()) && value >= NFSE_RETENTION_ALERT_START_DATE;
  }

  private async applyGenericResolutionState(alerts: AlertResponseDto[]): Promise<void> {
    const genericAlerts = alerts.filter((alert) => String(alert.persistence || '').toLowerCase() !== 'server');
    const alertIds = genericAlerts.map((alert) => alert.id).filter(Boolean);
    if (!alertIds.length) {
      return;
    }

    const resolutions = await this.prisma.alertResolution.findMany({
      where: {
        alertId: {
          in: alertIds
        }
      }
    });
    const resolutionById = new Map(resolutions.map((resolution) => [resolution.alertId, resolution]));

    genericAlerts.forEach((alert) => {
      const resolution = resolutionById.get(alert.id);
      if (!resolution) {
        return;
      }

      const fingerprint = this.buildGenericAlertFingerprint(alert);
      if (resolution.fingerprint !== fingerprint) {
        return;
      }

      alert.status = 'Resolvido';
      alert.resolvedAt = resolution.resolvedAt?.toISOString() ?? resolution.updatedAt.toISOString();
    });
  }

  private matchesStatusFilter(alert: AlertResponseDto, status?: QueryAlertsDto['status']): boolean {
    if (!status || status === 'Todos') {
      return true;
    }
    return alert.status === status;
  }

  private buildGenericAlertFingerprint(alert: AlertResponseDto): string {
    return JSON.stringify([
      alert.id,
      alert.origem || '',
      alert.dataHora || '',
      alert.titulo || '',
      alert.descricao || '',
      alert.mensagemTecnica || ''
    ]);
  }

  private normalizeSearchText(value?: string | null): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private normalizeDigits(value?: string | null): string {
    return String(value || '').replace(/\D/g, '');
  }

  private toResolutionDto(row: AlertResolution): AlertResolutionResponseDto {
    return {
      alertId: row.alertId,
      fingerprint: row.fingerprint,
      clientId: row.clienteId,
      origem: row.origem,
      titulo: row.titulo,
      resolvedAt: row.resolvedAt?.toISOString() ?? null
    };
  }
}
