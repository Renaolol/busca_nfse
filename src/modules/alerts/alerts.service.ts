import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertResponseDto } from './dto/alert-response.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';

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

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryAlertsDto = {}): Promise<AlertResponseDto[]> {
    const rows = await this.prisma.nfeEvento.findMany({
      where: {
        nfeDocumento: {
          modelo: '57',
          ...(query.clienteId ? { clienteId: query.clienteId } : {})
        },
        descricao: {
          contains: 'desacordo',
          mode: 'insensitive'
        },
        ...(query.status === 'Aberto'
          ? { cteDesacordoResolucao: { is: null } }
          : query.status === 'Resolvido'
            ? { cteDesacordoResolucao: { isNot: null } }
            : {})
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
    });

    return rows.filter((row) => this.isDesacordoEvent(row)).map((row) => this.toAlertDto(row));
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

    return this.toAlertDto(refreshed);
  }

  private toAlertDto(row: CteDesacordoAlertRow): AlertResponseDto {
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
      resolvedAt: row.cteDesacordoResolucao?.resolvidoEm.toISOString() ?? null
    };
  }

  private isDesacordoEvent(row: Pick<CteDesacordoAlertRow, 'descricao' | 'tipoEvento'>): boolean {
    const description = this.normalizeSearchText(row.descricao);
    const eventType = this.normalizeSearchText(row.tipoEvento);
    return description.includes('desacordo') || eventType.includes('desacordo');
  }

  private normalizeSearchText(value?: string | null): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
