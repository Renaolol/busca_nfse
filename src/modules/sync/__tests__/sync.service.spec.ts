import { BadRequestException } from '@nestjs/common';
import { Ambiente } from '@prisma/client';
import { NfseAmbiente } from '../../../common/enums/nfse-ambiente.enum';
import { NfseAdnClient } from '../../../integrations/nfse-adn/nfse-adn.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { NfseDanfseService } from '../../nfse/nfse-danfse.service';
import { NfseXmlParserService } from '../../nfse/nfse-xml-parser.service';
import { LocalStorageService } from '../../storage/storage.service';
import { SyncService } from '../sync.service';

describe('SyncService', () => {
  const prisma = {
    cliente: {
      findUnique: jest.fn()
    },
    clienteEstabelecimento: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    certificado: {
      findFirst: jest.fn()
    },
    nfseSyncControle: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn()
    },
    nfseSyncLog: {
      create: jest.fn(),
      findMany: jest.fn()
    },
    nfseDocumento: {
      upsert: jest.fn(),
      findFirst: jest.fn()
    }
  };

  const storage = {
    putObject: jest.fn()
  };

  const adnClient: Pick<NfseAdnClient, 'getDFeByNsu'> = {
    getDFeByNsu: jest.fn()
  };
  const danfse = {
    generateFromXml: jest.fn().mockReturnValue(Buffer.from('pdf'))
  };
  const parser = {
    parse: jest.fn(),
    getHash: jest.fn().mockReturnValue('hash')
  };

  let service: SyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    parser.parse.mockReset();
    parser.getHash.mockReturnValue('hash');
    prisma.cliente.findUnique.mockResolvedValue({ id: 'cliente-1' });
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-1',
      clienteId: 'cliente-1',
      cnpj: '12345678000199',
      ativo: true
    });
    prisma.clienteEstabelecimento.findMany.mockResolvedValue([
      {
        id: 'estab-1',
        clienteId: 'cliente-1',
        cnpj: '12345678000199',
        ativo: true
      }
    ]);
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    prisma.nfseSyncControle.findMany.mockResolvedValue([]);
    prisma.nfseSyncControle.findUnique.mockResolvedValue(null);
    prisma.nfseSyncControle.update.mockResolvedValue({});
    prisma.nfseSyncControle.create.mockResolvedValue({});
    prisma.nfseSyncControle.upsert.mockResolvedValue({});
    prisma.nfseSyncControle.updateMany.mockResolvedValue({ count: 1 });
    prisma.nfseSyncLog.create.mockResolvedValue({});
    prisma.nfseDocumento.upsert.mockResolvedValue({});
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    storage.putObject.mockResolvedValue(undefined);

    service = new SyncService(
      prisma as unknown as PrismaService,
      storage as unknown as LocalStorageService,
      danfse as unknown as NfseDanfseService,
      parser as unknown as NfseXmlParserService,
      adnClient as NfseAdnClient
    );
  });

  it('consulta um NSU especifico sem persistir nota', async () => {
    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 10n,
      hasDocument: false,
      rawResponse: { ok: true },
      statusCode: 404,
      message: 'Sem documento para o NSU informado'
    });

    const result = await service.testSingleNsu({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nsu: '10'
    });

    expect(adnClient.getDFeByNsu).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      nsu: 10n,
      ambiente: NfseAmbiente.PRODUCAO,
      certificateId: 'cert-1'
    });

    expect(result).toMatchObject({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao,
      cnpjConsulta: '12345678000199',
      nsu: '10',
      hasDocument: false,
      statusCode: 404
    });
  });

  it('retorna erro quando nao existe certificado ativo valido', async () => {
    prisma.certificado.findFirst.mockResolvedValue(null);

    await expect(
      service.testSingleNsu({
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        nsu: '15',
        ambiente: 'producao_restrita'
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('nao avanca NSU quando ADN retorna erro temporario (429)', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        ultimoNsuConsultado: 8n
      }
    ]);

    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 9n,
      hasDocument: false,
      statusCode: 429,
      message: 'Falha na consulta ADN. HTTP 429.',
      rawResponse: {}
    });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 0
    });

    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimaMensagem: 'Falha na consulta ADN. HTTP 429.'
        })
      })
    );
    expect(prisma.nfseSyncControle.update.mock.calls[0][0].data.ultimoNsuConsultado).toBeUndefined();
    expect(prisma.nfseSyncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'erro_api',
          nsuConsultado: 9n
        })
      })
    );
    expect(prisma.nfseDocumento.upsert).not.toHaveBeenCalled();
  });

  it('avanca NSU quando retorno for sem documento definitivo', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        ultimoNsuConsultado: 8n
      }
    ]);

    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 9n,
      hasDocument: false,
      statusCode: 404,
      message: 'Sem documento para o NSU informado',
      rawResponse: {}
    });

    await service.runNow();

    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 9n
        })
      })
    );
    expect(prisma.nfseSyncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'sem_documento',
          nsuConsultado: 9n
        })
      })
    );
  });

  it('salva campos completos quando ADN retorna documento com XML', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        ultimoNsuConsultado: 8n
      }
    ]);

    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 9n,
      hasDocument: true,
      chaveAcesso: '42110092206960810000176000000000000226015757529368',
      xml: '<NFSe>ok</NFSe>',
      statusCode: 200,
      message: null,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000226015757529368',
      numeroNfse: '2',
      serie: '900',
      dataEmissao: new Date('2024-08-01T14:08:50.000Z'),
      competencia: new Date('2024-08-01T00:00:00.000Z'),
      status: '100',
      cnpjPrestador: '44454248000106',
      razaoSocialPrestador: 'Prestador',
      cnpjTomador: '06960810000176',
      razaoSocialTomador: 'Tomador',
      municipioPrestacaoCodigo: '4211009',
      municipioPrestacaoNome: 'Mondai',
      valorServico: '1720.00',
      codigoServicoNacional: '170101',
      descricaoServico: 'consultoria'
    });

    await service.runNow();

    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          numeroNfse: '2',
          serie: '900',
          status: 'autorizada',
          cnpjPrestador: '44454248000106',
          cnpjTomador: '06960810000176',
          codigoServicoNacional: '170101',
          descricaoServico: 'consultoria'
        })
      })
    );
  });

  it('em modo diario interrompe o ciclo apos primeiro documento e agenda cooldown de sucesso', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        modoSync: 'somente_novas',
        ultimoNsuConsultado: 8n
      }
    ]);

    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 9n,
      hasDocument: true,
      chaveAcesso: '42110092206960810000176000000000000226015757529368',
      xml: '<NFSe>ok</NFSe>',
      statusCode: 200,
      message: null,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000226015757529368',
      numeroNfse: '2',
      serie: '900',
      dataEmissao: new Date('2024-08-01T14:08:50.000Z'),
      competencia: new Date('2024-08-01T00:00:00.000Z'),
      status: '100',
      cnpjPrestador: '44454248000106',
      razaoSocialPrestador: 'Prestador',
      cnpjTomador: '06960810000176',
      razaoSocialTomador: 'Tomador',
      municipioPrestacaoCodigo: '4211009',
      municipioPrestacaoNome: 'Mondai',
      valorServico: '1720.00',
      codigoServicoNacional: '170101',
      descricaoServico: 'consultoria'
    });

    await service.runNow();

    expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(1);
    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          proximaExecucao: expect.any(Date),
          ultimaMensagem: 'Documento sincronizado com sucesso'
        })
      })
    );
  });

  it('iniciarSync dispara execucao imediata do ciclo', async () => {
    const runNowSpy = jest.spyOn(service, 'runNow').mockResolvedValue({
      processed: 1,
      documentsSaved: 0
    });

    const result = await service.iniciarSync('cliente-1');

    expect(result).toEqual({ controlesCriadosOuAtualizados: 1 });
    expect(prisma.nfseSyncControle.create).toHaveBeenCalledTimes(1);
    expect(runNowSpy).toHaveBeenCalledTimes(1);
  });

  it('iniciarSync consulta controle por cliente, cnpj e ambiente', async () => {
    jest.spyOn(service, 'runNow').mockResolvedValue({
      processed: 0,
      documentsSaved: 0
    });

    await service.iniciarSync('cliente-1');

    expect(prisma.nfseSyncControle.findUnique).toHaveBeenCalledWith({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: 'cliente-1',
          cnpjConsulta: '12345678000199',
          ambiente: Ambiente.producao
        }
      }
    });
  });

  it('filtra logs por cliente', async () => {
    prisma.nfseSyncLog.findMany.mockResolvedValue([{ id: 'log-1' }]);

    const result = await service.listLogs('cliente-1');

    expect(prisma.nfseSyncLog.findMany).toHaveBeenCalledWith({
      where: { clienteId: 'cliente-1' },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    expect(result).toEqual([{ id: 'log-1' }]);
  });

  it('exige clienteId para listar logs', async () => {
    await expect(service.listLogs('')).rejects.toThrow(BadRequestException);
  });
});
