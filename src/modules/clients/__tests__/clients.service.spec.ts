import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: {
    $transaction: jest.Mock;
    cliente: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    clienteEstabelecimento: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    nfeSyncControle: {
      updateMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      cliente: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      clienteEstabelecimento: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn()
      },
      nfeSyncControle: {
        updateMany: jest.fn()
      }
    };

    service = new ClientsService(prisma as unknown as PrismaService);
  });

  it('cria cliente e estabelecimento principal com dados fiscais e responsavel interno', async () => {
    const createdClient = {
      id: 'cliente-1',
      razaoSocial: 'Cliente Teste Ltda',
      cnpj: '12345678000190',
      responsavelInterno: 'Equipe Fiscal'
    };
    const createdEstablishment = {
      id: 'estabelecimento-1',
      clienteId: 'cliente-1',
      inscricaoMunicipal: '12345',
      municipioNome: 'Sao Paulo'
    };

    prisma.cliente.create.mockResolvedValue(createdClient);
    prisma.clienteEstabelecimento.create.mockResolvedValue(createdEstablishment);

    const result = await service.create({
      razaoSocial: 'Cliente Teste Ltda',
      nomeFantasia: 'Cliente Teste',
      cnpj: '12.345.678/0001-90',
      inscricaoMunicipal: '12345',
      municipioCodigoIbge: '3550308',
      municipioNome: 'Sao Paulo',
      responsavelInterno: 'Equipe Fiscal',
      ativo: true
    });

    expect(prisma.cliente.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cnpj: '12345678000190',
        responsavelInterno: 'Equipe Fiscal',
        nfeHabilitado: true
      })
    });
    expect(prisma.clienteEstabelecimento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clienteId: 'cliente-1',
        cnpj: '12345678000190',
        inscricaoMunicipal: '12345',
        municipioCodigoIbge: '3550308',
        municipioNome: 'Sao Paulo'
      })
    });
    expect(result.estabelecimentoPrincipal).toEqual(createdEstablishment);
  });

  it('atualiza cliente e estabelecimento principal com dados fiscais e responsavel interno', async () => {
    prisma.cliente.findUnique.mockResolvedValue({
      id: 'cliente-1',
      razaoSocial: 'Cliente Antigo',
      cnpj: '12345678000190'
    });
    prisma.cliente.update.mockResolvedValue({
      id: 'cliente-1',
      razaoSocial: 'Cliente Atualizado',
      cnpj: '12345678000190',
      responsavelInterno: 'Joao Fiscal'
    });
    prisma.clienteEstabelecimento.findFirst.mockResolvedValue({
      id: 'estabelecimento-1',
      clienteId: 'cliente-1'
    });
    prisma.clienteEstabelecimento.update.mockResolvedValue({
      id: 'estabelecimento-1',
      inscricaoMunicipal: '67890',
      municipioNome: 'Campinas'
    });

    await service.update('cliente-1', {
      razaoSocial: 'Cliente Atualizado',
      cnpj: '12.345.678/0001-90',
      inscricaoMunicipal: '67890',
      municipioCodigoIbge: '3509502',
      municipioNome: 'Campinas',
      responsavelInterno: 'Joao Fiscal'
    });

    expect(prisma.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cliente-1' },
      data: expect.objectContaining({
        cnpj: '12345678000190',
        responsavelInterno: 'Joao Fiscal'
      })
    });
    expect(prisma.clienteEstabelecimento.update).toHaveBeenCalledWith({
      where: { id: 'estabelecimento-1' },
      data: expect.objectContaining({
        cnpj: '12345678000190',
        inscricaoMunicipal: '67890',
        municipioCodigoIbge: '3509502',
        municipioNome: 'Campinas'
      })
    });
  });

  it('lanca erro ao atualizar cliente inexistente', async () => {
    prisma.cliente.findUnique.mockResolvedValue(null);

    await expect(service.update('cliente-inexistente', {})).rejects.toThrow(NotFoundException);
  });

  it('pausa controles de NF-e ao desabilitar o cliente para rotinas de NF-e', async () => {
    prisma.cliente.findUnique.mockResolvedValue({
      id: 'cliente-1',
      razaoSocial: 'Cliente Teste',
      cnpj: '12345678000190'
    });
    prisma.cliente.update.mockResolvedValue({
      id: 'cliente-1',
      nfeHabilitado: false
    });

    await service.setNfeEnabled('cliente-1', false);

    expect(prisma.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cliente-1' },
      data: { nfeHabilitado: false }
    });
    expect(prisma.nfeSyncControle.updateMany).toHaveBeenCalledWith({
      where: {
        clienteId: 'cliente-1',
        status: {
          in: ['ativo', 'erro_api']
        }
      },
      data: {
        status: 'pausado',
        ultimaMensagem: 'Busca de NF-e pausada no cadastro do cliente'
      }
    });
  });
});
