import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSystemUpdateDto } from './dto/create-system-update.dto';

const REPORT_TIME_ZONE = 'America/Sao_Paulo';

@Injectable()
export class UpdatesService {
  private readonly dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  constructor(private readonly prisma: PrismaService) {}

  listSystemUpdates() {
    return this.prisma.sistemaAtualizacao.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }

  listDailyReports() {
    return this.prisma.relatorioAtualizacaoDiario.findMany({
      orderBy: { dataReferencia: 'desc' },
      take: 120
    });
  }

  async createSystemUpdate(dto: CreateSystemUpdateDto, user: AuthenticatedUser) {
    const titulo = String(dto.titulo ?? '').trim();
    const descricao = String(dto.descricao ?? '').trim();
    if (titulo.length < 3 || titulo.length > 160 || descricao.length < 3 || descricao.length > 10000) {
      throw new BadRequestException('Informe titulo e descricao validos para a atualizacao.');
    }

    return this.prisma.sistemaAtualizacao.create({
      data: {
        titulo,
        descricao,
        autorId: user.userId,
        autorNome: String(user.nome || user.username || 'Administrador').trim()
      }
    });
  }

  async generateCurrentDailyReportIfDue(now = new Date()) {
    const localParts = this.getTimeZoneParts(now);
    const hour = Number(localParts.hour);
    const minute = Number(localParts.minute);
    if (hour < 17 || (hour === 17 && minute < 30)) {
      return null;
    }

    const dateKey = `${localParts.year}-${localParts.month}-${localParts.day}`;
    return this.generateDailyReport(dateKey);
  }

  async generateDailyReport(dateKey: string) {
    const reportDate = this.parseDateKey(dateKey);
    const existing = await this.prisma.relatorioAtualizacaoDiario.findUnique({
      where: { dataReferencia: reportDate }
    });
    if (existing) {
      return existing;
    }

    const { start, end } = this.getSaoPauloDayBounds(dateKey);
    const updates = await this.prisma.sistemaAtualizacao.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'asc' }
    });
    const records = updates.map((update) => ({
      id: update.id,
      titulo: update.titulo,
      descricao: update.descricao,
      autorNome: update.autorNome,
      createdAt: update.createdAt.toISOString()
    }));

    return this.prisma.relatorioAtualizacaoDiario.upsert({
      where: { dataReferencia: reportDate },
      create: {
        dataReferencia: reportDate,
        registros: records as Prisma.InputJsonValue
      },
      update: {}
    });
  }

  private getSaoPauloDayBounds(dateKey: string): { start: Date; end: Date } {
    const [year, month, day] = this.parseDateKeyParts(dateKey);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const nextKey = [nextDay.getUTCFullYear(), String(nextDay.getUTCMonth() + 1).padStart(2, '0'), String(nextDay.getUTCDate()).padStart(2, '0')].join('-');
    return {
      start: this.localMidnightToUtc(dateKey),
      end: this.localMidnightToUtc(nextKey)
    };
  }

  private localMidnightToUtc(dateKey: string): Date {
    const [year, month, day] = this.parseDateKeyParts(dateKey);
    const localWallClockAsUtc = Date.UTC(year, month - 1, day);
    const offsetMinutes = this.getTimeZoneOffsetMinutes(new Date(localWallClockAsUtc));
    return new Date(localWallClockAsUtc - offsetMinutes * 60 * 1000);
  }

  private getTimeZoneOffsetMinutes(instant: Date): number {
    const parts = this.getTimeZoneParts(instant);
    const localAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return (localAsUtc - instant.getTime()) / (60 * 1000);
  }

  private getTimeZoneParts(instant: Date): Record<string, string> {
    return this.dateTimeFormatter.formatToParts(instant).reduce<Record<string, string>>((parts, part) => {
      if (part.type !== 'literal') {
        parts[part.type] = part.value;
      }
      return parts;
    }, {});
  }

  private parseDateKey(dateKey: string): Date {
    const [year, month, day] = this.parseDateKeyParts(dateKey);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private parseDateKeyParts(dateKey: string): [number, number, number] {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!match) {
      throw new BadRequestException('A data do relatorio deve seguir o formato AAAA-MM-DD.');
    }

    const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() + 1 !== parts[1] || date.getUTCDate() !== parts[2]) {
      throw new BadRequestException('A data do relatorio informada nao existe.');
    }
    return parts;
  }
}
