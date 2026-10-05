import { NfeAmbiente, NfeSyncStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NfeService } from '../nfe/nfe.service';
import { NfceScClient, NfceScDfe } from '../../integrations/nfce-sc/nfce-sc.types';
import { NfceScService } from './nfce-sc.service';

describe('NfceScService', () => {
  const clienteId = '11111111-1111-4111-8111-111111111111';
  const controlId = '22222222-2222-4222-8222-222222222222';

  function createDocuments(firstNsu: number, count: number): NfceScDfe[] {
    return Array.from({ length: count }, (_, index) => ({
      nsu: BigInt(firstNsu + index),
      chaveAcesso: String(firstNsu + index).padStart(44, '0'),
      xml: `<nfeProc><NSU>${firstNsu + index}</NSU></nfeProc>`
    }));
  }

  function createControl(leaseUntil: Date) {
    return {
      id: controlId,
      clienteId,
      estabelecimentoId: '33333333-3333-4333-8333-333333333333',
      cnpjConsulta: '12345678000190',
      certificadoId: '44444444-4444-4444-8444-444444444444',
      ambiente: NfeAmbiente.producao,
      indAtor: 1,
      ultimoNsuConsultado: 0n,
      status: NfeSyncStatus.processando,
      ultimaExecucao: new Date(),
      proximaExecucao: leaseUntil,
      ultimaMensagem: 'Consulta iniciada',
      totalDocumentosBaixados: 0
    };
  }

  it('continua automaticamente pelos lotes de 50 e encerra ao receber o lote final', async () => {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
    const control = createControl(leaseUntil);
    const prismaStub = {
      nfceScSyncControle: {
        findUnique: jest.fn(async () => ({ ...control })),
        updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, any> }) => {
          const expectedLease = where.proximaExecucao as Date | undefined;
          if (where.status && where.status !== control.status) return { count: 0 };
          if (expectedLease && expectedLease.getTime() !== control.proximaExecucao?.getTime()) return { count: 0 };
          const { totalDocumentosBaixados, ...updates } = data;
          Object.assign(control, updates);
          if (totalDocumentosBaixados?.increment) {
            control.totalDocumentosBaixados += totalDocumentosBaixados.increment;
          }
          return { count: 1 };
        })
      }
    } as unknown as PrismaService;
    const download = jest.fn<
      ReturnType<NfceScClient['download']>,
      Parameters<NfceScClient['download']>
    >()
      .mockResolvedValueOnce({
        cStat: '118',
        xMotivo: 'Lote localizado',
        ultimoNsu: 50n,
        documentos: createDocuments(1, 50),
        httpStatus: 200
      })
      .mockResolvedValueOnce({
        cStat: '118',
        xMotivo: 'Ultimo lote localizado',
        ultimoNsu: 53n,
        documentos: createDocuments(51, 3),
        httpStatus: 200
      });
    const clientStub: NfceScClient = { download };
    const persistNfceScDocument = jest.fn().mockResolvedValue(undefined);
    const service = new NfceScService(prismaStub, { persistNfceScDocument } as unknown as NfeService, clientStub);
    const runBatches = (service as unknown as {
      processAllAvailableBatches: (id: string, lease: Date) => Promise<void>;
    }).processAllAvailableBatches.bind(service);

    await runBatches(controlId, leaseUntil);

    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map(([params]) => params.ultimoNsu)).toEqual([0n, 50n]);
    expect(persistNfceScDocument).toHaveBeenCalledTimes(53);
    expect(control.ultimoNsuConsultado).toBe(53n);
    expect(control.totalDocumentosBaixados).toBe(53);
    expect(control.status).toBe(NfeSyncStatus.ativo);
    expect(control.proximaExecucao?.getTime()).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);
  });

  it('classifica cStat 9999 como erro de API e preserva mensagem e NSU', async () => {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
    const control = createControl(leaseUntil);
    const prismaStub = {
      nfceScSyncControle: {
        findUnique: jest.fn(async () => ({ ...control })),
        updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, any> }) => {
          const expectedLease = where.proximaExecucao as Date | undefined;
          if (where.status && where.status !== control.status) return { count: 0 };
          if (expectedLease && expectedLease.getTime() !== control.proximaExecucao?.getTime()) return { count: 0 };
          Object.assign(control, data);
          return { count: 1 };
        })
      }
    } as unknown as PrismaService;
    const download: NfceScClient['download'] = jest.fn().mockResolvedValue({
      cStat: '9999',
      xMotivo: 'Ocorreu um erro no processamento. Código do erro: exemplo',
      ultimoNsu: 0n,
      documentos: [],
      httpStatus: 200
    });
    const service = new NfceScService(
      prismaStub,
      {} as NfeService,
      { download } as NfceScClient
    );
    const runBatches = (service as unknown as {
      processAllAvailableBatches: (id: string, lease: Date) => Promise<void>;
    }).processAllAvailableBatches.bind(service);

    await runBatches(controlId, leaseUntil);

    expect(control.status).toBe(NfeSyncStatus.erro_api);
    expect(control.ultimoNsuConsultado).toBe(0n);
    expect(control.ultimaMensagem).toContain('Código do erro: exemplo');
    expect(control.proximaExecucao?.getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
  });

  it('permite nova tentativa manual apos cStat 9999 sem esperar o cooldown', async () => {
    const control = {
      ...createControl(new Date(Date.now() + 60 * 60 * 1000)),
      status: NfeSyncStatus.erro_api,
      ultimaMensagem: 'SEF/SC 9999: Erro no processamento. Codigo do erro: exemplo'
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prismaStub = {
      nfceScSyncControle: {
        findFirst: jest.fn().mockResolvedValue(control),
        updateMany
      }
    } as unknown as PrismaService;
    const clientStub: NfceScClient = { download: jest.fn() };
    const service = new NfceScService(prismaStub, {} as NfeService, clientStub);
    const startBackgroundExecution = jest.spyOn(service as any, 'startBackgroundExecution').mockImplementation(() => undefined);

    const result = await service.run(clienteId, controlId);

    expect(result).toMatchObject({
      accepted: true,
      started: true,
      status: NfeSyncStatus.processando,
      ultimoNsu: '0'
    });
    expect(updateMany.mock.calls[0][0].where).not.toHaveProperty('OR');
    expect(startBackgroundExecution).toHaveBeenCalledWith(controlId, expect.any(Date));
  });

  it('responde com consulta em andamento sem iniciar uma segunda execucao', async () => {
    const control = {
      ...createControl(new Date(Date.now() + 5 * 60 * 1000)),
      status: NfeSyncStatus.processando,
      ultimoNsuConsultado: 25n,
      totalDocumentosBaixados: 25
    };
    const prismaStub = {
      nfceScSyncControle: {
        findFirst: jest.fn().mockResolvedValue(control)
      }
    } as unknown as PrismaService;
    const clientStub: NfceScClient = { download: jest.fn() };
    const service = new NfceScService(prismaStub, {} as NfeService, clientStub);

    const result = await service.run(clienteId, controlId);

    expect(result).toMatchObject({
      accepted: true,
      started: false,
      status: NfeSyncStatus.processando,
      ultimoNsu: '25',
      totalDocumentosBaixados: 25
    });
    expect(clientStub.download).not.toHaveBeenCalled();
  });

  it('retoma um controle pausado a partir do NSU salvo', async () => {
    const control = {
      ...createControl(new Date()),
      status: NfeSyncStatus.pausado,
      ultimoNsuConsultado: 230n,
      totalDocumentosBaixados: 230,
      proximaExecucao: null,
      ultimaMensagem: 'Controle pausado manualmente.'
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prismaStub = {
      nfceScSyncControle: {
        findFirst: jest.fn().mockResolvedValue(control),
        updateMany
      }
    } as unknown as PrismaService;
    const clientStub: NfceScClient = { download: jest.fn() };
    const service = new NfceScService(prismaStub, {} as NfeService, clientStub);
    const startBackgroundExecution = jest.spyOn(service as any, 'startBackgroundExecution').mockImplementation(() => undefined);

    const result = await service.run(clienteId, controlId);

    expect(result).toMatchObject({
      accepted: true,
      started: true,
      status: NfeSyncStatus.processando,
      ultimoNsu: '230',
      totalDocumentosBaixados: 230
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { notIn: [NfeSyncStatus.processando] },
        OR: expect.arrayContaining([{ proximaExecucao: null }])
      }),
      data: expect.objectContaining({ status: NfeSyncStatus.processando })
    }));
    expect(startBackgroundExecution).toHaveBeenCalledWith(controlId, expect.any(Date));
    expect(clientStub.download).not.toHaveBeenCalled();
  });
});
