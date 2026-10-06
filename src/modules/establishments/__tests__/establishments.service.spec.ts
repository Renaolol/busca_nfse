import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CepLookupClient } from '../../../integrations/cep-lookup/cep-lookup.types';
import { EstablishmentsService } from '../establishments.service';

describe('EstablishmentsService', () => {
  const prisma = {
    clienteEstabelecimento: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    }
  };
  const cepLookupClient: CepLookupClient = { lookup: jest.fn() };
  const service = new EstablishmentsService(prisma as unknown as PrismaService, cepLookupClient);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('cria estabelecimento normalizando CEP e UF', async () => {
    prisma.clienteEstabelecimento.create.mockResolvedValue({ id: 'est-1' });

    await service.create('cliente-1', {
      cnpj: '12345678000199',
      cep: '88.010-000',
      uf: 'sc'
    });

    expect(prisma.clienteEstabelecimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clienteId: 'cliente-1', cep: '88010000', uf: 'SC', ativo: true })
    });
  });

  it('retorna conflito legivel para CNPJ repetido no cliente', async () => {
    prisma.clienteEstabelecimento.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create('cliente-1', { cnpj: '12345678000199' })).rejects.toThrow(ConflictException);
  });

  it('busca o endereco e o codigo IBGE por CEP', async () => {
    (cepLookupClient.lookup as jest.Mock).mockResolvedValue({
      cep: '88010000',
      logradouro: 'Rua dos Ilheus',
      bairro: 'Centro',
      municipioNome: 'Florianopolis',
      municipioCodigoIbge: '4205407',
      uf: 'SC'
    });

    const result = await service.lookupCep('88010-000');

    expect(cepLookupClient.lookup).toHaveBeenCalledWith('88010000');
    expect(result.municipioCodigoIbge).toBe('4205407');
  });

  it('rejeita CEP invalido sem consultar o adapter', async () => {
    await expect(service.lookupCep('123')).rejects.toThrow(BadRequestException);
    expect(cepLookupClient.lookup).not.toHaveBeenCalled();
  });

  it('retorna 404 para CEP nao localizado', async () => {
    (cepLookupClient.lookup as jest.Mock).mockResolvedValue(null);

    await expect(service.lookupCep('00000000')).rejects.toThrow(NotFoundException);
  });

  it('retorna erro de servico indisponivel quando ViaCEP falha', async () => {
    (cepLookupClient.lookup as jest.Mock).mockRejectedValue(new Error('timeout'));

    await expect(service.lookupCep('88010000')).rejects.toThrow(ServiceUnavailableException);
  });
});
