import { BadRequestException } from '@nestjs/common';
import { NfeAmbiente, NfeSyncStatus } from '@prisma/client';
import { NfeScService } from './nfe-sc.service';

const validCpf = '52998224725';

describe('NfeScService', () => {
  afterEach(() => jest.clearAllMocks());

  it('exige confirmacao administrativa do vinculo contabilista antes de configurar', async () => {
    const prisma = {} as any;
    const service = new NfeScService(prisma, {} as any, {} as any);

    await expect(service.configure({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', certificadoId: 'cert-1',
      ambiente: NfeAmbiente.producao, indAtor: 3, autorizacaoContabilistaConfirmada: false
    }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pagina todo o historico de NSUs e retorna metadados da pagina', async () => {
    const row = { id: 'trace-1', nsu: 27n, schemaDoc: 'nfeProc_v4.00', documento: { id: 'doc-1' } };
    const prisma = {
      cliente: { findUnique: jest.fn().mockResolvedValue({ id: 'cliente-1' }) },
      nfeScDocumentoDistribuido: {
        count: jest.fn().mockResolvedValue(120),
        findMany: jest.fn().mockResolvedValue([row])
      }
    } as any;
    const service = new NfeScService(prisma, {} as any, {} as any);

    const result = await service.listDocuments('cliente-1', 2, 20);

    expect(prisma.nfeScDocumentoDistribuido.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      orderBy: [{ nsu: 'desc' }]
    }));
    expect(result).toMatchObject({
      items: [{ id: 'trace-1', nsu: '27', origem: 'sef_sc_nfe' }],
      total: 120,
      page: 2,
      pageSize: 20,
      totalPages: 6
    });
  });

  it('preserva cursor ao trocar certificado e nao permite trocar o filtro apos iniciar a coleta', async () => {
    const current = { id: 'control-1', ultimoNsuConsultado: 81n, indAtor: 3, status: NfeSyncStatus.ativo };
    const prisma = {
      clienteEstabelecimento: { findFirst: jest.fn().mockResolvedValue({ id: 'estab-1', cnpj: validCpf }) },
      certificado: { findFirst: jest.fn().mockResolvedValue({ id: 'cert-2' }) },
      nfeScSyncControle: {
        findUnique: jest.fn().mockResolvedValue(current),
        upsert: jest.fn().mockResolvedValue({ id: 'control-1', ultimoNsuConsultado: 81n })
      }
    } as any;
    const service = new NfeScService(prisma, {} as any, {} as any);

    await service.configure({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', certificadoId: 'cert-2',
      ambiente: NfeAmbiente.producao, indAtor: 3, autorizacaoContabilistaConfirmada: true
    }, 'admin-1');
    const upsertArgs = prisma.nfeScSyncControle.upsert.mock.calls[0][0];
    expect(upsertArgs.update.certificadoId).toBe('cert-2');
    expect(upsertArgs.update.ultimoNsuConsultado).toBeUndefined();
    expect(upsertArgs.update.autorizacaoConfirmadaPorId).toBe('admin-1');

    await expect(service.configure({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', certificadoId: 'cert-2',
      ambiente: NfeAmbiente.producao, indAtor: 1, autorizacaoContabilistaConfirmada: true
    }, 'admin-1')).rejects.toThrow('nao pode mudar depois do primeiro NSU');
  });

  it('grava a relacao origem/NSU antes de avancar o cursor e so usa cliente mockado', async () => {
    const lease = new Date(Date.now() + 60_000);
    const control = {
      id: 'control-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cnpjConsulta: validCpf,
      certificadoId: 'cert-1', ambiente: NfeAmbiente.producao, indAtor: 3,
      ultimoNsuConsultado: 7n, totalDocumentosBaixados: 0, status: NfeSyncStatus.processando,
      proximaExecucao: lease
    };
    const order: string[] = [];
    const sourceNsuUpsert = jest.fn().mockImplementation(async () => { order.push('trace'); });
    const transactionalCursorUpdate = jest.fn().mockImplementation(async () => { order.push('cursor'); return { count: 1 }; });
    const prisma = {
      nfeScSyncControle: {
        findUnique: jest.fn().mockResolvedValue(control),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback({
        nfeScDocumentoDistribuido: { upsert: sourceNsuUpsert },
        nfeScSyncControle: { updateMany: transactionalCursorUpdate }
      }))
    } as any;
    const nfeService = { persistSefScNfeDocument: jest.fn().mockResolvedValue({ id: 'nfe-doc-1' }) };
    const client = { download: jest.fn().mockResolvedValue({
      cStat: '118', xMotivo: 'DF-e localizados', httpStatus: 200, ultimoNsu: 8n,
      documentos: [{ nsu: 8n, chaveAcesso: '41261012345678000199550010000001231000001231', schema: 'nfeProc_v4.00', xml: '<nfeProc />' }]
    }) };
    const service = new NfeScService(prisma, nfeService as any, client as any);

    await (service as any).processAllAvailableBatches('control-1', lease);

    expect(client.download).toHaveBeenCalledWith(expect.objectContaining({ cpfConsulta: validCpf, ultimoNsu: 7n }));
    expect(nfeService.persistSefScNfeDocument).toHaveBeenCalledTimes(1);
    expect(sourceNsuUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { controleId_nsu: { controleId: 'control-1', nsu: 8n } },
      create: expect.objectContaining({ nfeDocumentoId: 'nfe-doc-1', schemaDoc: 'nfeProc_v4.00' })
    }));
    expect(order).toEqual(['trace', 'cursor']);
    expect(transactionalCursorUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ultimoNsuConsultado: 8n, totalDocumentosBaixados: { increment: 1 } })
    }));
  });
});
