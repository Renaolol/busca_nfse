import { NfeAmbiente, NfeSyncStatus, NfceScRecoveryStatus } from '@prisma/client';
import JSZip from 'jszip';
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
      totalDocumentosBaixados: 0,
      diagnosticoXmlRequisicao: null,
      diagnosticoXmlResposta: null,
      diagnosticoXmlCriadoEm: null,
      reprocessamentoNsuInicial: null,
      reprocessamentoNsuFinal: null,
      reprocessamentoNsuAtual: null,
      reprocessamentoStatus: null,
      reprocessamentoTotalDocumentos: 0,
      reprocessamentoMensagem: null,
      reprocessamentoLease: null
    };
  }

  it('inicia um reprocessamento sem alterar o cursor principal', async () => {
    const control = {
      ...createControl(new Date(0)),
      status: NfeSyncStatus.ativo,
      ultimoNsuConsultado: 500n,
      proximaExecucao: null
    };
    const updateMany = jest.fn(async ({ data }: { data: Record<string, any> }) => {
      Object.assign(control, data);
      return { count: 1 };
    });
    const prismaStub = {
      nfceScSyncControle: {
        findFirst: jest.fn().mockResolvedValue(control),
        findUnique: jest.fn().mockImplementation(async () => control),
        updateMany
      }
    } as unknown as PrismaService;
    const service = new NfceScService(prismaStub, {} as NfeService, { download: jest.fn() } as NfceScClient);
    jest.spyOn(service as any, 'startBackgroundRecovery').mockImplementation(() => undefined);

    const result = await service.reprocessNsus(clienteId, controlId, {
      clienteId,
      nsuInicial: '100',
      nsuFinal: '150'
    });

    expect(result).toMatchObject({
      accepted: true,
      started: true,
      status: NfceScRecoveryStatus.processando,
      nsuInicial: '100',
      nsuFinal: '150',
      nsuAtual: '99',
      totalDocumentos: 0
    });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      reprocessamentoNsuInicial: 100n,
      reprocessamentoNsuFinal: 150n,
      reprocessamentoNsuAtual: 99n,
      reprocessamentoStatus: NfceScRecoveryStatus.processando
    });
    expect(control.ultimoNsuConsultado).toBe(500n);
  });

  it('persiste NSUs encontrados no intervalo sem avancar o cursor normal', async () => {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
    const control = {
      ...createControl(leaseUntil),
      status: NfeSyncStatus.ativo,
      ultimoNsuConsultado: 100n,
      reprocessamentoNsuInicial: 10n,
      reprocessamentoNsuFinal: 11n,
      reprocessamentoNsuAtual: 9n,
      reprocessamentoStatus: NfceScRecoveryStatus.processando,
      reprocessamentoTotalDocumentos: 0,
      reprocessamentoLease: leaseUntil
    };
    const updateMany = jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const { reprocessamentoTotalDocumentos, ...updates } = data;
      Object.assign(control, updates);
      if (reprocessamentoTotalDocumentos?.increment) {
        control.reprocessamentoTotalDocumentos += reprocessamentoTotalDocumentos.increment;
      }
      return { count: 1 };
    });
    const prismaStub = {
      nfceScSyncControle: {
        findUnique: jest.fn().mockImplementation(async () => control),
        updateMany
      }
    } as unknown as PrismaService;
    const download: NfceScClient['download'] = jest.fn().mockResolvedValue({
      cStat: '118',
      xMotivo: 'Lote localizado',
      ultimoNsu: 11n,
      documentos: createDocuments(10, 2),
      httpStatus: 200
    });
    const persistNfceScDocument = jest.fn().mockResolvedValue(undefined);
    const service = new NfceScService(
      prismaStub,
      { persistNfceScDocument } as unknown as NfeService,
      { download } as NfceScClient
    );
    const processRecovery = (service as unknown as {
      processNsuRecovery: (id: string, lease: Date) => Promise<void>;
    }).processNsuRecovery.bind(service);

    await processRecovery(controlId, leaseUntil);

    expect(download).toHaveBeenCalledWith(expect.objectContaining({ ultimoNsu: 9n }));
    expect(persistNfceScDocument).toHaveBeenCalledTimes(2);
    expect(control.reprocessamentoStatus).toBe(NfceScRecoveryStatus.concluido);
    expect(control.reprocessamentoNsuAtual).toBe(11n);
    expect(control.reprocessamentoTotalDocumentos).toBe(2);
    expect(control.ultimoNsuConsultado).toBe(100n);
  });

  it('lista NFC-e armazenadas no escopo do cliente e aplica filtros de pesquisa', async () => {
    const storedDocument = { id: '55555555-5555-4555-8555-555555555555', modelo: '65', origem: 'sef_sc_nfce' };
    const findMany = jest.fn().mockResolvedValue([storedDocument]);
    const count = jest.fn().mockResolvedValue(1);
    const prismaStub = {
      cliente: { findUnique: jest.fn().mockResolvedValue({ id: clienteId }) },
      nfeDocumento: { findMany, count }
    } as unknown as PrismaService;
    const service = new NfceScService(prismaStub, {} as NfeService, { download: jest.fn() } as NfceScClient);

    const result = await service.listStoredDocuments({
      clienteId,
      all: true,
      tipoRelacao: 'emitidas',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      cnpj: '12.345.678/0001-90',
      numeroNfce: '123',
      chaveAcesso: '4126'
    });

    expect(result).toMatchObject({ items: [storedDocument], total: 1, page: 1, truncated: false });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clienteId, modelo: '65', origem: 'sef_sc_nfce' }),
      take: 10000
    }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      { tipoRelacao: 'emitida' },
      { numeroNfe: { contains: '123' } },
      { chaveAcesso: { contains: '4126' } }
    ]));
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('xmlCompletoPath');
  });

  it('baixa em ZIP somente NFC-e armazenadas no cliente informado', async () => {
    const nfceId = '55555555-5555-4555-8555-555555555555';
    const findMany = jest.fn().mockResolvedValue([{ id: nfceId }]);
    const downloadLote = jest.fn().mockResolvedValue({
      fileName: 'nfe-lote.zip',
      contentType: 'application/zip',
      contentBase64: 'c2FtcGxl',
      totalSolicitados: 1,
      totalDocumentosEncontrados: 1,
      totalArquivosIncluidos: 1,
      idsNaoEncontrados: [],
      erros: []
    });
    const prismaStub = { nfeDocumento: { findMany } } as unknown as PrismaService;
    const service = new NfceScService(prismaStub, { downloadLote } as unknown as NfeService, { download: jest.fn() } as NfceScClient);

    const result = await service.downloadStoredDocumentsBatch(clienteId, [nfceId, nfceId]);

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [nfceId] }, clienteId, modelo: '65', origem: 'sef_sc_nfce' },
      select: { id: true }
    });
    expect(downloadLote).toHaveBeenCalledWith({ ids: [nfceId], clienteId, tipoArquivo: 'xml' });
    expect(result).toMatchObject({ contentType: 'application/zip', contentBase64: 'c2FtcGxl' });
    expect(result.fileName).toMatch(/^nfce-sc-lote-.*\.zip$/);
  });

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
      httpStatus: 200,
      errorDiagnostic: {
        requestXml: '<soap:Envelope><request/></soap:Envelope>',
        responseXml: '<soap:Envelope><response/></soap:Envelope>'
      }
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
    expect(control.diagnosticoXmlRequisicao).toBe('<soap:Envelope><request/></soap:Envelope>');
    expect(control.diagnosticoXmlResposta).toBe('<soap:Envelope><response/></soap:Envelope>');
    expect(control.diagnosticoXmlCriadoEm).toBeInstanceOf(Date);
    expect(control.proximaExecucao?.getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
  });

  it('empacota os XMLs de erro para suporte sem incluí-los na listagem normal', async () => {
    const requestXml = '<soap:Envelope><request/></soap:Envelope>';
    const responseXml = '<soap:Envelope><response/></soap:Envelope>';
    const createdAt = new Date('2026-10-05T15:30:00.000Z');
    const findMany = jest.fn().mockResolvedValue([]);
    const prismaStub = {
      cliente: { findUnique: jest.fn().mockResolvedValue({ id: clienteId }) },
      nfceScSyncControle: {
        findFirst: jest.fn().mockResolvedValue({
          cnpjConsulta: '12345678000190',
          diagnosticoXmlRequisicao: requestXml,
          diagnosticoXmlResposta: responseXml,
          diagnosticoXmlCriadoEm: createdAt
        }),
        findMany
      }
    } as unknown as PrismaService;
    const service = new NfceScService(prismaStub, {} as NfeService, { download: jest.fn() } as NfceScClient);

    const payload = await service.downloadErrorDiagnostic(clienteId, controlId);
    const zip = await JSZip.loadAsync(Buffer.from(payload.contentBase64, 'base64'));

    expect(payload).toMatchObject({ contentType: 'application/zip' });
    expect(await zip.file('requisicao.xml')?.async('string')).toBe(requestXml);
    expect(await zip.file('resposta.xml')?.async('string')).toBe(responseXml);
    expect(await zip.file('capturado-em.txt')?.async('string')).toBe(createdAt.toISOString());

    await service.listControls(clienteId);
    const selectedFields = findMany.mock.calls[0][0].select;
    expect(selectedFields.diagnosticoXmlCriadoEm).toBe(true);
    expect(selectedFields).not.toHaveProperty('diagnosticoXmlRequisicao');
    expect(selectedFields).not.toHaveProperty('diagnosticoXmlResposta');
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
