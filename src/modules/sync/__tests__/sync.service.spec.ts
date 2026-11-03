import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Ambiente } from '@prisma/client';
import { NfseAmbiente } from '../../../common/enums/nfse-ambiente.enum';
import { NfseAdnClient } from '../../../integrations/nfse-adn/nfse-adn.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { NfseDanfseService } from '../../nfse/nfse-danfse.service';
import { NfseService } from '../../nfse/nfse.service';
import { NfseXmlParserService } from '../../nfse/nfse-xml-parser.service';
import { LocalStorageService } from '../../storage/storage.service';
import { SyncService } from '../sync.service';

describe('SyncService', () => {
  const schedulerConfigPath = join(tmpdir(), 'busca-nfse-tests', 'nightly-sweep.json');
  const prisma = {
    cliente: {
      findUnique: jest.fn()
    },
    clienteEstabelecimento: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn()
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
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    nfseDocumentoVinculo: {
      findUnique: jest.fn(),
      findFirst: jest.fn()
    },
    nfseEvento: {
      upsert: jest.fn(),
      updateMany: jest.fn()
    },
    nfeDocumento: {
      count: jest.fn(),
      findMany: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn(),
    putObject: jest.fn(),
    resolveKeyPath: jest.fn().mockReturnValue(schedulerConfigPath)
  };

  const adnClient: Pick<NfseAdnClient, 'getDFeByNsu'> = {
    getDFeByNsu: jest.fn()
  };
  const danfse = {
    generateFromXml: jest.fn().mockReturnValue(Buffer.from('pdf'))
  };
  const parser = {
    parse: jest.fn(),
    parseAny: jest.fn(),
    isEventoXml: jest.fn(),
    getHash: jest.fn().mockReturnValue('hash')
  };
  const nfseService = {
    sincronizarEventos: jest.fn(),
    syncDocumentoVinculos: jest.fn()
  };
  const nfeService = {
    sincronizarEventos: jest.fn()
  };
  const cteService = {
    sincronizarEventos: jest.fn()
  };

  let service: SyncService;

  const buildService = () =>
    new SyncService(
      prisma as unknown as PrismaService,
      storage as unknown as LocalStorageService,
      danfse as unknown as NfseDanfseService,
      parser as unknown as NfseXmlParserService,
      nfseService as unknown as NfseService,
      nfeService as never,
      cteService as never,
      adnClient as NfseAdnClient
    );

  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
      return;
    }

    process.env[name] = value;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    parser.parse.mockReset();
    parser.parseAny.mockReset();
    parser.isEventoXml.mockReset();
    parser.getHash.mockReturnValue('hash');
    parser.parseAny.mockImplementation((xml: string) => ({
      kind: 'nfse',
      nfse: parser.parse(xml)
    }));
    parser.isEventoXml.mockImplementation((xml: string) => /<(?:\w+:)?(?:evento|procEvento)\b/i.test(xml));
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
    prisma.clienteEstabelecimento.findFirst.mockResolvedValue(undefined);
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
    prisma.nfseDocumento.update.mockResolvedValue({});
    prisma.nfseDocumento.delete.mockResolvedValue({});
    prisma.nfseDocumento.findUnique.mockResolvedValue(null);
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    prisma.nfseDocumento.findMany.mockResolvedValue([]);
    prisma.nfseDocumentoVinculo.findUnique.mockResolvedValue(null);
    prisma.nfseDocumentoVinculo.findFirst.mockResolvedValue(null);
    prisma.nfseEvento.upsert.mockResolvedValue({});
    prisma.nfseEvento.updateMany.mockResolvedValue({ count: 0 });
    prisma.nfeDocumento.findMany.mockResolvedValue([]);
    storage.getObject.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    storage.putObject.mockResolvedValue(undefined);
    nfseService.sincronizarEventos.mockResolvedValue({
      documentosAnalisados: 0,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0,
      detalhes: []
    });
    nfseService.syncDocumentoVinculos.mockResolvedValue(undefined);
    nfeService.sincronizarEventos.mockResolvedValue({});
    cteService.sincronizarEventos.mockResolvedValue({});

    service = buildService();
  });

  afterAll(async () => {
    await rm(join(tmpdir(), 'busca-nfse-tests'), { recursive: true, force: true });
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

  it('ignora controle ja reservado por outro worker', async () => {
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
    prisma.nfseSyncControle.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 0
    });
    expect(adnClient.getDFeByNsu).not.toHaveBeenCalled();
    expect(prisma.certificado.findFirst).not.toHaveBeenCalled();
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
      localPrestacao: 'Caibi/SC',
      valorServico: '1720.00',
      codigoServicoNacional: '170101',
      descricaoServico: 'consultoria'
    });

    await service.runNow();

    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(danfse.generateFromXml).toHaveBeenCalledWith(
      '<NFSe>ok</NFSe>',
      expect.objectContaining({
        localPrestacao: 'Caibi/SC',
        municipioIncidenciaIssqn: 'Caibi/SC'
      })
    );
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

  it('registra vinculo em vez de reatribuir custodia quando a chave ja pertence a outro cliente', async () => {
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
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      xml: '<NFSe>ok</NFSe>',
      statusCode: 200,
      message: null,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      numeroNfse: '9',
      status: '100',
      cnpjPrestador: '44454248000106',
      cnpjTomador: '12345678000199'
    });

    prisma.nfseDocumento.findUnique.mockImplementation((args: { where: { ambiente_chaveAcesso?: unknown; id?: string } }) => {
      if (args.where.ambiente_chaveAcesso) {
        return Promise.resolve({
          id: 'doc-outro-cliente',
          chaveAcesso: '42110092206960810000176000000000000926062205552016',
          clienteId: 'cliente-outro',
          estabelecimentoId: 'estab-outro',
          ambiente: Ambiente.producao,
          cnpjPrestador: '44454248000106',
          cnpjTomador: '12345678000199'
        });
      }
      return Promise.resolve(null);
    });

    await service.runNow();

    expect(prisma.nfseDocumento.upsert).not.toHaveBeenCalled();
    expect(prisma.nfseDocumento.update).not.toHaveBeenCalled();
    expect(nfseService.syncDocumentoVinculos).toHaveBeenCalledWith(
      'doc-outro-cliente',
      Ambiente.producao,
      '44454248000106',
      '12345678000199',
      'cliente-outro',
      'estab-outro',
      { clienteId: 'cliente-1', nsu: 9n }
    );
  });

  it('reconcilia documento existente pelo NSU quando o upsert falha na unicidade secundaria', async () => {
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
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000926062205552016</chaveAcesso><numeroNFSe>9</numeroNFSe></NFSe>',
      statusCode: 200,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      numeroNfse: '9',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    });

    prisma.nfseDocumento.upsert.mockRejectedValue({
      code: 'P2002',
      meta: {
        target: ['cliente_id', 'ambiente', 'nsu']
      }
    });
    prisma.nfseDocumento.findUnique.mockImplementation(({ where }) => {
      if (where?.ambiente_chaveAcesso) {
        return Promise.resolve(null);
      }

      if (where?.clienteId_ambiente_nsu) {
        return Promise.resolve({
          id: 'doc-existing',
          chaveAcesso: '42110092206960810000176000000000000126062205552001'
        });
      }

      return Promise.resolve(null);
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-existing',
      chaveAcesso: '42110092206960810000176000000000000926062205552016'
    });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1
    });
    expect(prisma.nfseDocumento.upsert).not.toHaveBeenCalled();
    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-existing' },
        data: expect.objectContaining({
          nsu: 9n,
          chaveAcesso: '42110092206960810000176000000000000926062205552016',
          numeroNfse: '9'
        })
      })
    );
  });

  it('mescla documento existente por chave com placeholder ja ocupado pelo mesmo NSU', async () => {
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
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000926062205552016</chaveAcesso><numeroNFSe>9</numeroNFSe></NFSe>',
      statusCode: 200,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      numeroNfse: '9',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    });

    prisma.nfseDocumento.findUnique.mockImplementation(({ where }) => {
      if (where?.ambiente_chaveAcesso) {
        return Promise.resolve({
          id: 'doc-by-chave',
          chaveAcesso: '42110092206960810000176000000000000926062205552016'
        });
      }

      if (where?.clienteId_ambiente_nsu) {
        return Promise.resolve({
          id: 'doc-by-nsu',
          chaveAcesso: '42110092206960810000176000000000000126062205552001'
        });
      }

      return Promise.resolve(null);
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-by-chave',
      chaveAcesso: '42110092206960810000176000000000000926062205552016'
    });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1
    });
    expect(prisma.nfseEvento.updateMany).toHaveBeenCalledWith({
      where: {
        nfseDocumentoId: 'doc-by-nsu'
      },
      data: {
        nfseDocumentoId: 'doc-by-chave'
      }
    });
    expect(prisma.nfseDocumento.delete).toHaveBeenCalledWith({
      where: {
        id: 'doc-by-nsu'
      }
    });
    expect(prisma.nfseDocumento.upsert).not.toHaveBeenCalled();
    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'doc-by-chave'
        },
        data: expect.objectContaining({
          nsu: 9n,
          chaveAcesso: '42110092206960810000176000000000000926062205552016'
        })
      })
    );
  });

  it('repete o upsert quando a linha conflitante ainda nao esta visivel para reconciliacao', async () => {
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
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000926062205552016</chaveAcesso><numeroNFSe>9</numeroNFSe></NFSe>',
      statusCode: 200,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      numeroNfse: '9',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    });

    prisma.nfseDocumento.upsert
      .mockRejectedValueOnce({
        code: 'P2002',
        meta: {
          target: ['cliente_id', 'ambiente', 'nsu']
        }
      })
      .mockResolvedValueOnce({
        id: 'doc-retried',
        chaveAcesso: '42110092206960810000176000000000000926062205552016'
      });
    prisma.nfseDocumento.findUnique.mockImplementation(({ where }) => {
      if (where?.ambiente_chaveAcesso) {
        return Promise.resolve(null);
      }

      if (where?.clienteId_ambiente_nsu) {
        return Promise.resolve(null);
      }

      return Promise.resolve(null);
    });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1
    });
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.nfseDocumento.update).not.toHaveBeenCalled();
  });

  it('reconcilia documento existente pelo NSU mesmo sem target detalhado no erro do Prisma', async () => {
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
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000926062205552016</chaveAcesso><numeroNFSe>9</numeroNFSe></NFSe>',
      statusCode: 200,
      rawResponse: {}
    });

    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000926062205552016',
      numeroNfse: '9',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    });

    prisma.nfseDocumento.upsert.mockRejectedValue({
      code: 'P2002',
      meta: {
        target: 'nfse_documentos_cliente_id_ambiente_nsu_key'
      }
    });
    prisma.nfseDocumento.findUnique.mockImplementation(({ where }) => {
      if (where?.clienteId_ambiente_nsu) {
        return Promise.resolve({
          id: 'doc-existing',
          chaveAcesso: '42110092206960810000176000000000000126062205552001'
        });
      }

      return Promise.resolve(null);
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-existing',
      chaveAcesso: '42110092206960810000176000000000000926062205552016'
    });

    await service.runNow();

    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-existing' },
        data: expect.objectContaining({
          nsu: 9n,
          chaveAcesso: '42110092206960810000176000000000000926062205552016'
        })
      })
    );
  });

  it('salva todos os documentos quando ADN retorna lote para o mesmo NSU consultado', async () => {
    const buildDocument = (numero: string, nsu: bigint) => {
      const chave = `421100922069608100001760000000000${numero}26062205552016`;
      const xml = `<NFSe><chaveAcesso>${chave}</chaveAcesso><numeroNFSe>${numero}</numeroNFSe></NFSe>`;

      return {
        nsu,
        chaveAcesso: chave,
        xml
      };
    };
    const documents = [buildDocument('333', 9n), buildDocument('334', 10n), buildDocument('335', 11n)];

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
      chaveAcesso: documents[0].chaveAcesso,
      xml: documents[0].xml,
      documents,
      statusCode: 200,
      message: null,
      rawResponse: { lote: true }
    });

    parser.parse.mockImplementation((xml: string) => {
      const chaveAcesso = xml.match(/<chaveAcesso>([^<]+)<\/chaveAcesso>/)?.[1] ?? '';
      const numeroNfse = xml.match(/<numeroNFSe>([^<]+)<\/numeroNFSe>/)?.[1] ?? '';

      return {
        chaveAcesso,
        numeroNfse,
        serie: '900',
        dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
        competencia: new Date('2026-06-01T00:00:00.000Z'),
        status: '100',
        cnpjPrestador: '44454248000106',
        cnpjTomador: '06960810000176',
        valorServico: '100.00'
      };
    });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 3
    });
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(3);
    expect(storage.putObject).toHaveBeenCalledTimes(6);
    expect(prisma.nfseDocumento.upsert.mock.calls.map((call) => call[0].create.numeroNfse)).toEqual([
      '333',
      '334',
      '335'
    ]);
    expect(prisma.nfseDocumento.upsert.mock.calls.map((call) => call[0].create.nsu)).toEqual([9n, 10n, 11n]);
    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 11n,
          ultimoNsuComDocumento: 11n,
          totalDocumentosBaixados: {
            increment: 3
          },
          ultimaMensagem: 'Lote ADN sincronizado com 3 documento(s)'
        })
      })
    );
  });

  it('salva evento de cancelamento por NSU e marca a NFS-e relacionada como cancelada', async () => {
    const eventXml = `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento>
    <pedRegEvento>
      <infPedReg>
        <dhEvento>2026-06-03T15:43:08-03:00</dhEvento>
        <CNPJAutor>06960810000176</CNPJAutor>
        <chNFSe>42110092206960810000176000000000033326062205552016</chNFSe>
        <e101101><xDesc>Cancelamento de NFS-e</xDesc></e101101>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`;

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
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      xml: eventXml,
      statusCode: 200,
      message: null,
      rawResponse: {}
    });

    parser.parseAny.mockReturnValue({
      kind: 'evento',
      evento: {
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        tipoEvento: 'e101101',
        dataEvento: new Date('2026-06-03T18:43:08.000Z'),
        descricao: 'Cancelamento de NFS-e',
        cnpjAutor: '06960810000176',
        isCancelamento: true
      }
    });
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-original',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao_restrita,
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        cnpjPrestador: '06960810000176',
        cnpjTomador: null,
        xmlPath: 'nfse/producao_restrita/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
        numeroNfse: '333',
        dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
        createdAt: new Date('2026-06-03T12:00:00.000Z'),
        updatedAt: new Date('2026-06-03T12:00:00.000Z')
      }
    ]);
    prisma.nfseDocumento.upsert.mockResolvedValue({
      id: 'doc-original',
      chaveAcesso: '42110092206960810000176000000000033326062205552016'
    });

    const result = await service.runNow();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1
    });
    expect(danfse.generateFromXml).not.toHaveBeenCalled();
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining(
        'nfse/producao_restrita/06960810000176/2026/06/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'
      ),
      eventXml
    );
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ambiente_chaveAcesso: {
            ambiente: Ambiente.producao_restrita,
            chaveAcesso: '42110092206960810000176000000000033326062205552016'
          }
        },
        update: expect.objectContaining({
          status: 'cancelada',
          dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
          danfsePath: null
        })
      })
    );
    expect(prisma.nfseEvento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          nfseDocumentoId: 'doc-original',
          chaveAcesso: '42110092206960810000176000000000033326062205552016',
          tipoEvento: 'e101101'
        })
      })
    );
    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 9n,
          ultimoNsuComDocumento: 9n,
          ultimaMensagem: 'Evento sincronizado com sucesso'
        })
      })
    );
  });

  it('reprocessa NSUs ja consultados pulando documentos existentes', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        nsuInicial: 3n,
        ultimoNsuConsultado: 3n,
        ultimoNsuComDocumento: 1n,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z')
      }
    ]);
    prisma.nfseDocumento.findFirst.mockImplementation(({ where }) => {
      if (where.nsu === 1n || where.nsu === 3n) {
        return Promise.resolve({
          xmlPath: `nfse/producao/12345678000199/2026/06/xml/${where.nsu}.xml`,
          numeroNfse: String(where.nsu),
          dataEmissao: new Date('2026-06-03T12:00:00.000Z')
        });
      }

      return Promise.resolve(null);
    });
    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 2n,
      hasDocument: true,
      chaveAcesso: '42110092206960810000176000000000000226062205552016',
      xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000226062205552016</chaveAcesso><numeroNFSe>2</numeroNFSe></NFSe>',
      statusCode: 200,
      rawResponse: {}
    });
    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000226062205552016',
      numeroNfse: '2',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    });

    const result = await service.reprocessPastNsus({ clienteId: 'cliente-1' });

    expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(1);
    expect(adnClient.getDFeByNsu).toHaveBeenCalledWith(
      expect.objectContaining({
        nsu: 2n
      })
    );
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        controlesEncontrados: 1,
        controlesProcessados: 1,
        nsusAvaliados: 3,
        nsusConsultados: 1,
        nsusIgnoradosComDocumento: 2,
        documentosSalvos: 1
      })
    );
    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          totalDocumentosBaixados: {
            increment: 1
          },
          ultimoNsuComDocumento: 2n
        })
      })
    );
    expect(prisma.nfseSyncControle.update.mock.calls.at(-1)?.[0].data.ultimoNsuConsultado).toBeUndefined();
  });

  it('nao conta como salvo um XML ja existente por chave durante o reprocessamento de NSUs', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        nsuInicial: 2n,
        ultimoNsuConsultado: 2n,
        ultimoNsuComDocumento: 0n,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z')
      }
    ]);
    prisma.nfseDocumento.findFirst.mockImplementation(({ where }) => {
      if (where?.nsu === 1n) {
        return Promise.resolve({
          xmlPath: 'nfse/producao/12345678000199/2026/06/xml/1.xml',
          numeroNfse: '1',
          dataEmissao: new Date('2026-06-03T12:00:00.000Z')
        });
      }

      if (where?.nsu === 2n) {
        return Promise.resolve(null);
      }

      if (
        where?.chaveAcesso === '42110092206960810000176000000000000226062205552016' ||
        where?.chaveAcesso === '42110092206960810000176000000000000326062205552017'
      ) {
        return Promise.resolve({
          id: 'doc-existing',
          ambiente: Ambiente.producao,
          status: 'autorizada',
          dataCancelamento: null,
          nsu: null,
          xmlPath: 'nfse/producao/12345678000199/2026/06/xml/42110092206960810000176000000000000226062205552016.xml',
          numeroNfse: '2',
          dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
          hashXml: 'hash'
        });
      }

      return Promise.resolve(null);
    });
    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 2n,
      hasDocument: true,
      chaveAcesso: '42110092206960810000176000000000000226062205552016',
      documents: [
        {
          chaveAcesso: '42110092206960810000176000000000000226062205552016',
          xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000226062205552016</chaveAcesso><numeroNFSe>2</numeroNFSe></NFSe>'
        },
        {
          chaveAcesso: '42110092206960810000176000000000000326062205552017',
          xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000326062205552017</chaveAcesso><numeroNFSe>3</numeroNFSe></NFSe>'
        }
      ],
      xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000226062205552016</chaveAcesso><numeroNFSe>2</numeroNFSe></NFSe>',
      statusCode: 200,
      rawResponse: {}
    });
    parser.parse.mockImplementation((xml: string) => ({
      chaveAcesso: xml.match(/<chaveAcesso>([^<]+)<\/chaveAcesso>/)?.[1] ?? '',
      numeroNfse: xml.match(/<numeroNFSe>([^<]+)<\/numeroNFSe>/)?.[1] ?? '',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    }));

    const result = await service.reprocessPastNsus({ clienteId: 'cliente-1' });

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.nfseDocumento.upsert).not.toHaveBeenCalled();
    expect(prisma.nfseDocumento.update).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        nsusAvaliados: 2,
        nsusConsultados: 1,
        documentosSalvos: 0,
        nsusIgnoradosComDocumento: 1,
        documentosIgnoradosExistentes: 2,
        semDocumento: 0
      })
    );
    expect(prisma.nfseSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimaMensagem:
            'Recuperacao de NSUs passados: 0 documento(s) salvo(s), 3 ja existente(s), 0 sem documento.'
        })
      })
    );
  });

  it('finaliza o NSU consultado como sem documento quando o ADN retorna apenas itens de outros NSUs', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        nsuInicial: 54n,
        ultimoNsuConsultado: 54n,
        ultimoNsuComDocumento: 0n,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z')
      }
    ]);
    prisma.nfseDocumento.findFirst.mockImplementation(({ where }) => {
      if (typeof where?.nsu === 'bigint' && where.nsu !== 52n) {
        return Promise.resolve({
          xmlPath: `nfse/producao/12345678000199/2026/06/xml/${where.nsu.toString()}.xml`,
          numeroNfse: where.nsu.toString(),
          dataEmissao: new Date('2026-06-03T12:00:00.000Z')
        });
      }

      return Promise.resolve(null);
    });
    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 52n,
      hasDocument: true,
      chaveAcesso: '4211009221065205400019500000000003526010859256454',
      documents: [
        {
          nsu: 53n,
          chaveAcesso: '4211009221065205400019500000000003526010859256454',
          xml: '<NFSe><chaveAcesso>4211009221065205400019500000000003526010859256454</chaveAcesso><numeroNFSe>53</numeroNFSe></NFSe>'
        },
        {
          nsu: 54n,
          chaveAcesso: '4211009221065205400019500000000004526010859256455',
          xml: '<NFSe><chaveAcesso>4211009221065205400019500000000004526010859256455</chaveAcesso><numeroNFSe>54</numeroNFSe></NFSe>'
        }
      ],
      statusCode: 200,
      rawResponse: {}
    });

    const execution = await service.startPastNsuRecoveryExecution({ clienteId: 'cliente-1' });

    let latestExecution = execution;
    for (let attempt = 0; attempt < 20 && latestExecution.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      latestExecution = service.getPastNsuRecoveryExecution(execution.executionId);
    }

    expect(latestExecution.status).toBe('completed');
    expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(1);
    expect(latestExecution.summary).toEqual(
      expect.objectContaining({
        nsusAvaliados: 54,
        nsusConsultados: 1,
        nsusIgnoradosComDocumento: 53,
        documentosSalvos: 0,
        documentosIgnoradosExistentes: 2,
        semDocumento: 1,
        falhas: 0
      })
    );
    expect(latestExecution.rows.find((row) => row.nsu === '52')).toEqual(
      expect.objectContaining({
        status: 'sem_documento',
        chaveAcesso: '4211009221065205400019500000000003526010859256454',
        mensagem: 'O ADN retornou apenas documentos vinculados aos NSUs 53, 54; nenhum item ficou associado ao NSU 52.'
      })
    );
  });

  it('reprocessa NSU com retry quando ADN retorna timeout temporario', async () => {
    const sleepSpy = jest.spyOn(service as any, 'sleep').mockImplementation(async () => undefined);

    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        nsuInicial: 1n,
        ultimoNsuConsultado: 1n,
        ultimoNsuComDocumento: 0n,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z')
      }
    ]);
    (adnClient.getDFeByNsu as jest.Mock)
      .mockResolvedValueOnce({
        nsu: 1n,
        hasDocument: false,
        statusCode: 0,
        message: 'Timeout ao consultar API ADN',
        rawResponse: {}
      })
      .mockResolvedValueOnce({
        nsu: 1n,
        hasDocument: true,
        chaveAcesso: '42110092206960810000176000000000000126062205552016',
        xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000126062205552016</chaveAcesso><numeroNFSe>1</numeroNFSe></NFSe>',
        statusCode: 200,
        rawResponse: {}
      });
    parser.parse.mockReturnValue({
      chaveAcesso: '42110092206960810000176000000000000126062205552016',
      numeroNfse: '1',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: '100',
      cnpjPrestador: '12345678000199'
    });

    const result = await service.reprocessPastNsus({ clienteId: 'cliente-1' });

    expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(2);
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        nsusAvaliados: 1,
        nsusConsultados: 2,
        documentosSalvos: 1,
        falhas: 0,
        interrompidoPorRateLimit: false
      })
    );
    expect(sleepSpy).toHaveBeenCalled();
  });

  it('marca explicitamente quando o NSU consultado corresponde a um evento', async () => {
    const eventXml = `<?xml version="1.0" encoding="UTF-8"?>
<evento xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento>
    <pedRegEvento>
      <infPedReg>
        <dhEvento>2026-06-03T15:43:08-03:00</dhEvento>
        <CNPJAutor>06960810000176</CNPJAutor>
        <chNFSe>42110092206960810000176000000000033326062205552016</chNFSe>
        <e101101><xDesc>Cancelamento de NFS-e</xDesc></e101101>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`;

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
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      xml: eventXml,
      statusCode: 200,
      message: null,
      rawResponse: {}
    });

    parser.parseAny.mockReturnValue({
      kind: 'evento',
      evento: {
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        tipoEvento: 'e101101',
        dataEvento: new Date('2026-06-03T18:43:08.000Z'),
        descricao: 'Cancelamento de NFS-e',
        cnpjAutor: '06960810000176',
        isCancelamento: true
      }
    });
    parser.isEventoXml.mockReturnValue(true);
    prisma.nfseDocumento.upsert.mockResolvedValue({
      id: 'doc-evento',
      chaveAcesso: '42110092206960810000176000000000033326062205552016'
    });

    const execution = await service.startPastNsuRecoveryExecution({ clienteId: 'cliente-1' });

    let latestExecution = execution;
    for (let attempt = 0; attempt < 20 && latestExecution.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      latestExecution = service.getPastNsuRecoveryExecution(execution.executionId);
    }

    expect(latestExecution.status).toBe('completed');
    expect(latestExecution.rows.find((row) => row.nsu === '9')).toEqual(
      expect.objectContaining({
        status: 'baixado',
        documentKind: 'evento',
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        mensagem: 'Evento recuperado com sucesso para este NSU.'
      })
    );
  });

  it('restringe a auditoria de lacunas aos NSUs inferidos pela vizinhanca de numeracao', async () => {
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        ultimoNsuConsultado: 60n,
        nsuInicial: 1n,
        ultimoNsuComDocumento: 52n,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z')
      }
    ]);
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        nsu: 50n,
        numeroNfse: '9',
        serie: '900'
      },
      {
        nsu: 52n,
        numeroNfse: '11',
        serie: '900'
      }
    ]);
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      nsu: 51n,
      hasDocument: false,
      statusCode: 404,
      message: 'Sem documento para o NSU informado',
      rawResponse: {}
    });

    const execution = await service.startPastNsuRecoveryExecution({
      clienteId: 'cliente-1',
      cnpjConsulta: '12345678000199',
      ambiente: Ambiente.producao,
      lacunas: [
        {
          ambiente: Ambiente.producao,
          serie: '900',
          numeroInicial: 10,
          numeroFinal: 10
        }
      ]
    });

    let latestExecution = execution;
    for (let attempt = 0; attempt < 20 && latestExecution.status === 'running'; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      latestExecution = service.getPastNsuRecoveryExecution(execution.executionId);
    }

    expect(latestExecution.status).toBe('completed');
    expect(latestExecution.rows.map((row) => row.nsu)).toEqual(['51']);
    expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(1);
    expect(adnClient.getDFeByNsu).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      nsu: 51n,
      ambiente: NfseAmbiente.PRODUCAO,
      certificateId: 'cert-1'
    });
    expect(latestExecution.summary).toEqual(
      expect.objectContaining({
        controlesEncontrados: 1,
        nsusAvaliados: 1,
        nsusConsultados: 1,
        documentosSalvos: 0,
        semDocumento: 1
      })
    );
  });

  it('continua reprocessamento apos esgotar retries de timeout em um NSU', async () => {
    const previousRetryCount = process.env.SYNC_PAST_NSU_RETRY_COUNT;
    const previousRetryDelay = process.env.SYNC_PAST_NSU_RETRY_DELAY_MS;
    process.env.SYNC_PAST_NSU_RETRY_COUNT = '1';
    process.env.SYNC_PAST_NSU_RETRY_DELAY_MS = '1';
    service = buildService();

    const sleepSpy = jest.spyOn(service as any, 'sleep').mockImplementation(async () => undefined);

    try {
      prisma.nfseSyncControle.findMany.mockResolvedValue([
        {
          id: 'ctrl-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          cnpjConsulta: '12345678000199',
          ambiente: Ambiente.producao,
          nsuInicial: 2n,
          ultimoNsuConsultado: 2n,
          ultimoNsuComDocumento: 0n,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z')
        }
      ]);
      (adnClient.getDFeByNsu as jest.Mock)
        .mockResolvedValueOnce({
          nsu: 1n,
          hasDocument: false,
          statusCode: 0,
          message: 'Timeout ao consultar API ADN',
          rawResponse: {}
        })
        .mockResolvedValueOnce({
          nsu: 1n,
          hasDocument: false,
          statusCode: 0,
          message: 'Timeout ao consultar API ADN',
          rawResponse: {}
        })
        .mockResolvedValueOnce({
          nsu: 2n,
          hasDocument: true,
          chaveAcesso: '42110092206960810000176000000000000226062205552016',
          xml: '<NFSe><chaveAcesso>42110092206960810000176000000000000226062205552016</chaveAcesso><numeroNFSe>2</numeroNFSe></NFSe>',
          statusCode: 200,
          rawResponse: {}
        });
      parser.parse.mockReturnValue({
        chaveAcesso: '42110092206960810000176000000000000226062205552016',
        numeroNfse: '2',
        dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
        status: '100',
        cnpjPrestador: '12345678000199'
      });

      const result = await service.reprocessPastNsus({ clienteId: 'cliente-1' });

      expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(3);
      expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.nfseSyncLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'erro_api',
            nsuConsultado: 1n,
            mensagem: 'Timeout ao consultar API ADN'
          })
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          nsusAvaliados: 2,
          nsusConsultados: 3,
          documentosSalvos: 1,
          falhas: 1,
          interrompidoPorRateLimit: false
        })
      );
      expect(sleepSpy).toHaveBeenCalled();
    } finally {
      restoreEnv('SYNC_PAST_NSU_RETRY_COUNT', previousRetryCount);
      restoreEnv('SYNC_PAST_NSU_RETRY_DELAY_MS', previousRetryDelay);
      service = buildService();
    }
  });

  it('em modo diario interrompe o ciclo apos primeiro documento e agenda cooldown de sucesso', async () => {
    const previousStop = process.env.SYNC_DAILY_STOP_ON_FIRST_DOCUMENT;
    process.env.SYNC_DAILY_STOP_ON_FIRST_DOCUMENT = 'true';
    service = buildService();

    try {
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
    } finally {
      restoreEnv('SYNC_DAILY_STOP_ON_FIRST_DOCUMENT', previousStop);
    }
  });

  it('em modo diario sem parada no primeiro documento processa lote de NSUs', async () => {
    const previousStop = process.env.SYNC_DAILY_STOP_ON_FIRST_DOCUMENT;
    const previousMax = process.env.SYNC_DAILY_MAX_NSU_PER_RUN;
    const previousRequestInterval = process.env.SYNC_ADN_REQUEST_INTERVAL_MS;
    const previousCooldown = process.env.SYNC_DAILY_SUCCESS_COOLDOWN_MS;
    process.env.SYNC_DAILY_STOP_ON_FIRST_DOCUMENT = 'false';
    process.env.SYNC_DAILY_MAX_NSU_PER_RUN = '2';
    process.env.SYNC_ADN_REQUEST_INTERVAL_MS = '1';
    process.env.SYNC_DAILY_SUCCESS_COOLDOWN_MS = '10';
    service = buildService();

    try {
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

      (adnClient.getDFeByNsu as jest.Mock)
        .mockResolvedValueOnce({
          nsu: 9n,
          hasDocument: true,
          chaveAcesso: '42110092206960810000176000000000000226015757529368',
          xml: '<NFSe>ok-9</NFSe>',
          statusCode: 200,
          message: null,
          rawResponse: {}
        })
        .mockResolvedValueOnce({
          nsu: 10n,
          hasDocument: true,
          chaveAcesso: '42110092206960810000176000000000000326015757529369',
          xml: '<NFSe>ok-10</NFSe>',
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

      const result = await service.runNow();

      expect(result).toEqual({
        processed: 1,
        documentsSaved: 2
      });
      expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(2);
      expect(adnClient.getDFeByNsu).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          nsu: 9n
        })
      );
      expect(adnClient.getDFeByNsu).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          nsu: 10n
        })
      );
      expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.nfseSyncControle.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'ctrl-1' },
          data: expect.objectContaining({
            proximaExecucao: expect.any(Date),
            ultimaMensagem: 'Lote diario sincronizado com 2 documento(s); proxima busca agendada'
          })
        })
      );
    } finally {
      restoreEnv('SYNC_DAILY_STOP_ON_FIRST_DOCUMENT', previousStop);
      restoreEnv('SYNC_DAILY_MAX_NSU_PER_RUN', previousMax);
      restoreEnv('SYNC_ADN_REQUEST_INTERVAL_MS', previousRequestInterval);
      restoreEnv('SYNC_DAILY_SUCCESS_COOLDOWN_MS', previousCooldown);
    }
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

  it('executa rotina automatica de eventos para NFS-e salvas ao fim do ciclo automatico', async () => {
    prisma.nfseSyncControle.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'ctrl-evt-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: Ambiente.producao,
          createdAt: new Date('2026-07-13T00:00:00.000Z'),
          updatedAt: new Date('2026-07-13T00:00:00.000Z')
        }
      ]);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-evt-1',
        status: 'autorizada',
        dataCancelamento: null,
        createdAt: new Date('2026-07-12T00:00:00.000Z'),
        updatedAt: new Date('2026-07-12T00:00:00.000Z'),
        eventos: []
      }
    ]);
    nfseService.sincronizarEventos.mockResolvedValueOnce({
      documentosAnalisados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-evt-1',
          chaveAcesso: '42110092206960810000176000000000000126019687178145',
          estabelecimentoId: 'estab-1',
          ambiente: 'producao',
          status: 'sem_eventos',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: 'Nenhum evento encontrado no ADN'
        }
      ]
    });

    await (service as unknown as { runAutomaticSyncCycle: () => Promise<void> }).runAutomaticSyncCycle();

    expect(nfseService.sincronizarEventos).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: 'producao',
      documentoIds: ['doc-evt-1'],
      somenteSemEventos: false,
      limit: 1
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      'settings/nfse-event-auto-sync-state.json',
      expect.stringContaining('"doc-evt-1"')
    );
  });

  it('nao executa rotina automatica de eventos quando desabilitada por variavel de ambiente', async () => {
    const previous = process.env.SYNC_EVENTS_AUTO_RUN_ENABLED;
    process.env.SYNC_EVENTS_AUTO_RUN_ENABLED = 'false';

    try {
      service = buildService();
      prisma.nfseSyncControle.findMany.mockResolvedValueOnce([]);

      await (service as unknown as { runAutomaticSyncCycle: () => Promise<void> }).runAutomaticSyncCycle();

      expect(nfseService.sincronizarEventos).not.toHaveBeenCalled();
    } finally {
      restoreEnv('SYNC_EVENTS_AUTO_RUN_ENABLED', previous);
      service = buildService();
    }
  });

  it('retorna status operacional do agendador de sync', () => {
    const result = service.schedulerStatus();

    expect(result.autoSync).toEqual(
      expect.objectContaining({
        enabled: true,
        running: false,
        intervalMs: expect.any(Number),
        startupDelayMs: expect.any(Number)
      })
    );
    expect(result.autoEventSync).toEqual(
      expect.objectContaining({
        enabled: true,
        perControlLimit: expect.any(Number),
        candidateWindow: expect.any(Number),
        maxDocumentAgeDays: 90,
        noEventCooldownMs: expect.any(Number),
        withEventCooldownMs: expect.any(Number),
        failureCooldownMs: expect.any(Number),
        certificateCooldownMs: expect.any(Number)
      })
    );
    expect(result.nightlyEventSync).toEqual({
      enabled: true,
      maxDocumentAgeDays: 90,
      perEstablishmentLimit: 25,
      candidateWindow: 250
    });
    expect(result.nightlyPastNsuRecovery).toEqual({
      enabled: true,
      running: false,
      controlsPerRun: 10,
      nsusPerControl: 5
    });
    expect(result.nightlySweep).toEqual(
      expect.objectContaining({
        enabled: true,
        running: false,
        hour: expect.any(Number),
        minute: expect.any(Number),
        activeSlots: ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'],
        availableSlots: ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'],
        timezoneOffsetMinutes: expect.any(Number),
        checkIntervalMs: expect.any(Number),
        nextRunAt: expect.any(String),
        taskSchedule: {
          nfseIncrementalSlots: ['18:00', '22:00', '02:00', '06:00'],
          nfeCteEventSlots: ['00:00'],
          pastNsuRecoverySlots: ['20:00', '04:00']
        }
      })
    );
  });

  it('limita a consulta automatica de eventos a documentos de ate 90 dias', async () => {
    prisma.nfseSyncControle.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'ctrl-evt-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: Ambiente.producao,
          createdAt: new Date('2026-07-13T00:00:00.000Z'),
          updatedAt: new Date('2026-07-13T00:00:00.000Z')
        }
      ]);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([]);

    await (service as unknown as { runAutomaticSyncCycle: () => Promise<void> }).runAutomaticSyncCycle();

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              dataEmissao: {
                gte: expect.any(Date)
              }
            },
            {
              dataEmissao: null,
              createdAt: {
                gte: expect.any(Date)
              }
            }
          ]
        })
      })
    );
    expect(nfseService.sincronizarEventos).not.toHaveBeenCalled();
  });

  it('consulta NF-e e CT-e elegiveis durante a busca noturna, respeitando o limite de idade', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'nfe-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        modelo: '55',
        schemaDoc: 'procNFe_v4.00',
        dataEmissao: new Date(),
        createdAt: new Date()
      },
      {
        id: 'cte-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        modelo: '57',
        schemaDoc: 'cteProc_v4.00',
        dataEmissao: new Date(),
        createdAt: new Date()
      }
    ]);

    await (service as unknown as { runNightlyEventSyncCycle: () => Promise<void> }).runNightlyEventSyncCycle();

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { dataEmissao: { gte: expect.any(Date) } },
            { dataEmissao: null, createdAt: { gte: expect.any(Date) } }
          ]
        }
      })
    );
    expect(nfeService.sincronizarEventos).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      documentoIds: ['nfe-1'],
      somenteSemEventos: false,
      limit: 1
    });
    expect(cteService.sincronizarEventos).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      documentoIds: ['cte-1'],
      somenteSemEventos: false,
      limit: 1
    });
  });

  it('sincroniza eventos de NF-e e CT-e para as empresas selecionadas, limitando a 90 dias', async () => {
    prisma.nfeDocumento.findMany
      .mockResolvedValueOnce([
        { id: 'nfe-1', clienteId: 'cliente-1', modelo: '55', schemaDoc: 'procNFe_v4.00' },
        { id: 'cte-1', clienteId: 'cliente-2', modelo: '57', schemaDoc: 'cteProc_v4.00' }
      ])
      .mockResolvedValueOnce([]);
    nfeService.sincronizarEventos.mockResolvedValueOnce({
      documentosProcessados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 2,
      eventosImportados: 2,
      falhas: 0
    });
    cteService.sincronizarEventos.mockResolvedValueOnce({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0
    });

    const result = await service.sincronizarEventosEmpresas({ clienteIds: ['cliente-1', 'cliente-2'] });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clienteId: { in: ['cliente-1', 'cliente-2'] },
          OR: [
            { dataEmissao: { gte: expect.any(Date) } },
            { dataEmissao: null, createdAt: { gte: expect.any(Date) } }
          ]
        }
      })
    );
    expect(nfeService.sincronizarEventos).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      documentoIds: ['nfe-1'],
      somenteSemEventos: false,
      limit: 1
    });
    expect(cteService.sincronizarEventos).toHaveBeenCalledWith({
      clienteId: 'cliente-2',
      documentoIds: ['cte-1'],
      somenteSemEventos: false,
      limit: 1
    });
    expect(result).toMatchObject({
      limiteDias: 90,
      empresasProcessadas: 2,
      documentosSelecionados: 2,
      documentosProcessados: 2,
      documentosComEventos: 1,
      eventosEncontrados: 2,
      eventosImportados: 2,
      falhas: 0
    });
  });

  it('informa o total e o progresso da execucao de busca manual de eventos', async () => {
    prisma.nfeDocumento.count.mockResolvedValue(2);
    prisma.nfeDocumento.findMany
      .mockResolvedValueOnce([
        { id: 'nfe-1', clienteId: 'cliente-1', modelo: '55', schemaDoc: 'procNFe_v4.00' },
        { id: 'cte-1', clienteId: 'cliente-1', modelo: '57', schemaDoc: 'cteProc_v4.00' }
      ])
      .mockResolvedValueOnce([]);
    nfeService.sincronizarEventos.mockResolvedValueOnce({
      documentosProcessados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 1,
      eventosImportados: 1,
      falhas: 0
    });
    cteService.sincronizarEventos.mockResolvedValueOnce({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0
    });

    const started = await service.startSincronizacaoEventosEmpresasExecution({ clienteIds: ['cliente-1'] });

    expect(started).toMatchObject({
      status: 'running',
      documentosTotal: 2,
      documentosConsultados: 0
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const completed = service.getSincronizacaoEventosEmpresasExecution(started.executionId);

    expect(completed).toMatchObject({
      status: 'completed',
      documentosTotal: 2,
      documentosConsultados: 2,
      result: {
        documentosProcessados: 2,
        eventosImportados: 1
      }
    });
  });

  it('nao reconsulta NF-e e CT-e na rotina noturna antes do cooldown do documento', async () => {
    const futureAttempt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    storage.getObject.mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          documents: {},
          nfeCteDocuments: {
            'nfe-ja-consultada': { nextAttemptAt: futureAttempt, lastStatus: 'sem_eventos' }
          }
        })
      )
    );
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'nfe-ja-consultada',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        modelo: '55',
        schemaDoc: 'procNFe_v4.00',
        dataEmissao: new Date(),
        createdAt: new Date()
      },
      {
        id: 'nfe-nova',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        modelo: '55',
        schemaDoc: 'procNFe_v4.00',
        dataEmissao: new Date(),
        createdAt: new Date()
      }
    ]);
    nfeService.sincronizarEventos.mockResolvedValue({
      detalhes: [
        {
          documentoId: 'nfe-nova',
          status: 'sem_eventos',
          eventosEncontrados: 0
        }
      ]
    });

    await (service as unknown as { runNightlyEventSyncCycle: () => Promise<void> }).runNightlyEventSyncCycle();

    expect(nfeService.sincronizarEventos).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      documentoIds: ['nfe-nova'],
      somenteSemEventos: false,
      limit: 1
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      'settings/nfse-event-auto-sync-state.json',
      expect.stringContaining('"nfe-nova"')
    );
  });

  it('recupera NSUs passados a noite em lotes incrementais e persiste o proximo cursor', async () => {
    (service as unknown as { adnRequestIntervalMs: number }).adnRequestIntervalMs = 0;
    prisma.nfseSyncControle.findMany.mockResolvedValue([
      {
        id: 'controle-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: Ambiente.producao,
        status: 'ativo',
        ultimoNsuConsultado: 3n,
        ultimoNsuComDocumento: 0n,
        totalDocumentosBaixados: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    (adnClient.getDFeByNsu as jest.Mock).mockResolvedValue({
      hasDocument: false,
      statusCode: 404,
      message: 'NSU sem documento'
    });

    await (
      service as unknown as { runNightlyPastNsuRecoveryCycle: () => Promise<void> }
    ).runNightlyPastNsuRecoveryCycle();

    expect(adnClient.getDFeByNsu).toHaveBeenCalledTimes(3);
    expect(storage.putObject).toHaveBeenCalledWith(
      'settings/nightly-past-nsu-recovery-state.json',
      expect.stringContaining('"nextNsu": "4"')
    );
    expect(nfeService.sincronizarEventos).not.toHaveBeenCalled();
    expect(cteService.sincronizarEventos).not.toHaveBeenCalled();
  });

  it('separa as tarefas da grade noturna pelos horarios definidos', async () => {
    const scheduler = service as unknown as {
      runNightlySweepForAllClients(slot: string): Promise<void>;
      runNightlyNfseIncrementalSyncForAllClients(): Promise<void>;
      runNightlyEventSyncCycle(): Promise<void>;
      runNightlyPastNsuRecoveryCycle(): Promise<void>;
    };
    const nfseSpy = jest.spyOn(scheduler, 'runNightlyNfseIncrementalSyncForAllClients').mockResolvedValue(undefined);
    const eventsSpy = jest.spyOn(scheduler, 'runNightlyEventSyncCycle').mockResolvedValue(undefined);
    const recoverySpy = jest.spyOn(scheduler, 'runNightlyPastNsuRecoveryCycle').mockResolvedValue(undefined);

    await scheduler.runNightlySweepForAllClients('18:00');
    await scheduler.runNightlySweepForAllClients('20:00');
    await scheduler.runNightlySweepForAllClients('00:00');

    expect(nfseSpy).toHaveBeenCalledTimes(1);
    expect(recoverySpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy).toHaveBeenCalledTimes(1);
  });

  it('atualiza configuracao dos horarios da rotina noturna', async () => {
    const result = await service.updateSchedulerSettings({
      enabled: true,
      activeSlots: ['18:00', '22:00', '02:00']
    });

    expect(result.nightlySweep).toEqual(
      expect.objectContaining({
        enabled: true,
        activeSlots: ['18:00', '22:00', '02:00'],
        hour: 18,
        minute: 0
      })
    );
    expect(storage.resolveKeyPath).toHaveBeenCalled();
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
