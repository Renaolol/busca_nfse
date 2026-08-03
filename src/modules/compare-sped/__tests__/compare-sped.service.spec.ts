import { CompareSpedService } from '../compare-sped.service';

describe('CompareSpedService', () => {
  let service: CompareSpedService;
  const prisma: {
    $transaction: jest.Mock;
    compareSpedHistorico: {
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  } = {
    $transaction: jest.fn(),
    compareSpedHistorico: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn()
    }
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    service = new CompareSpedService(prisma as any);
  });

  it('lista historico ordenado por data mais recente', async () => {
    prisma.compareSpedHistorico.findMany.mockResolvedValue([
      {
        id: 'hist-1',
        clienteId: 'cliente-1',
        clientName: 'POLLY TRANSPORTES LTDA',
        clientCnpj: '12345678000199',
        competence: '2026-06',
        sourceFileName: 'sped_fiscal.txt',
        outputFormat: 'Excel',
        generatedAt: new Date('2026-08-03T16:31:00.000Z'),
        report: { summary: { matchedDocs: 10 } },
        createdAt: new Date('2026-08-03T16:31:00.000Z'),
        updatedAt: new Date('2026-08-03T16:31:00.000Z')
      }
    ]);

    const result = await service.listHistory({ limit: 10 });

    expect(prisma.compareSpedHistorico.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        orderBy: [{ generatedAt: 'desc' }, { createdAt: 'desc' }]
      })
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'hist-1',
        clientId: 'cliente-1',
        clientName: 'POLLY TRANSPORTES LTDA',
        generatedAt: '2026-08-03T16:31:00.000Z'
      })
    );
  });

  it('salva comparacao e remove excedentes antigos', async () => {
    prisma.compareSpedHistorico.create.mockResolvedValue({
      id: 'hist-1',
      clienteId: 'cliente-1',
      clientName: 'POLLY TRANSPORTES LTDA',
      clientCnpj: '12345678000199',
      competence: '2026-06',
      sourceFileName: 'sped_fiscal.txt',
      outputFormat: 'Excel',
      generatedAt: new Date('2026-08-03T16:31:00.000Z'),
      report: { generatedAt: '2026-08-03T16:31:00.000Z' },
      createdAt: new Date('2026-08-03T16:31:00.000Z'),
      updatedAt: new Date('2026-08-03T16:31:00.000Z')
    });
    prisma.compareSpedHistorico.findMany.mockResolvedValue([
      { id: 'old-1' },
      { id: 'old-2' }
    ]);

    const result = await service.saveHistory({
      clienteId: 'cliente-1',
      clientName: 'POLLY TRANSPORTES LTDA',
      clientCnpj: '12.345.678/0001-99',
      competence: '2026-06',
      sourceFileName: 'sped_fiscal.txt',
      outputFormat: 'Excel',
      generatedAt: '2026-08-03T16:31:00.000Z',
      report: { generatedAt: '2026-08-03T16:31:00.000Z', rows: [] }
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.compareSpedHistorico.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clienteId: 'cliente-1',
          clientName: 'POLLY TRANSPORTES LTDA',
          clientCnpj: '12345678000199',
          competence: '2026-06',
          sourceFileName: 'sped_fiscal.txt',
          outputFormat: 'Excel'
        })
      })
    );
    expect(prisma.compareSpedHistorico.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['old-1', 'old-2']
        }
      }
    });
    expect(result.id).toBe('hist-1');
  });
});
