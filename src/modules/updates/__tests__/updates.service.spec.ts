import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdatesService } from '../updates.service';

describe('UpdatesService', () => {
  const prisma = {
    sistemaAtualizacao: {
      findMany: jest.fn(),
      create: jest.fn()
    },
    relatorioAtualizacaoDiario: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn()
    }
  };
  const service = new UpdatesService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.sistemaAtualizacao.findMany.mockResolvedValue([]);
    prisma.sistemaAtualizacao.create.mockResolvedValue({ id: 'update-1' });
    prisma.relatorioAtualizacaoDiario.findMany.mockResolvedValue([]);
    prisma.relatorioAtualizacaoDiario.findUnique.mockResolvedValue(null);
    prisma.relatorioAtualizacaoDiario.upsert.mockResolvedValue({ id: 'report-1' });
  });

  it('nao gera o relatorio antes das 17h30 no horario de Brasilia', async () => {
    const result = await service.generateCurrentDailyReportIfDue(new Date('2026-11-10T20:29:00.000Z'));

    expect(result).toBeNull();
    expect(prisma.relatorioAtualizacaoDiario.findUnique).not.toHaveBeenCalled();
  });

  it('gera um retrato das atualizacoes do dia as 17h30 no horario de Brasilia', async () => {
    const createdAt = new Date('2026-11-10T14:00:00.000Z');
    prisma.sistemaAtualizacao.findMany.mockResolvedValue([
      {
        id: 'update-1',
        titulo: 'Novo painel',
        descricao: 'A tela de atualizacoes foi adicionada.',
        autorNome: 'Admin GCONT',
        createdAt
      }
    ]);

    await service.generateCurrentDailyReportIfDue(new Date('2026-11-10T20:30:00.000Z'));

    expect(prisma.sistemaAtualizacao.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date('2026-11-10T03:00:00.000Z'),
          lt: new Date('2026-11-11T03:00:00.000Z')
        }
      },
      orderBy: { createdAt: 'asc' }
    });
    expect(prisma.relatorioAtualizacaoDiario.upsert).toHaveBeenCalledWith({
      where: { dataReferencia: new Date('2026-11-10T00:00:00.000Z') },
      create: {
        dataReferencia: new Date('2026-11-10T00:00:00.000Z'),
        registros: [
          {
            id: 'update-1',
            titulo: 'Novo painel',
            descricao: 'A tela de atualizacoes foi adicionada.',
            autorNome: 'Admin GCONT',
            createdAt: createdAt.toISOString()
          }
        ] as Prisma.InputJsonValue
      },
      update: {}
    });
  });

  it('nao substitui um relatorio ja gerado para a mesma data', async () => {
    const existing = { id: 'report-1', dataReferencia: new Date('2026-11-10T00:00:00.000Z') };
    prisma.relatorioAtualizacaoDiario.findUnique.mockResolvedValue(existing);

    const result = await service.generateDailyReport('2026-11-10');

    expect(result).toEqual(existing);
    expect(prisma.sistemaAtualizacao.findMany).not.toHaveBeenCalled();
    expect(prisma.relatorioAtualizacaoDiario.upsert).not.toHaveBeenCalled();
  });

  it('gera um PDF do retrato diario com nome e tipo de arquivo corretos', async () => {
    prisma.relatorioAtualizacaoDiario.findUnique.mockResolvedValue({
      id: 'report-1',
      dataReferencia: new Date('2026-11-10T00:00:00.000Z'),
      geradoEm: new Date('2026-11-10T20:30:00.000Z'),
      registros: [
        {
          id: 'update-1',
          titulo: 'Nova tela',
          descricao: 'Tela para consultar as atualizacoes do sistema.',
          autorNome: 'Admin GCONT',
          createdAt: '2026-11-10T20:29:00.000Z'
        }
      ]
    });

    const result = await service.getDailyReportPdf('report-1');
    const pdf = Buffer.from(result.contentBase64, 'base64');

    expect(result).toMatchObject({
      id: 'report-1',
      fileName: 'relatorio-atualizacoes-2026-11-10.pdf',
      contentType: 'application/pdf'
    });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('registra o nome do administrador no historico', async () => {
    await service.createSystemUpdate(
      { titulo: 'Atualização', descricao: 'Incluída uma nova tela.' },
      {
        userId: 'user-1',
        username: 'admin.gcont',
        nome: 'Admin GCONT',
        role: 'admin',
        sessionId: 'session-1',
        sessionExpiresAt: '2026-11-11T00:00:00.000Z'
      }
    );

    expect(prisma.sistemaAtualizacao.create).toHaveBeenCalledWith({
      data: {
        titulo: 'Atualização',
        descricao: 'Incluída uma nova tela.',
        autorId: 'user-1',
        autorNome: 'Admin GCONT'
      }
    });
  });
});
