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
});
