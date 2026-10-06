import { EstablishmentsController } from '../establishments.controller';
import { EstablishmentsService } from '../establishments.service';

describe('EstablishmentsController', () => {
  const service = {
    create: jest.fn(),
    listByClient: jest.fn(),
    lookupCep: jest.fn(),
    update: jest.fn()
  };
  const controller = new EstablishmentsController(service as unknown as EstablishmentsService);

  beforeEach(() => jest.clearAllMocks());

  it('encaminha a consulta de CEP ao service', async () => {
    service.lookupCep.mockResolvedValue({ municipioCodigoIbge: '4205407' });

    await expect(controller.lookupCep('88010000')).resolves.toEqual({ municipioCodigoIbge: '4205407' });
    expect(service.lookupCep).toHaveBeenCalledWith('88010000');
  });

  it('cria o estabelecimento no escopo do cliente informado', async () => {
    const dto = { cnpj: '12345678000199' };
    service.create.mockResolvedValue({ id: 'est-1' });

    await expect(controller.create('cliente-1', dto)).resolves.toEqual({ id: 'est-1' });
    expect(service.create).toHaveBeenCalledWith('cliente-1', dto);
  });
});
