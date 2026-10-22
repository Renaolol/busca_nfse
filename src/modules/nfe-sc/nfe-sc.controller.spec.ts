import { NfeScController } from './nfe-sc.controller';

describe('NfeScController', () => {
  it('encaminha controles, documentos, configuracao, execucao e pausa ao service', async () => {
    const service = {
      getClientMode: jest.fn().mockReturnValue('mock'),
      listControls: jest.fn().mockResolvedValue([]),
      listDocuments: jest.fn().mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 20, totalPages: 1 }),
      configure: jest.fn().mockResolvedValue({ id: 'control-1' }),
      run: jest.fn().mockResolvedValue({ accepted: true }),
      pause: jest.fn().mockResolvedValue({ paused: true })
    };
    const controller = new NfeScController(service as any);
    const query = { clienteId: 'cliente-1' };
    const documentsQuery = { clienteId: 'cliente-1', page: 2, pageSize: 20 };
    const dto = {
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', certificadoId: 'cert-1',
      ambiente: 'producao', indAtor: 3, autorizacaoContabilistaConfirmada: true
    } as any;

    expect(controller.getStatus()).toEqual({ clientMode: 'mock' });
    expect(service.getClientMode).toHaveBeenCalledTimes(1);
    await expect(controller.listControls(query)).resolves.toEqual([]);
    await expect(controller.listDocuments(documentsQuery)).resolves.toEqual({ items: [], total: 0, page: 2, pageSize: 20, totalPages: 1 });
    await expect(controller.configure(dto, { authUser: { userId: 'admin-1' } } as any)).resolves.toEqual({ id: 'control-1' });
    await expect(controller.run('control-1', query)).resolves.toEqual({ accepted: true });
    await expect(controller.pause('control-1', query)).resolves.toEqual({ paused: true });
    expect(service.configure).toHaveBeenCalledWith(dto, 'admin-1');
    expect(service.run).toHaveBeenCalledWith('cliente-1', 'control-1');
    expect(service.listDocuments).toHaveBeenCalledWith('cliente-1', 2, 20);
  });
});
