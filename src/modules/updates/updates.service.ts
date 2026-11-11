import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSystemUpdateDto } from './dto/create-system-update.dto';

const REPORT_TIME_ZONE = 'America/Sao_Paulo';
const PDF_COLORS = {
  navy: '#191923',
  gold: '#F4C21B',
  text: '#202635',
  muted: '#687386',
  line: '#DCE1E9',
  surface: '#F4F6F9',
  white: '#FFFFFF'
};

type DailyUpdateEntry = {
  titulo: string;
  descricao: string;
  autorNome: string;
  createdAt: string;
};

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

  async getDailyReportPdf(id: string) {
    const report = await this.prisma.relatorioAtualizacaoDiario.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('Relatorio diario de atualizacoes nao encontrado.');
    }

    const entries = this.toDailyUpdateEntries(report.registros);
    const pdfBuffer = await this.createDailyReportPdf(report.dataReferencia, report.geradoEm, entries);
    const dateKey = report.dataReferencia.toISOString().slice(0, 10);
    return {
      id: report.id,
      fileName: `relatorio-atualizacoes-${dateKey}.pdf`,
      contentType: 'application/pdf',
      contentBase64: pdfBuffer.toString('base64')
    };
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

  private toDailyUpdateEntries(value: Prisma.JsonValue): DailyUpdateEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry) => {
      const record = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
      return {
        titulo: this.pdfSafeText(String(record.titulo ?? 'Atualizacao')),
        descricao: this.pdfSafeText(String(record.descricao ?? '')),
        autorNome: this.pdfSafeText(String(record.autorNome ?? 'Equipe NotaSync')),
        createdAt: String(record.createdAt ?? '')
      };
    });
  }

  private async createDailyReportPdf(date: Date, generatedAt: Date, entries: DailyUpdateEntry[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        margins: { top: 80, bottom: 80, left: 52, right: 52 },
        bufferPages: true,
        info: {
          Title: `Relatório de atualizações - ${this.formatSaoPauloDate(date)}`,
          Author: 'GCONT Gestão Contábil',
          Subject: 'Atualizações do sistema NotaSync'
        }
      });
      const chunks: Buffer[] = [];
      const pageWidth = document.page.width;
      const pageHeight = document.page.height;
      const left = 52;
      const right = pageWidth - 52;
      const contentWidth = right - left;
      const dateLabel = this.formatSaoPauloDate(date);

      document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));

      this.drawReportCoverHeader(document, pageWidth, left, dateLabel);
      document.y = 164;
      this.drawReportSummary(document, left, contentWidth, date, generatedAt, entries.length);
      document.moveDown(1.25);
      document.font('Helvetica-Bold').fontSize(13).fillColor(PDF_COLORS.text).text('Atualizações publicadas', left, document.y, {
        width: contentWidth
      });
      document.moveDown(0.45);

      if (!entries.length) {
        document
          .roundedRect(left, document.y, contentWidth, 54, 8)
          .fillAndStroke(PDF_COLORS.surface, PDF_COLORS.line);
        document
          .font('Helvetica')
          .fontSize(10)
          .fillColor(PDF_COLORS.muted)
          .text('Nenhuma atualização foi registrada nesta data.', left + 16, document.y + 19, { width: contentWidth - 32 });
        document.y += 72;
      }

      entries.forEach((entry, index) => {
        const title = this.pdfSafeText(entry.titulo || 'Atualizacao');
        const description = this.pdfSafeText(entry.descricao || '');
        const author = this.pdfSafeText(entry.autorNome || 'Equipe NotaSync');
        const timestamp = this.formatSaoPauloDateTime(entry.createdAt);
        const titleWidth = contentWidth - 32;
        document.font('Helvetica-Bold').fontSize(11.5);
        const titleHeight = document.heightOfString(title, { width: titleWidth });
        document.font('Helvetica').fontSize(8.5);
        const metadataHeight = document.heightOfString(`${author} | ${timestamp}`, { width: titleWidth });
        const headingHeight = 12 + titleHeight + 5 + metadataHeight + 12;

        if (document.y + headingHeight + 30 > pageHeight - 90) {
          document.addPage();
        }

        const headingY = document.y;
        document.roundedRect(left, headingY, contentWidth, headingHeight, 8).fill(PDF_COLORS.surface);
        document.roundedRect(left, headingY, 4, headingHeight, 2).fill(PDF_COLORS.gold);
        document
          .font('Helvetica-Bold')
          .fontSize(11.5)
          .fillColor(PDF_COLORS.text)
          .text(title, left + 16, headingY + 10, { width: titleWidth });
        document
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor(PDF_COLORS.muted)
          .text(`${author} | ${timestamp}`, left + 16, headingY + 10 + titleHeight + 5, { width: titleWidth });
        document.y = headingY + headingHeight + 8;

        const label = `ATUALIZAÇÃO ${String(index + 1).padStart(2, '0')}`;
        document.font('Helvetica-Bold').fontSize(7.5).fillColor('#9A7300').text(label, left + 2, document.y, { characterSpacing: 0.7 });
        document.moveDown(0.4);
        document
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor(PDF_COLORS.text)
          .text(description || 'Sem descrição informada.', left + 2, document.y, {
            width: contentWidth - 4,
            lineGap: 3,
            paragraphGap: 5
          });
        document.moveDown(0.8);
        if (document.y < pageHeight - 100) {
          document.moveTo(left, document.y).lineTo(right, document.y).lineWidth(0.6).strokeColor(PDF_COLORS.line).stroke();
          document.moveDown(0.9);
        }
      });

      const pageRange = document.bufferedPageRange();
      for (let pageIndex = 0; pageIndex < pageRange.count; pageIndex += 1) {
        document.switchToPage(pageIndex);
        if (pageIndex > 0) {
          this.drawReportContinuationHeader(document, pageWidth, left, dateLabel);
        }
        const originalBottomMargin = document.page.margins.bottom;
        document.page.margins.bottom = 22;
        document
          .moveTo(left, pageHeight - 64)
          .lineTo(right, pageHeight - 64)
          .lineWidth(0.7)
          .strokeColor(PDF_COLORS.line)
          .stroke();
        document.font('Helvetica').fontSize(8).fillColor(PDF_COLORS.muted);
        document.text('NotaSync | GCONT Gestão Contábil', left, pageHeight - 50);
        document.text(`Página ${pageIndex + 1} de ${pageRange.count}`, left, pageHeight - 50, {
          width: contentWidth,
          align: 'right'
        });
        document.page.margins.bottom = originalBottomMargin;
      }

      document.end();
    });
  }

  private drawReportCoverHeader(document: PDFKit.PDFDocument, pageWidth: number, left: number, dateLabel: string): void {
    document.rect(0, 0, pageWidth, 142).fill(PDF_COLORS.navy);
    document.rect(0, 142, pageWidth, 3).fill(PDF_COLORS.gold);
    document.font('Helvetica-Bold').fontSize(9).fillColor(PDF_COLORS.gold).text('NOTASYNC | GCONT GESTÃO CONTÁBIL', left, 32);
    document.font('Helvetica-Bold').fontSize(22).fillColor(PDF_COLORS.white).text('Relatório diário', left, 60);
    document.font('Helvetica').fontSize(13).fillColor('#D5D9E2').text('Atualizações do sistema', left, 91);
    document.font('Helvetica').fontSize(9).fillColor('#B8BECA').text(`Data de referência: ${dateLabel}`, left, 116);
  }

  private drawReportContinuationHeader(document: PDFKit.PDFDocument, pageWidth: number, left: number, dateLabel: string): void {
    document.rect(0, 0, pageWidth, 52).fill(PDF_COLORS.navy);
    document.rect(0, 52, pageWidth, 2).fill(PDF_COLORS.gold);
    document.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.gold).text('NOTASYNC | GCONT GESTÃO CONTÁBIL', left, 17);
    document.font('Helvetica').fontSize(8.5).fillColor(PDF_COLORS.white).text(`Relatório de atualizações - ${dateLabel}`, left, 31);
    document.y = 72;
  }

  private drawReportSummary(
    document: PDFKit.PDFDocument,
    left: number,
    contentWidth: number,
    date: Date,
    generatedAt: Date,
    entryCount: number
  ): void {
    const gap = 9;
    const cardWidth = (contentWidth - gap * 2) / 3;
    const y = document.y;
    const items = [
      { label: 'DATA DO RELATÓRIO', value: this.formatSaoPauloDate(date) },
      { label: 'GERADO EM', value: this.formatSaoPauloDateTime(generatedAt) },
      { label: 'ATUALIZAÇÕES', value: String(entryCount) }
    ];

    items.forEach((item, index) => {
      const x = left + index * (cardWidth + gap);
      document.roundedRect(x, y, cardWidth, 58, 8).fillAndStroke('#FAFBFC', PDF_COLORS.line);
      document.font('Helvetica-Bold').fontSize(7).fillColor(PDF_COLORS.muted).text(item.label, x + 10, y + 11, {
        width: cardWidth - 20,
        characterSpacing: 0.4
      });
      document.font('Helvetica-Bold').fontSize(index === 2 ? 16 : 9.5).fillColor(PDF_COLORS.text).text(item.value, x + 10, y + 29, {
        width: cardWidth - 20
      });
    });
    document.y = y + 70;
  }

  private formatSaoPauloDate(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  private formatSaoPauloDateTime(value: Date | string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Horário não informado';
    }
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: REPORT_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(date);
  }

  private pdfSafeText(value: string): string {
    return value
      .replace(/\r\n?/g, '\n')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2022/g, '-')
      .replace(/[^\u0000-\u00FF]/g, '?');
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
