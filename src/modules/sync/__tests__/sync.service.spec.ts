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
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    nfseEvento: {
      upsert: jest.fn()
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
    parseAny: jest.fn(),
    getHash: jest.fn().mockReturnValue('hash')
  };

  let service: SyncService;

  const buildService = () =>
    new SyncService(
      prisma as unknown as PrismaService,
      storage as unknown as LocalStorageService,
      danfse as unknown as NfseDanfseService,
      parser as unknown as NfseXmlParserService,
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
    parser.getHash.mockReturnValue('hash');
    parser.parseAny.mockImplementation((xml: string) => ({
      kind: 'nfse',
      nfse: parser.parse(xml)
    }));
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
    prisma.nfseDocumento.update.mockResolvedValue({});
    prisma.nfseDocumento.findUnique.mockResolvedValue(null);
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    prisma.nfseDocumento.findMany.mockResolvedValue([]);
    prisma.nfseEvento.upsert.mockResolvedValue({});
    storage.putObject.mockResolvedValue(undefined);

    service = buildService();
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
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledTimes(1);
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
    expect(result.nightlySweep).toEqual(
      expect.objectContaining({
        enabled: true,
        running: false,
        hour: expect.any(Number),
        minute: expect.any(Number),
        timezoneOffsetMinutes: expect.any(Number),
        checkIntervalMs: expect.any(Number),
        nextRunAt: expect.any(String)
      })
    );
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
