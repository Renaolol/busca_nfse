import { Injectable, BadRequestException } from '@nestjs/common';
import { CompareSpedHistorico, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListCompareSpedHistoricoQueryDto } from './dto/list-compare-sped-historico.dto';
import { SaveCompareSpedHistoricoDto } from './dto/save-compare-sped-historico.dto';

export interface CompareSpedHistoricoResponseDto {
  id: string;
  clientId: string | null;
  clientName: string;
  clientCnpj: string | null;
  competence: string | null;
  sourceFileName: string;
  outputFormat: 'Excel' | 'PDF';
  generatedAt: string;
  report: Record<string, unknown>;
}

@Injectable()
export class CompareSpedService {
  private readonly historyLimit = 10;

  constructor(private readonly prisma: PrismaService) {}

  async listHistory(query: ListCompareSpedHistoricoQueryDto): Promise<CompareSpedHistoricoResponseDto[]> {
    const where: Prisma.CompareSpedHistoricoWhereInput = {};
    const clienteId = this.normalizeUuid(query.clienteId);
    if (clienteId) {
      where.clienteId = clienteId;
    }

    const limit = this.normalizeLimit(query.limit);
    const items = await this.prisma.compareSpedHistorico.findMany({
      where,
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });

    return items.map((item) => this.mapToResponse(item));
  }

  async saveHistory(dto: SaveCompareSpedHistoricoDto): Promise<CompareSpedHistoricoResponseDto> {
    if (!dto.report || typeof dto.report !== 'object' || Array.isArray(dto.report)) {
      throw new BadRequestException('Informe um relatorio de comparacao valido.');
    }

    const generatedAt = this.parseDate(dto.generatedAt ?? this.readGeneratedAt(dto.report)) ?? new Date();
    const clientName = this.normalizeText(dto.clientName, 255);
    const sourceFileName = this.normalizeText(dto.sourceFileName, 255);

    if (!clientName) {
      throw new BadRequestException('Informe o nome da empresa da comparacao.');
    }

    if (!sourceFileName) {
      throw new BadRequestException('Informe o arquivo de origem da comparacao.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const record = await tx.compareSpedHistorico.create({
        data: {
          clienteId: this.normalizeUuid(dto.clienteId),
          clientName,
          clientCnpj: this.normalizeDigits(dto.clientCnpj, 14),
          competence: this.normalizeText(dto.competence, 20),
          sourceFileName,
          outputFormat: dto.outputFormat,
          generatedAt,
          report: dto.report as Prisma.InputJsonValue
        }
      });

      await this.pruneHistory(tx, record.clienteId);
      return record;
    });

    return this.mapToResponse(created);
  }

  private async pruneHistory(
    tx: Prisma.TransactionClient,
    clienteId: string | null
  ): Promise<void> {
    const where: Prisma.CompareSpedHistoricoWhereInput = {};
    if (clienteId) {
      where.clienteId = clienteId;
    }

    const items = await tx.compareSpedHistorico.findMany({
      where,
      orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }],
      skip: this.historyLimit,
      select: { id: true }
    });

    if (!items.length) {
      return;
    }

    await tx.compareSpedHistorico.deleteMany({
      where: {
        id: {
          in: items.map((item) => item.id)
        }
      }
    });
  }

  private mapToResponse(item: CompareSpedHistorico): CompareSpedHistoricoResponseDto {
    return {
      id: item.id,
      clientId: item.clienteId,
      clientName: item.clientName,
      clientCnpj: item.clientCnpj,
      competence: item.competence,
      sourceFileName: item.sourceFileName,
      outputFormat: item.outputFormat as 'Excel' | 'PDF',
      generatedAt: item.generatedAt.toISOString(),
      report: this.normalizeReport(item.report)
    };
  }

  private normalizeReport(report: Prisma.JsonValue): Record<string, unknown> {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return {};
    }

    return report as Record<string, unknown>;
  }

  private readGeneratedAt(report: Record<string, unknown>): string | null {
    const generatedAt = report.generatedAt;
    return typeof generatedAt === 'string' ? generatedAt : null;
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) {
      return this.historyLimit;
    }

    return Math.max(1, Math.min(50, Math.floor(limit as number)));
  }

  private normalizeDigits(value?: string | null, expectedLength?: number): string | null {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) {
      return null;
    }

    if (expectedLength && digits.length !== expectedLength) {
      return null;
    }

    return digits;
  }

  private normalizeText(value?: string | null, maxLength = 255): string | null {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) {
      return null;
    }

    return text.slice(0, maxLength);
  }

  private normalizeUuid(value?: string | null): string | null {
    const text = String(value || '').trim();
    return text || null;
  }

  private parseDate(value?: string | null): Date | null {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
