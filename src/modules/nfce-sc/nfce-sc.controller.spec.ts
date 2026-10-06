import { NfceScService } from './nfce-sc.service';
import { NfceScController } from './nfce-sc.controller';

describe('NfceScController', () => {
  const clienteId = '11111111-1111-4111-8111-111111111111';
  const controlId = '22222222-2222-4222-8222-222222222222';

  it('encaminha o download do diagnostico com o escopo do cliente', async () => {
    const payload = {
      fileName: 'nfce-sc-diagnostico.zip',
      contentType: 'application/zip',
      contentBase64: 'c2FtcGxl'
    };
    const service = {
      downloadErrorDiagnostic: jest.fn().mockResolvedValue(payload)
    } as unknown as NfceScService;
    const controller = new NfceScController(service);

    await expect(controller.downloadErrorDiagnostic(controlId, { clienteId })).resolves.toBe(payload);
    expect(service.downloadErrorDiagnostic).toHaveBeenCalledWith(clienteId, controlId);
  });

  it('encaminha a listagem de NFC-e armazenadas com os filtros informados', async () => {
    const query = { clienteId, tipoRelacao: 'emitidas' as const, dataInicio: '2026-09-01', all: true };
    const payload = { items: [], total: 0, page: 1, pageSize: 0, totalPages: 1, truncated: false };
    const service = { listStoredDocuments: jest.fn().mockResolvedValue(payload) } as unknown as NfceScService;
    const controller = new NfceScController(service);

    await expect(controller.listStoredDocuments(query)).resolves.toBe(payload);
    expect(service.listStoredDocuments).toHaveBeenCalledWith(query);
  });

  it('encaminha download em lote sob escopo do cliente', async () => {
    const ids = ['55555555-5555-4555-8555-555555555555'];
    const payload = { fileName: 'nfce-sc-lote.zip', contentType: 'application/zip', contentBase64: 'c2FtcGxl' };
    const service = { downloadStoredDocumentsBatch: jest.fn().mockResolvedValue(payload) } as unknown as NfceScService;
    const controller = new NfceScController(service);

    await expect(controller.downloadStoredDocumentsBatch({ clienteId, ids })).resolves.toBe(payload);
    expect(service.downloadStoredDocumentsBatch).toHaveBeenCalledWith(clienteId, ids);
  });
});
