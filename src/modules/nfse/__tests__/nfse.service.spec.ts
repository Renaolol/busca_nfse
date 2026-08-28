import { Ambiente, NfseNumeracaoExcecaoTipo, Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/storage.service';
import { NfseDanfseService } from '../nfse-danfse.service';
import { NfseService } from '../nfse.service';
import { NfseXmlParserService } from '../nfse-xml-parser.service';

describe('NfseService', () => {
  const prisma = {
    cliente: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    },
    clienteEstabelecimento: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    nfseDocumento: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn()
    },
    nfseDocumentoVinculo: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn()
    },
    nfseEvento: {
      upsert: jest.fn()
    },
    nfseNumeracaoExcecao: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn()
    },
    nfseContaContabilConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    certificado: {
      findFirst: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn(),
    putObject: jest.fn()
  };

  const adnClient = {
    getDFeByNsu: jest.fn(),
    getEventosByChave: jest.fn()
  };
  const emissorPublicoClient = {
    getNfseByChave: jest.fn(),
    getNfseByDpsId: jest.fn()
  };

  const parser = new NfseXmlParserService();
  const danfse = new NfseDanfseService();

  const service = new NfseService(
    prisma as unknown as PrismaService,
    parser,
    storage as unknown as LocalStorageService,
    danfse,
    adnClient,
    emissorPublicoClient
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.clienteEstabelecimento.findFirst.mockResolvedValue(undefined);
    prisma.clienteEstabelecimento.findMany.mockResolvedValue([]);
    prisma.nfseDocumentoVinculo.upsert.mockResolvedValue(undefined);
    prisma.cliente.findMany.mockResolvedValue([]);
    prisma.cliente.findUnique.mockResolvedValue(undefined);
    prisma.nfseNumeracaoExcecao.findMany.mockResolvedValue([]);
    prisma.nfseNumeracaoExcecao.findUnique.mockResolvedValue(undefined);
    prisma.nfseContaContabilConfig.findMany.mockResolvedValue([]);
    prisma.nfseContaContabilConfig.findUnique.mockResolvedValue(undefined);
  });

  it('pagina a listagem de NFS-e armazenadas', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(245);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      page: 3,
      pageSize: 100
    });

    expect(prisma.nfseDocumento.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ OR: [{ clienteId: 'cliente-1' }, { vinculos: { some: { clienteId: 'cliente-1' } } }] }])
      })
    });
    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 200,
        take: 100
      })
    );
    expect(result).toEqual({
      items: [],
      total: 245,
      page: 3,
      pageSize: 100,
      totalPages: 3,
      validacaoNumeracao: {
        aplicada: false,
        motivo: 'requer_consulta_emitidas',
        cnpjPrestador: null,
        totalDocumentosAnalisados: 0,
        totalNumerosValidos: 0,
        totalFaixasLacuna: 0,
        totalNumerosPulados: 0,
        possuiNumeracaoPulada: false,
        lacunas: []
      }
    });
  });

  it('ignora page/pageSize e usa o limite de seguranca quando all=true', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      page: 3,
      pageSize: 50,
      all: true
    });

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10000
      })
    );
    expect(prisma.nfseDocumento.count).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10000,
      totalPages: 1,
      validacaoNumeracao: {
        aplicada: false,
        motivo: 'requer_consulta_emitidas',
        cnpjPrestador: null,
        totalDocumentosAnalisados: 0,
        totalNumerosValidos: 0,
        totalFaixasLacuna: 0,
        totalNumerosPulados: 0,
        possuiNumeracaoPulada: false,
        lacunas: []
      }
    });
  });

  it('valida numeracao pulada na listagem de NFS-e emitidas', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-101',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000010126019687178145',
        numeroNfse: '101',
        serie: 'A1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/doc-101.xml',
        danfsePath: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-103',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000010326019687178145',
        numeroNfse: '103',
        serie: 'A1',
        dataEmissao: new Date('2026-06-03T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/doc-103.xml',
        danfsePath: null,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        updatedAt: new Date('2026-06-03T00:00:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      tipoRelacao: 'emitidas',
      all: true
    });

    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '06960810000176',
      totalDocumentosAnalisados: 2,
      totalNumerosValidos: 2,
      totalFaixasLacuna: 1,
      totalNumerosPulados: 1,
      possuiNumeracaoPulada: true,
      lacunas: [
        {
          ambiente: Ambiente.producao,
          serie: null,
          numeroInicial: 102,
          numeroFinal: 102,
          quantidade: 1
        }
      ]
    });
  });

  it('ignora a serie ao validar numeracao de NFS-e emitidas', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-55',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005526019687178145',
        numeroNfse: '55',
        serie: '900',
        dataEmissao: new Date('2026-01-31T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-55.xml',
        danfsePath: null,
        createdAt: new Date('2026-01-31T00:00:00.000Z'),
        updatedAt: new Date('2026-01-31T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-56',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005626019687178146',
        numeroNfse: '56',
        serie: '70000',
        dataEmissao: new Date('2026-01-31T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-56.xml',
        danfsePath: null,
        createdAt: new Date('2026-01-31T00:00:00.000Z'),
        updatedAt: new Date('2026-01-31T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-57',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005726019687178147',
        numeroNfse: '57',
        serie: '900',
        dataEmissao: new Date('2026-02-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '33333333000133',
        razaoSocialTomador: 'Tomador 3',
        xmlPath: 'nfse/producao/06960810000176/2026/02/xml/doc-57.xml',
        danfsePath: null,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      tipoRelacao: 'emitidas',
      all: true
    });

    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '06960810000176',
      totalDocumentosAnalisados: 3,
      totalNumerosValidos: 3,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    });
  });

  it('nao trata como lacuna um numero existente em outro ambiente do mesmo emissor', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-370-producao',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000037026019687178145',
        numeroNfse: '370',
        serie: 'A1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/doc-370.xml',
        danfsePath: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-372-producao',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000037226019687178145',
        numeroNfse: '372',
        serie: 'A1',
        dataEmissao: new Date('2026-06-03T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/doc-372.xml',
        danfsePath: null,
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
        updatedAt: new Date('2026-06-03T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-371-restrita',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao_restrita,
        chaveAcesso: '42110092206960810000176000000000037126019687178145',
        numeroNfse: '371',
        serie: 'A1',
        dataEmissao: new Date('2026-06-02T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '33333333000133',
        razaoSocialTomador: 'Tomador 3',
        xmlPath: 'nfse/producao_restrita/06960810000176/2026/06/xml/doc-371.xml',
        danfsePath: null,
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        updatedAt: new Date('2026-06-02T00:00:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      tipoRelacao: 'emitidas',
      all: true
    });

    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '06960810000176',
      totalDocumentosAnalisados: 3,
      totalNumerosValidos: 3,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    });
  });

  it('desconsidera documentos marcados para ignorar na validacao de numeracao', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000000126019687178145',
        numeroNfse: '1',
        serie: '1',
        dataEmissao: new Date('2026-01-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-1.xml',
        danfsePath: null,
        ignorarNumeracaoValidacao: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-2',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000000226019687178146',
        numeroNfse: '2',
        serie: '1',
        dataEmissao: new Date('2026-01-02T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-2.xml',
        danfsePath: null,
        ignorarNumeracaoValidacao: false,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-cancelada-2800',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000280026019687178147',
        numeroNfse: '2800',
        serie: '1',
        dataEmissao: new Date('2026-01-03T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '33333333000133',
        razaoSocialTomador: 'Tomador 3',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-2800.xml',
        danfsePath: null,
        ignorarNumeracaoValidacao: true,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      tipoRelacao: 'emitidas',
      all: true
    });

    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '06960810000176',
      totalDocumentosAnalisados: 2,
      totalNumerosValidos: 2,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    });
  });

  it('considera apenas os XMLs visiveis da listagem ao validar numeracao paginada', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(380);
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-55',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005526019687178145',
        numeroNfse: '55',
        serie: '900',
        dataEmissao: new Date('2026-01-31T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-55.xml',
        danfsePath: null,
        createdAt: new Date('2026-07-31T00:00:00.000Z'),
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-56',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005626019687178146',
        numeroNfse: '56',
        serie: '70000',
        dataEmissao: new Date('2026-01-31T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-56.xml',
        danfsePath: null,
        createdAt: new Date('2026-07-31T00:00:00.000Z'),
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-57',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005726019687178147',
        numeroNfse: '57',
        serie: '900',
        dataEmissao: new Date('2026-02-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '33333333000133',
        razaoSocialTomador: 'Tomador 3',
        xmlPath: 'nfse/producao/06960810000176/2026/02/xml/doc-57.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-58',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005826019687178148',
        numeroNfse: '58',
        serie: '70000',
        dataEmissao: new Date('2026-02-02T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '44444444000144',
        razaoSocialTomador: 'Tomador 4',
        xmlPath: 'nfse/producao/06960810000176/2026/02/xml/doc-58.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      tipoRelacao: 'emitidas',
      page: 1,
      pageSize: 100
    });

    expect(result.total).toBe(380);
    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '06960810000176',
      totalDocumentosAnalisados: 4,
      totalNumerosValidos: 4,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    });
  });

  it('ignora numeracao marcada como inutilizada na validacao das emitidas', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-82',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '421100921065205400019500900000000000000082426019600070930',
        numeroNfse: '82',
        serie: '900',
        dataEmissao: new Date('2026-07-01T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/10652054000195/2026/07/xml/doc-82.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-05T00:00:00.000Z'),
        updatedAt: new Date('2026-08-05T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-84',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '421100921065205400019500900000000000000084426019600070932',
        numeroNfse: '84',
        serie: '70000',
        dataEmissao: new Date('2026-07-02T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/10652054000195/2026/07/xml/doc-84.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-05T00:00:00.000Z'),
        updatedAt: new Date('2026-08-05T00:00:00.000Z'),
        eventos: []
      }
    ]);
    prisma.nfseNumeracaoExcecao.findMany.mockResolvedValueOnce([
      {
        ambiente: Ambiente.producao,
        numeroNfse: 83
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '10652054000195',
      tipoRelacao: 'emitidas',
      all: true
    });

    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '10652054000195',
      totalDocumentosAnalisados: 2,
      totalNumerosValidos: 2,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    });
  });

  it('lista auditoria agregada apenas para empresas com lacunas visiveis', async () => {
    prisma.cliente.findMany.mockResolvedValue([
      {
        id: 'cliente-1',
        razaoSocial: 'Empresa A',
        cnpj: '06960810000176'
      },
      {
        id: 'cliente-2',
        razaoSocial: 'Empresa B',
        cnpj: '10652054000195'
      }
    ]);
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-cliente-1-55',
        clienteId: 'cliente-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005526019687178145',
        hashXml: 'hash-55',
        serie: '900',
        numeroNfse: '55',
        dataEmissao: new Date('2026-01-31T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Empresa A',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        valorServico: new Prisma.Decimal('10'),
        xmlPath: 'nfse/a/55.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z')
      },
      {
        id: 'doc-cliente-1-57',
        clienteId: 'cliente-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000005726019687178147',
        hashXml: 'hash-57',
        serie: '70000',
        numeroNfse: '57',
        dataEmissao: new Date('2026-02-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Empresa A',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        valorServico: new Prisma.Decimal('20'),
        xmlPath: 'nfse/a/57.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z')
      },
      {
        id: 'doc-cliente-2-10',
        clienteId: 'cliente-2',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092106520540001950000000000001026021306550810',
        hashXml: 'hash-10',
        serie: '1',
        numeroNfse: '10',
        dataEmissao: new Date('2026-02-01T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Empresa B',
        cnpjTomador: '33333333000133',
        razaoSocialTomador: 'Tomador 3',
        valorServico: new Prisma.Decimal('30'),
        xmlPath: 'nfse/b/10.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z')
      },
      {
        id: 'doc-cliente-2-11',
        clienteId: 'cliente-2',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092106520540001950000000000001126021306550811',
        hashXml: 'hash-11',
        serie: '2',
        numeroNfse: '11',
        dataEmissao: new Date('2026-02-02T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Empresa B',
        cnpjTomador: '44444444000144',
        razaoSocialTomador: 'Tomador 4',
        valorServico: new Prisma.Decimal('40'),
        xmlPath: 'nfse/b/11.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z')
      },
      {
        id: 'doc-cliente-2-11-dup',
        clienteId: 'cliente-2',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092106520540001950000000000001126021306550811',
        hashXml: 'hash-11-dup',
        serie: '2',
        numeroNfse: '11',
        dataEmissao: new Date('2026-02-02T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Empresa B',
        cnpjTomador: '44444444000144',
        razaoSocialTomador: 'Tomador 4',
        valorServico: new Prisma.Decimal('40'),
        xmlPath: 'nfse/b/11-new.xml',
        danfsePath: 'nfse/b/11-new.pdf',
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z')
      }
    ]);

    const result = await service.listGapAudits();

    expect(result).toEqual([
      {
        clienteId: 'cliente-1',
        razaoSocial: 'Empresa A',
        cnpjConsulta: '06960810000176',
        totalDocumentosAnalisados: 2,
        totalNumerosValidos: 2,
        totalFaixasLacuna: 1,
        totalNumerosPulados: 1,
        lacunas: [
          {
            ambiente: Ambiente.producao,
            serie: null,
            numeroInicial: 56,
            numeroFinal: 56,
            quantidade: 1
          }
        ]
      }
    ]);
  });

  it('considera na auditoria a NFS-e vinculada ao cliente mesmo quando a custodia pertence a outro cliente', async () => {
    prisma.cliente.findMany.mockResolvedValue([
      {
        id: 'cliente-1',
        razaoSocial: 'Empresa A',
        cnpj: '06960810000176'
      }
    ]);
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-720',
        clienteId: 'cliente-origem',
        ambiente: Ambiente.producao,
        chaveAcesso: 'chave-720',
        hashXml: 'hash-720',
        serie: '900',
        numeroNfse: '720',
        dataEmissao: new Date('2026-08-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        cnpjTomador: '11111111000111',
        valorServico: new Prisma.Decimal('10'),
        xmlPath: 'nfse/a/720.xml',
        danfsePath: null,
        ignorarNumeracaoValidacao: false,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        vinculos: [{ clienteId: 'cliente-1' }]
      },
      {
        id: 'doc-721',
        clienteId: 'cliente-origem',
        ambiente: Ambiente.producao,
        chaveAcesso: 'chave-721',
        hashXml: 'hash-721',
        serie: '900',
        numeroNfse: '721',
        dataEmissao: new Date('2026-08-02T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        cnpjTomador: '22222222000122',
        valorServico: new Prisma.Decimal('20'),
        xmlPath: 'nfse/a/721.xml',
        danfsePath: null,
        ignorarNumeracaoValidacao: false,
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        vinculos: [{ clienteId: 'cliente-1' }]
      },
      {
        id: 'doc-722',
        clienteId: 'cliente-origem',
        ambiente: Ambiente.producao,
        chaveAcesso: 'chave-722',
        hashXml: 'hash-722',
        serie: '900',
        numeroNfse: '722',
        dataEmissao: new Date('2026-08-03T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        cnpjTomador: '33333333000133',
        valorServico: new Prisma.Decimal('30'),
        xmlPath: 'nfse/a/722.xml',
        danfsePath: null,
        ignorarNumeracaoValidacao: false,
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
        updatedAt: new Date('2026-08-03T00:00:00.000Z'),
        vinculos: [{ clienteId: 'cliente-1' }]
      }
    ]);

    const result = await service.listGapAudits();

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { clienteId: { in: ['cliente-1'] } },
            { vinculos: { some: { clienteId: { in: ['cliente-1'] } } } }
          ])
        })
      })
    );
    expect(result).toEqual([]);
  });

  it('valida numeracao emitida mesmo com o filtro padrao de armazenado', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(2);
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-emitida-83',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '421100921065205400019500900000000000000083426019600070931',
        numeroNfse: '83',
        serie: '900',
        dataEmissao: new Date('2026-07-01T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador 1',
        xmlPath: 'nfse/producao/10652054000195/2026/07/xml/doc-83.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-05T00:00:00.000Z'),
        updatedAt: new Date('2026-08-05T00:00:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-emitida-84',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '421100921065205400019500900000000000000084426019600070932',
        numeroNfse: '84',
        serie: '70000',
        dataEmissao: new Date('2026-07-02T00:00:00.000Z'),
        cnpjPrestador: '10652054000195',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador 2',
        xmlPath: 'nfse/producao/10652054000195/2026/07/xml/doc-84.xml',
        danfsePath: null,
        createdAt: new Date('2026-08-05T00:00:00.000Z'),
        updatedAt: new Date('2026-08-05T00:00:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '10652054000195',
      tipoRelacao: 'emitidas',
      statusArmazenamento: 'Armazenado',
      all: true
    });

    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '10652054000195',
      totalDocumentosAnalisados: 2,
      totalNumerosValidos: 2,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    });
  });

  it('mantem a validacao de numeracao geral mesmo quando a listagem e filtrada por numero', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(1);
    prisma.nfseDocumento.findMany
      .mockResolvedValueOnce([
        {
          id: 'doc-emitida-83',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: Ambiente.producao,
          chaveAcesso: '421100921065205400019500900000000000000083426019600070931',
          numeroNfse: '83',
          serie: '900',
          dataEmissao: new Date('2026-07-01T00:00:00.000Z'),
          cnpjPrestador: '10652054000195',
          razaoSocialPrestador: 'Prestador Teste',
          cnpjTomador: '11111111000111',
          razaoSocialTomador: 'Tomador 1',
          xmlPath: 'nfse/producao/10652054000195/2026/07/xml/doc-83.xml',
          danfsePath: null,
          createdAt: new Date('2026-08-05T00:00:00.000Z'),
          updatedAt: new Date('2026-08-05T00:00:00.000Z'),
          eventos: []
        }
      ])
      .mockResolvedValueOnce([
        {
          ambiente: Ambiente.producao,
          chaveAcesso: '421100921065205400019500900000000000000083426019600070931',
          hashXml: 'hash-83',
          numeroNfse: '83',
          serie: '900',
          dataEmissao: new Date('2026-07-01T00:00:00.000Z'),
          cnpjPrestador: '10652054000195',
          razaoSocialPrestador: 'Prestador Teste',
          cnpjTomador: '11111111000111',
          razaoSocialTomador: 'Tomador 1',
          valorServico: new Prisma.Decimal('145.00'),
          xmlPath: 'nfse/producao/10652054000195/2026/07/xml/doc-83.xml',
          danfsePath: null,
          createdAt: new Date('2026-08-05T00:00:00.000Z'),
          updatedAt: new Date('2026-08-05T00:00:00.000Z'),
          ignorarNumeracaoValidacao: false
        },
        {
          ambiente: Ambiente.producao,
          chaveAcesso: '421100921065205400019500900000000000000183426019600071031',
          hashXml: 'hash-183',
          numeroNfse: '183',
          serie: '900',
          dataEmissao: new Date('2026-08-01T00:00:00.000Z'),
          cnpjPrestador: '10652054000195',
          razaoSocialPrestador: 'Prestador Teste',
          cnpjTomador: '22222222000122',
          razaoSocialTomador: 'Tomador 2',
          valorServico: new Prisma.Decimal('180.00'),
          xmlPath: 'nfse/producao/10652054000195/2026/08/xml/doc-183.xml',
          danfsePath: null,
          createdAt: new Date('2026-08-05T00:00:00.000Z'),
          updatedAt: new Date('2026-08-05T00:00:00.000Z'),
          ignorarNumeracaoValidacao: false
        }
      ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '10652054000195',
      tipoRelacao: 'emitidas',
      numeroNfse: '83',
      statusArmazenamento: 'Armazenado',
      all: false,
      page: 1,
      pageSize: 100
    });

    expect(result.total).toBe(1);
    expect(result.validacaoNumeracao).toEqual({
      aplicada: true,
      cnpjPrestador: '10652054000195',
      totalDocumentosAnalisados: 2,
      totalNumerosValidos: 2,
      totalFaixasLacuna: 1,
      totalNumerosPulados: 99,
      possuiNumeracaoPulada: true,
      lacunas: [
        {
          ambiente: Ambiente.producao,
          serie: null,
          numeroInicial: 84,
          numeroFinal: 182,
          quantidade: 99
        }
      ]
    });
  });

  it('cria ou atualiza a excecao de numeracao informada', async () => {
    prisma.nfseNumeracaoExcecao.upsert.mockResolvedValue({
      id: 'exc-1',
      clienteId: 'cliente-1',
      cnpjConsulta: '10652054000195',
      ambiente: Ambiente.producao,
      numeroNfse: 83,
      tipo: NfseNumeracaoExcecaoTipo.inutilizada,
      observacao: 'Inutilizada no sistema emissor',
      createdAt: new Date('2026-08-05T14:00:00.000Z'),
      updatedAt: new Date('2026-08-05T14:00:00.000Z')
    });

    const result = await service.createNumberingException({
      clienteId: 'cliente-1',
      cnpjConsulta: '10.652.054/0001-95',
      ambiente: Ambiente.producao,
      numeroNfse: 83,
      tipo: NfseNumeracaoExcecaoTipo.inutilizada,
      observacao: 'Inutilizada no sistema emissor'
    });

    expect(prisma.nfseNumeracaoExcecao.upsert).toHaveBeenCalledWith({
      where: {
        clienteId_cnpjConsulta_ambiente_numeroNfse: {
          clienteId: 'cliente-1',
          cnpjConsulta: '10652054000195',
          ambiente: Ambiente.producao,
          numeroNfse: 83
        }
      },
      create: {
        clienteId: 'cliente-1',
        cnpjConsulta: '10652054000195',
        ambiente: Ambiente.producao,
        numeroNfse: 83,
        tipo: NfseNumeracaoExcecaoTipo.inutilizada,
        observacao: 'Inutilizada no sistema emissor'
      },
      update: {
        tipo: NfseNumeracaoExcecaoTipo.inutilizada,
        observacao: 'Inutilizada no sistema emissor'
      }
    });
    expect(result.id).toBe('exc-1');
  });

  it('atualiza a marcacao de documento desconsiderado na validacao de numeracao', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1'
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      ignorarNumeracaoValidacao: true,
      ignorarNumeracaoObservacao: 'Documento historico fora da sequencia atual.'
    });

    const result = await service.updateDocumentNumberingValidation('doc-1', {
      clienteId: 'cliente-1',
      ignorar: true,
      observacao: 'Documento historico fora da sequencia atual.'
    });

    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: {
        ignorarNumeracaoValidacao: true,
        ignorarNumeracaoObservacao: 'Documento historico fora da sequencia atual.'
      }
    });
    expect(result.ignorarNumeracaoValidacao).toBe(true);
  });

  it('colapsa duplicatas legadas por ambiente e chave_acesso na listagem ampla', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(2);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-antigo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000000126019687178145',
        numeroNfse: '104',
        serie: '1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'ALBRECHT & BORNHOLDT SAUDE LTDA',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'LABRAND SCHOOL LTDA',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/old.xml',
        danfsePath: null,
        createdAt: new Date('2026-07-31T16:23:00.000Z'),
        updatedAt: new Date('2026-07-31T16:23:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-recente',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000000126019687178145',
        numeroNfse: '104',
        serie: '1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'ALBRECHT & BORNHOLDT SAUDE LTDA',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'LABRAND SCHOOL LTDA',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/new.xml',
        danfsePath: 'nfse/producao/06960810000176/2026/06/danfse/new.pdf',
        createdAt: new Date('2026-08-03T09:31:00.000Z'),
        updatedAt: new Date('2026-08-03T09:31:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      all: true
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('doc-recente');
  });

  it('troca codigo IBGE pelo nome do municipio na listagem quando houver cadastro interno', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(1);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-codigo-municipio',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000000126019687178145',
        numeroNfse: '104',
        serie: '1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'ALBRECHT & BORNHOLDT SAUDE LTDA',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'LABRAND SCHOOL LTDA',
        municipioPrestacaoCodigo: '2304400',
        municipioPrestacaoNome: '2304400',
        xmlPath: null,
        danfsePath: null,
        createdAt: new Date('2026-08-03T09:31:00.000Z'),
        updatedAt: new Date('2026-08-03T09:31:00.000Z'),
        eventos: []
      }
    ]);
    prisma.clienteEstabelecimento.findFirst.mockResolvedValueOnce({ municipioNome: 'Fortaleza' });

    const result = await service.findAll({
      clienteId: 'cliente-1',
      all: true
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].municipioPrestacaoNome).toBe('Fortaleza');
  });

  it('enriquece a listagem com razao social do prestador a partir do XML quando o banco estiver sem esse campo', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(1);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-lista-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42042022228415329000132000000000006426071542411790',
        numeroNfse: '64',
        cnpjPrestador: '28415329000132',
        razaoSocialPrestador: null,
        cnpjTomador: '39857367000161',
        razaoSocialTomador: 'TRANSPORTES BARBIAN LTDA',
        xmlPath: 'nfse/producao/28415329000132/2026/07/xml/doc-lista-1.xml',
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
        updatedAt: new Date('2026-07-21T00:00:00.000Z'),
        eventos: []
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>64</Numero>
      <CodigoVerificacao>42042022228415329000132000000000006426071542411790</CodigoVerificacao>
      <DataEmissao>2026-07-08T21:01:32-03:00</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador><CpfCnpj><Cnpj>28415329000132</Cnpj></CpfCnpj></IdentificacaoPrestador>
        <RazaoSocial>FRIEDRICH PREPARACAO DE DOCUMENTOS LTDA</RazaoSocial>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Tomador>
            <IdentificacaoTomador><CpfCnpj><Cnpj>39857367000161</Cnpj></CpfCnpj></IdentificacaoTomador>
            <RazaoSocial>TRANSPORTES BARBIAN LTDA</RazaoSocial>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`,
        'utf8'
      )
    );

    const result = await service.findAll({
      clienteId: 'cliente-1',
      page: 1,
      pageSize: 50
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].razaoSocialPrestador).toBe('FRIEDRICH PREPARACAO DE DOCUMENTOS LTDA');
  });

  it('retorna estatisticas agregadas do dashboard por cliente', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(512).mockResolvedValueOnce(492);
    prisma.nfseDocumentoVinculo.groupBy
      .mockResolvedValueOnce([
        {
          clienteId: 'cliente-1',
          _count: {
            _all: 400
          }
        },
        {
          clienteId: 'cliente-2',
          _count: {
            _all: 112
          }
        }
      ])
      .mockResolvedValueOnce([
        {
          clienteId: 'cliente-1',
          _count: {
            _all: 390
          }
        },
        {
          clienteId: 'cliente-2',
          _count: {
            _all: 102
          }
        }
      ]);
    prisma.nfseDocumento.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await service.getDashboardStats({});

    expect(prisma.nfseDocumento.count).toHaveBeenNthCalledWith(1, { where: {} });
    expect(prisma.nfseDocumento.count).toHaveBeenNthCalledWith(2, {
      where: {
        xmlPath: {
          not: null
        }
      }
    });
    expect(prisma.nfseDocumentoVinculo.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['clienteId'],
      where: {},
      _count: {
        _all: true
      }
    });
    expect(prisma.nfseDocumentoVinculo.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['clienteId'],
      where: {
        documento: { xmlPath: { not: null } }
      },
      _count: {
        _all: true
      }
    });
    expect(prisma.nfseDocumento.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['clienteId'],
      where: { vinculos: { none: {} } },
      _count: {
        _all: true
      }
    });
    expect(prisma.nfseDocumento.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['clienteId'],
      where: { vinculos: { none: {} }, xmlPath: { not: null } },
      _count: {
        _all: true
      }
    });
    expect(result).toEqual({
      totalNfse: 512,
      storedXmls: 492,
      byClient: [
        {
          clienteId: 'cliente-1',
          totalNfse: 400,
          storedXmls: 390
        },
        {
          clienteId: 'cliente-2',
          totalNfse: 112,
          storedXmls: 102
        }
      ]
    });
  });

  it('soma vinculo e custodia orfa (sem vinculo) no total por cliente do dashboard', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
    prisma.nfseDocumentoVinculo.groupBy
      .mockResolvedValueOnce([{ clienteId: 'cliente-1', _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ clienteId: 'cliente-1', _count: { _all: 2 } }]);
    prisma.nfseDocumento.groupBy
      .mockResolvedValueOnce([{ clienteId: 'cliente-1', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ clienteId: 'cliente-1', _count: { _all: 4 } }]);

    const result = await service.getDashboardStats({});

    expect(result.byClient).toEqual([{ clienteId: 'cliente-1', totalNfse: 8, storedXmls: 6 }]);
  });

  it('retorna leitura fiscal consolidada das NFS-e filtradas', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-fiscal-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        numeroNfse: '333',
        dataEmissao: new Date('2026-06-22T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Teste',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Teste',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico de consultoria',
        xmlPath: 'nfse/producao/06960810000176/2026/06/xml/doc-fiscal-1.xml',
        createdAt: new Date('2026-06-22T00:00:00.000Z'),
        updatedAt: new Date('2026-06-22T00:00:00.000Z')
      },
      {
        id: 'doc-fiscal-2',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033426062205552017',
        numeroNfse: '334',
        dataEmissao: new Date('2026-06-22T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Sem XML',
        cnpjTomador: '22222222000122',
        razaoSocialTomador: 'Tomador Sem XML',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico sem XML',
        xmlPath: null,
        createdAt: new Date('2026-06-22T00:00:00.000Z'),
        updatedAt: new Date('2026-06-22T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42110092206960810000176000000000033326062205552016">
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <nNFSe>333</nNFSe>
    <valores>
      <vServ>180.00</vServ>
      <vLiq>162.00</vLiq>
      <vTotalRet>18.00</vTotalRet>
      <vISSQN>9.00</vISSQN>
      <vISSRet>9.00</vISSRet>
      <pAliqAplic>5.00</pAliqAplic>
      <trib>
        <tribFed>
          <vRetIRRF>3.00</vRetIRRF>
          <vRetCP>2.00</vRetCP>
          <vRetCSLL>1.50</vRetCSLL>
          <piscofins>
            <vPis>1.00</vPis>
            <vCofins>1.50</vCofins>
          </piscofins>
        </tribFed>
        <tribMun>
          <tpRetISSQN>1</tpRetISSQN>
        </tribMun>
      </trib>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    const result = await service.getLeituraFiscal({
      clienteId: 'cliente-1',
      all: true
    });

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ OR: [{ clienteId: 'cliente-1' }, { vinculos: { some: { clienteId: 'cliente-1' } } }] }])
        })
      })
    );
    expect(result.summary).toEqual({
      totalDocumentosFiltrados: 2,
      totalDocumentosLidos: 1,
      totalDocumentosComErro: 0,
      totalDocumentosSemXml: 1,
      valorServicoTotal: 180,
      valorLiquidoTotal: 162,
      valorRetidoTotal: 18,
      valorIssTotal: 9,
      valorIssRetidoRealTotal: 9,
      totalRetencoesFederais: 6.5
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'doc-fiscal-1',
      numeroNfse: '333',
      municipio: 'Mondai',
      codigoServicoPrestado: '170101 / 1701',
      valorServico: '180.00',
      valorLiquidoNfse: '162.00',
      valorTotalRetencoes: '18.00',
      valorIssRetidoReal: '9.00',
      valorIrrf: '3.00',
      valorInss: '2.00',
      valorCsll: '1.50',
      valorPis: '1.00',
      valorCofins: '1.50',
      retencaoIss: 'Retido',
      retencaoFederal: 'Retido',
      statusProcessamento: 'OK'
    });
  });

  it('resolve o codigo IBGE de local de prestacao/ISS para o nome do municipio e soma por municipio', async () => {
    const buildAbrasfXml = (municipioIncidencia: string, valorServico: string) => `<?xml version="1.0" encoding="utf-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd"><Nfse versao="1.00"><InfNfse><Numero>1</Numero><DataEmissao>2026-07-28T08:14:45-03:00</DataEmissao><ValoresNfse><BaseCalculo>${valorServico}.00</BaseCalculo><Aliquota>3.00</Aliquota><ValorIss>0.00</ValorIss><ValorLiquidoNfse>${valorServico}.00</ValorLiquidoNfse></ValoresNfse><DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico><Servico><Valores><ValorServicos>${valorServico}.00</ValorServicos><ValorIss>0.00</ValorIss></Valores><IssRetido>2</IssRetido><CodigoMunicipio>${municipioIncidencia}</CodigoMunicipio><MunicipioIncidencia>${municipioIncidencia}</MunicipioIncidencia></Servico></InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico></InfNfse></Nfse></CompNfse>`;

    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-municipio-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42134012219893422000161000000000089926070269374160',
        numeroNfse: '1',
        dataEmissao: new Date('2026-07-28T00:00:00.000Z'),
        cnpjPrestador: '19893422000161',
        razaoSocialPrestador: 'Prestador Municipio 1',
        xmlPath: 'nfse/producao/19893422000161/2026/07/xml/doc-municipio-1.xml',
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
        updatedAt: new Date('2026-07-28T00:00:00.000Z')
      },
      {
        id: 'doc-municipio-2',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42134012219893422000161000000000089926070269374161',
        numeroNfse: '2',
        dataEmissao: new Date('2026-07-28T00:00:00.000Z'),
        cnpjPrestador: '19893422000161',
        razaoSocialPrestador: 'Prestador Municipio 2',
        xmlPath: 'nfse/producao/19893422000161/2026/07/xml/doc-municipio-2.xml',
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
        updatedAt: new Date('2026-07-28T00:00:00.000Z')
      },
      {
        id: 'doc-municipio-3',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42134012219893422000161000000000089926070269374162',
        numeroNfse: '3',
        dataEmissao: new Date('2026-07-28T00:00:00.000Z'),
        cnpjPrestador: '19893422000161',
        razaoSocialPrestador: 'Prestador Municipio 3',
        xmlPath: 'nfse/producao/19893422000161/2026/07/xml/doc-municipio-3.xml',
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
        updatedAt: new Date('2026-07-28T00:00:00.000Z')
      }
    ]);
    storage.getObject
      .mockResolvedValueOnce(Buffer.from(buildAbrasfXml('4205308', '180'), 'utf8'))
      .mockResolvedValueOnce(Buffer.from(buildAbrasfXml('4213401', '220'), 'utf8'))
      .mockResolvedValueOnce(Buffer.from(buildAbrasfXml('4205308', '20'), 'utf8'));

    const result = await service.getLeituraFiscal({ clienteId: 'cliente-1', all: true });

    expect(result.items.map((item) => item.localPrestacao)).toEqual([
      'Faxinal dos Guedes/SC',
      'Ponte Serrada/SC',
      'Faxinal dos Guedes/SC'
    ]);
    expect(result.items.map((item) => item.localIncidenciaIss)).toEqual([
      'Faxinal dos Guedes/SC',
      'Ponte Serrada/SC',
      'Faxinal dos Guedes/SC'
    ]);

    expect(result.resumoPorMunicipio.localPrestacao).toEqual([
      { municipio: 'Ponte Serrada/SC', quantidadeNotas: 1, valorServicoTotal: 220, valorLiquidoTotal: 220, valorIssTotal: 0 },
      { municipio: 'Faxinal dos Guedes/SC', quantidadeNotas: 2, valorServicoTotal: 200, valorLiquidoTotal: 200, valorIssTotal: 0 }
    ]);
    expect(result.resumoPorMunicipio.localIncidenciaIss).toEqual(result.resumoPorMunicipio.localPrestacao);
  });

  it('sinaliza NFS-e cancelada na leitura fiscal', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-fiscal-cancelada',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42134012219893422000161000000000089926070269374163',
        numeroNfse: '77',
        dataEmissao: new Date('2026-07-28T00:00:00.000Z'),
        cnpjPrestador: '19893422000161',
        razaoSocialPrestador: 'Prestador Cancelado',
        cnpjTomador: '20714171000190',
        razaoSocialTomador: 'Tomador Cancelado',
        municipioPrestacaoNome: 'Faxinal dos Guedes',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico cancelado',
        status: 'cancelada',
        dataCancelamento: new Date('2026-07-29T00:00:00.000Z'),
        xmlPath: 'nfse/producao/19893422000161/2026/07/xml/doc-fiscal-cancelada.xml',
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
        updatedAt: new Date('2026-07-29T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe>
  <infNFSe>
    <numeroNFSe>77</numeroNFSe>
    <dEmi>2026-07-28</dEmi>
    <valores>
      <vServ>100.00</vServ>
      <vLiq>100.00</vLiq>
      <vTotalRet>0.00</vTotalRet>
      <vISSQN>0.00</vISSQN>
      <trib>
        <tribMun>
          <tpRetISSQN>2</tpRetISSQN>
        </tribMun>
      </trib>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    const result = await service.getLeituraFiscal({ clienteId: 'cliente-1', all: true });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'doc-fiscal-cancelada',
      cancelada: true,
      numeroNfse: '77'
    });
    expect(result.summary).toMatchObject({
      totalDocumentosFiltrados: 1,
      totalDocumentosLidos: 1,
      totalDocumentosComErro: 0,
      totalDocumentosSemXml: 0,
      valorServicoTotal: 0,
      valorLiquidoTotal: 0,
      valorRetidoTotal: 0,
      valorIssTotal: 0,
      valorIssRetidoRealTotal: 0,
      totalRetencoesFederais: 0
    });
    expect(result.resumoPorMunicipio).toEqual({
      localPrestacao: [],
      localIncidenciaIss: []
    });
  });

  it('nao soma retencoes federais em ABRASF quando o liquido reflete apenas ISS retido', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-fiscal-abrasf-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42134012219893422000161000000000089926070269374160',
        numeroNfse: '899',
        dataEmissao: new Date('2026-07-28T00:00:00.000Z'),
        cnpjPrestador: '19893422000161',
        razaoSocialPrestador: 'CUBMIX CONCRETO USINADO LTDA',
        cnpjTomador: '20714171000190',
        razaoSocialTomador: 'P2 PRE FABRICADOS LTDA',
        municipioPrestacaoNome: 'Faxinal dos Guedes',
        codigoServicoNacional: null,
        itemListaServico: '0702',
        descricaoServico: 'Usinagem de Concreto',
        xmlPath: 'nfse/producao/19893422000161/2026/07/xml/doc-fiscal-abrasf-1.xml',
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
        updatedAt: new Date('2026-07-28T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>899</Numero>
      <DataEmissao>2026-07-28T08:14:45-03:00</DataEmissao>
      <ValoresNfse>
        <BaseCalculo>10800.00</BaseCalculo>
        <Aliquota>3.00</Aliquota>
        <ValorIss>324.00</ValorIss>
        <ValorLiquidoNfse>10476.00</ValorLiquidoNfse>
      </ValoresNfse>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Servico>
            <Valores>
              <ValorServicos>10800.00</ValorServicos>
              <ValorIssRetido>324.00</ValorIssRetido>
              <ValorPis>178.20</ValorPis>
              <ValorCofins>820.80</ValorCofins>
              <OutrasRetencoes>324.00</OutrasRetencoes>
              <ValorIss>324.00</ValorIss>
            </Valores>
            <IssRetido>1</IssRetido>
            <ItemListaServico>0702</ItemListaServico>
          </Servico>
          <Prestador>
            <CpfCnpj>
              <Cnpj>19893422000161</Cnpj>
            </CpfCnpj>
          </Prestador>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj>
                <Cnpj>20714171000190</Cnpj>
              </CpfCnpj>
            </IdentificacaoTomador>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`,
        'utf8'
      )
    );

    const result = await service.getLeituraFiscal({
      clienteId: 'cliente-1',
      numeroNfse: '899',
      all: true
    });

    expect(result.summary).toMatchObject({
      totalDocumentosFiltrados: 1,
      totalDocumentosLidos: 1,
      totalRetencoesFederais: 0,
      valorRetidoTotal: 324,
      valorIssRetidoRealTotal: 324
    });
    expect(result.items[0]).toMatchObject({
      numeroNfse: '899',
      valorTotalRetencoes: '324.00',
      valorIssRetidoReal: '324.00',
      retencaoFederal: 'Normal',
      totalRetencoesFederais: '0.00'
    });
  });

  it('exporta a leitura fiscal de NFS-e no layout Dominio para entrada', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-export-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326071005552016',
        numeroNfse: '333',
        dataEmissao: new Date('2026-07-10T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Exportacao',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Exportacao',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico de consultoria',
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/doc-export-1.xml',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <DPS>
    <infDPS>
      <dhEmi>2026-07-10T00:00:00-03:00</dhEmi>
      <prest>
        <CNPJ>06960810000176</CNPJ>
        <xNome>Prestador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Chapeco</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </prest>
      <toma>
        <CNPJ>11111111000111</CNPJ>
        <xNome>Tomador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Mondai</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </toma>
      <valores>
        <vServPrest>
          <vServ>180.00</vServ>
        </vServPrest>
        <trib>
          <tribFed>
            <vRetIRRF>3.00</vRetIRRF>
            <vRetCP>2.00</vRetCP>
            <vRetCSLL>1.50</vRetCSLL>
            <piscofins>
              <vPis>1.00</vPis>
              <vCofins>1.50</vCofins>
              <tpRetPisCofins>3</tpRetPisCofins>
            </piscofins>
          </tribFed>
          <tribMun>
            <tpRetISSQN>2</tpRetISSQN>
          </tribMun>
        </trib>
      </valores>
    </infDPS>
  </DPS>
  <infNFSe Id="NFS42110092206960810000176000000000033326071005552016">
    <nNFSe>333</nNFSe>
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <valores>
      <vLiq>162.00</vLiq>
      <vTotalRet>18.00</vTotalRet>
      <vISSQN>9.00</vISSQN>
      <vISSRet>9.00</vISSRet>
      <pAliqAplic>5.00</pAliqAplic>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    const result = await service.exportarLeituraFiscalDominio({
      clienteId: 'cliente-1',
      all: true,
      codigoEmpresa: 10105,
      tipoRegistro: 'Entrada',
      contas: 'Padrao',
      produtoPadrao: 557
    });

    const content = Buffer.from(result.contentBase64, 'base64').toString('utf8');
    expect(result.fileName).toContain('DOMINIO-NFSE-ENTRADA-');
    expect(content).toContain('|0000|11111111000111|');
    expect(content).toContain('|1000|39|06960810000176||804|1933||333|U||10/07/2026|10/07/2026|180,00');
    expect(content).toContain('|1020|25||180,00|2,22|4,00');
    expect(content).toContain('|1020|16||180,00|1,67|3,00');
    expect(content).toContain('|1020|26||180,00|1,11|2,00');
    expect(content).toContain('|1020|3||180,00|5,00|9,00');
    expect(content).toContain('|1020|18||180,00|5,00|9,00');
    expect(content).toContain('|1030|557|1|180,00');
    expect(content).toContain('|1300|10/07/2026|0|183|9,00||ISS RETIDO SOBRE NFS-E N 333 Prestador Exportacao|||');
  });

  it('ignora NFS-e cancelada na exportacao da leitura fiscal para a Dominio', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-export-ativo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326071005552016',
        numeroNfse: '333',
        dataEmissao: new Date('2026-07-10T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Exportacao',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Exportacao',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico ativo',
        status: 'autorizada',
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/doc-export-ativo.xml',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z')
      },
      {
        id: 'doc-export-cancelada',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000044426071005552017',
        numeroNfse: '444',
        dataEmissao: new Date('2026-07-11T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Cancelado',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Exportacao',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico cancelado',
        status: 'cancelada',
        dataCancelamento: new Date('2026-07-12T00:00:00.000Z'),
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/doc-export-cancelada.xml',
        createdAt: new Date('2026-07-11T00:00:00.000Z'),
        updatedAt: new Date('2026-07-12T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <DPS>
    <infDPS>
      <dhEmi>2026-07-10T00:00:00-03:00</dhEmi>
      <prest>
        <CNPJ>06960810000176</CNPJ>
        <xNome>Prestador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Chapeco</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </prest>
      <toma>
        <CNPJ>11111111000111</CNPJ>
        <xNome>Tomador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Mondai</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </toma>
      <valores>
        <vServPrest>
          <vServ>180.00</vServ>
        </vServPrest>
        <trib>
          <tribMun>
            <tpRetISSQN>2</tpRetISSQN>
          </tribMun>
        </trib>
      </valores>
    </infDPS>
  </DPS>
  <infNFSe Id="NFS42110092206960810000176000000000033326071005552016">
    <nNFSe>333</nNFSe>
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <valores>
      <vLiq>171.00</vLiq>
      <vTotalRet>9.00</vTotalRet>
      <vISSQN>9.00</vISSQN>
      <vISSRet>9.00</vISSRet>
      <pAliqAplic>5.00</pAliqAplic>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    const result = await service.exportarLeituraFiscalDominio({
      clienteId: 'cliente-1',
      all: true,
      codigoEmpresa: 10105,
      tipoRegistro: 'Entrada',
      contas: 'Padrao',
      produtoPadrao: 557
    });

    const content = Buffer.from(result.contentBase64, 'base64').toString('utf8');
    expect(storage.getObject).toHaveBeenCalledTimes(1);
    expect(content).toContain('|333|');
    expect(content).not.toContain('|444|');
    expect(content).not.toContain('Prestador Cancelado');
  });

  it('aplica a conta por codigo de servico configurada mesmo com contas Padrao (independente do modo Por Fornecedor)', async () => {
    prisma.nfseContaContabilConfig.findMany.mockResolvedValueOnce([
      {
        id: 'config-1',
        clienteId: 'cliente-1',
        codigoServico: '170101',
        contaContabil: '999',
        ativo: true,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z')
      }
    ]);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-export-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326071005552016',
        numeroNfse: '333',
        dataEmissao: new Date('2026-07-10T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Exportacao',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Exportacao',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico de consultoria',
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/doc-export-1.xml',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <DPS>
    <infDPS>
      <dhEmi>2026-07-10T00:00:00-03:00</dhEmi>
      <prest>
        <CNPJ>06960810000176</CNPJ>
        <xNome>Prestador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Chapeco</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </prest>
      <toma>
        <CNPJ>11111111000111</CNPJ>
        <xNome>Tomador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Mondai</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </toma>
      <valores>
        <vServPrest>
          <vServ>180.00</vServ>
        </vServPrest>
      </valores>
    </infDPS>
  </DPS>
  <infNFSe Id="NFS42110092206960810000176000000000033326071005552016">
    <nNFSe>333</nNFSe>
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <valores>
      <vLiq>180.00</vLiq>
      <vISSQN>0.00</vISSQN>
      <pAliqAplic>0.00</pAliqAplic>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    const result = await service.exportarLeituraFiscalDominio({
      clienteId: 'cliente-1',
      all: true,
      codigoEmpresa: 10105,
      tipoRegistro: 'Entrada',
      contas: 'Padrao',
      produtoPadrao: 557
    });

    const content = Buffer.from(result.contentBase64, 'base64').toString('utf8');
    expect(prisma.nfseContaContabilConfig.findMany).toHaveBeenCalledWith({
      where: { clienteId: 'cliente-1', ativo: true }
    });
    // debito (registro 1300) vem da configuracao (999); credito continua o fornecedor padrao (506), pois contas=Padrao nao aciona a busca ODBC.
    expect(content).toContain('|1300|09/07/2026|999|506|180,00|| NFS-E N 333 Prestador Exportacao|||');
  });

  it('usa a conta padrao 467 quando nao ha configuracao para o codigo de servico da nota', async () => {
    prisma.nfseContaContabilConfig.findMany.mockResolvedValueOnce([]);
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-export-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326071005552016',
        numeroNfse: '333',
        dataEmissao: new Date('2026-07-10T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Exportacao',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Exportacao',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '999999',
        itemListaServico: '9999',
        descricaoServico: 'Servico sem configuracao',
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/doc-export-1.xml',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <DPS>
    <infDPS>
      <dhEmi>2026-07-10T00:00:00-03:00</dhEmi>
      <prest>
        <CNPJ>06960810000176</CNPJ>
        <xNome>Prestador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Chapeco</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </prest>
      <toma>
        <CNPJ>11111111000111</CNPJ>
        <xNome>Tomador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Mondai</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </toma>
      <valores>
        <vServPrest>
          <vServ>180.00</vServ>
        </vServPrest>
      </valores>
    </infDPS>
  </DPS>
  <infNFSe Id="NFS42110092206960810000176000000000033326071005552016">
    <nNFSe>333</nNFSe>
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <valores>
      <vLiq>180.00</vLiq>
      <vISSQN>0.00</vISSQN>
      <pAliqAplic>0.00</pAliqAplic>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    const result = await service.exportarLeituraFiscalDominio({
      clienteId: 'cliente-1',
      all: true,
      codigoEmpresa: 10105,
      tipoRegistro: 'Entrada',
      contas: 'Padrao',
      produtoPadrao: 557
    });

    const content = Buffer.from(result.contentBase64, 'base64').toString('utf8');
    expect(content).toContain('|1300|09/07/2026|467|506|180,00|| NFS-E N 333 Prestador Exportacao|||');
  });

  it('nao consulta contas por codigo de servico ao exportar Servico (aplicavel apenas a Entrada)', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-export-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326071005552016',
        numeroNfse: '333',
        dataEmissao: new Date('2026-07-10T00:00:00.000Z'),
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador Exportacao',
        cnpjTomador: '11111111000111',
        razaoSocialTomador: 'Tomador Exportacao',
        municipioPrestacaoNome: 'Mondai',
        codigoServicoNacional: '170101',
        itemListaServico: '1701',
        descricaoServico: 'Servico de consultoria',
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/doc-export-1.xml',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <DPS>
    <infDPS>
      <dhEmi>2026-07-10T00:00:00-03:00</dhEmi>
      <prest>
        <CNPJ>06960810000176</CNPJ>
        <xNome>Prestador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Chapeco</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </prest>
      <toma>
        <CNPJ>11111111000111</CNPJ>
        <xNome>Tomador Exportacao</xNome>
        <end>
          <endNac>
            <xMun>Mondai</xMun>
            <UF>SC</UF>
          </endNac>
        </end>
      </toma>
      <valores>
        <vServPrest>
          <vServ>180.00</vServ>
        </vServPrest>
      </valores>
    </infDPS>
  </DPS>
  <infNFSe Id="NFS42110092206960810000176000000000033326071005552016">
    <nNFSe>333</nNFSe>
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <valores>
      <vLiq>180.00</vLiq>
      <vISSQN>0.00</vISSQN>
      <pAliqAplic>0.00</pAliqAplic>
    </valores>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );

    await service.exportarLeituraFiscalDominio({
      clienteId: 'cliente-1',
      all: true,
      codigoEmpresa: 10105,
      tipoRegistro: 'Servico',
      contas: 'Padrao',
      produtoPadrao: 557
    });

    expect(prisma.nfseContaContabilConfig.findMany).not.toHaveBeenCalled();
  });

  it('rejeita exportacao por fornecedor sem configuracao ODBC da Dominio', async () => {
    await expect(
      service.exportarLeituraFiscalDominio({
        clienteId: 'cliente-1',
        all: true,
        codigoEmpresa: 10105,
        tipoRegistro: 'Entrada',
        contas: 'PorFornecedor',
        produtoPadrao: 557
      })
    ).rejects.toThrow('DOMINIO_ODBC_CONNECTION_STRING nao configurada para exportacao Por Fornecedor.');
  });

  it('rejeita busca automatica do codigo empresa Dominio quando cliente nao existe', async () => {
    prisma.cliente.findUnique.mockResolvedValueOnce(undefined);

    await expect(service.buscarCodigoEmpresaDominioPorCnpj('cliente-inexistente')).rejects.toThrow('Cliente nao encontrado.');
  });

  it('rejeita busca automatica do codigo empresa Dominio quando cliente nao tem CNPJ valido', async () => {
    prisma.cliente.findUnique.mockResolvedValueOnce({
      id: 'cliente-1',
      cnpj: ''
    });

    await expect(service.buscarCodigoEmpresaDominioPorCnpj('cliente-1')).rejects.toThrow('Cliente sem CNPJ valido cadastrado.');
  });

  it('rejeita busca automatica do codigo empresa Dominio sem configuracao ODBC', async () => {
    prisma.cliente.findUnique.mockResolvedValueOnce({
      id: 'cliente-1',
      cnpj: '06960810000176'
    });

    await expect(service.buscarCodigoEmpresaDominioPorCnpj('cliente-1')).rejects.toThrow(
      'DOMINIO_ODBC_CONNECTION_STRING nao configurada para buscar o codigo da empresa na Dominio.'
    );
  });

  it('retorna XML com metadados de download', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '42110092206960810000176000000000000126019687178145',
      xmlPath: 'nfse/producao/123/2026/05/xml/a.xml'
    });
    storage.getObject.mockResolvedValue(Buffer.from('<xml>conteudo</xml>', 'utf8'));

    const result = await service.getXml('doc-1', 'cliente-1');

    expect(result.fileName).toBe('NFSE-42110092206960810000176000000000000126019687178145.xml');
    expect(result.contentType).toBe('application/xml');
    expect(result.contentBase64).toBe(Buffer.from('<xml>conteudo</xml>', 'utf8').toString('base64'));
    expect(result.xml).toBe('<xml>conteudo</xml>');
  });

  it('gera DANFSE quando nao existir caminho salvo', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-2',
      clienteId: 'cliente-1',
      chaveAcesso: '42110092206960810000176000000000000226015757529368',
      ambiente: Ambiente.producao,
      danfsePath: null,
      xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-2.xml',
      numeroNfse: '2',
      dataEmissao: new Date('2026-01-05T00:00:00.000Z'),
      status: 'autorizada',
      cnpjPrestador: '06960810000176',
      razaoSocialPrestador: 'Prestador Teste',
      cnpjTomador: '12345678000199',
      razaoSocialTomador: 'Tomador Teste',
      valorServico: {
        toString: () => '100.00'
      },
      descricaoServico: 'Servico de teste',
      createdAt: new Date('2026-01-05T00:00:00.000Z')
    });

    storage.getObject.mockResolvedValue(Buffer.from('<NFSe><nNFSe>2</nNFSe></NFSe>', 'utf8'));
    storage.putObject.mockResolvedValue('/tmp/danfse.pdf');
    prisma.nfseDocumento.update.mockResolvedValue({});

    const result = await service.getDanfse('doc-2', 'cliente-1');

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/danfse/42110092206960810000176000000000000226015757529368.pdf'),
      expect.any(Buffer)
    );
    expect(prisma.nfseDocumento.update).toHaveBeenCalledTimes(1);
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentBase64.length).toBeGreaterThan(20);
  });

  it('usa o municipio do cadastro interno quando o XML do tomador traz apenas o codigo', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-municipio-tomador',
      clienteId: 'cliente-1',
      chaveAcesso: '35150041228505239000132000000000059126035377498902',
      ambiente: Ambiente.producao,
      danfsePath: null,
      xmlPath: 'nfse/producao/28505239000132/2026/03/xml/doc-municipio-tomador.xml',
      numeroNfse: '591',
      dataEmissao: new Date('2026-03-14T03:00:00.000Z'),
      status: 'autorizada',
      cnpjPrestador: '28505239000132',
      razaoSocialPrestador: 'LE B WEBS BORRACHARIA LTDA',
      cnpjTomador: '14044789000197',
      razaoSocialTomador: '2 K TRANSPORTES LTDA',
      municipioPrestacaoCodigo: '3515004',
      municipioPrestacaoNome: 'Embu Das Artes',
      valorServico: {
        toString: () => '1500.00'
      },
      descricaoServico: 'Prestacao de servicos de borracharia',
      createdAt: new Date('2026-03-14T03:00:00.000Z')
    });
    prisma.clienteEstabelecimento.findFirst
      .mockResolvedValueOnce({ municipioNome: 'Embu Das Artes' })
      .mockResolvedValueOnce({ municipioNome: 'Mondai' });

    storage.getObject.mockResolvedValue(
      Buffer.from(
        '<NFSe><nNFSe>591</nNFSe><Tomador><Endereco><CodigoMunicipio>4211009</CodigoMunicipio></Endereco></Tomador></NFSe>',
        'utf8'
      )
    );
    storage.putObject.mockResolvedValue('/tmp/danfse-municipio.pdf');
    prisma.nfseDocumento.update.mockResolvedValue({});

    const result = await service.getDanfse('doc-municipio-tomador', 'cliente-1');
    const content = Buffer.from(result.contentBase64, 'base64').toString('latin1');

    expect(content).toContain('Mondai');
    expect(content).toContain('Embu Das Artes');
  });

  it('reprocessa XML salvo e atualiza campos fiscais', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-3',
        chaveAcesso: '42167012244454248000106000000000002924081114719252',
        ambiente: Ambiente.producao,
        xmlPath: 'nfse/producao/06960810000176/2024/08/xml/doc-3.xml',
        danfsePath: null,
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        numeroNfse: null,
        serie: null,
        dataEmissao: null,
        competencia: null,
        status: null,
        cnpjPrestador: null,
        razaoSocialPrestador: null,
        cnpjTomador: null,
        razaoSocialTomador: null,
        municipioPrestacaoCodigo: null,
        municipioPrestacaoNome: null,
        valorServico: null,
        valorDeducoes: null,
        valorIss: null,
        aliquotaIss: null,
        codigoServicoNacional: null,
        itemListaServico: null,
        descricaoServico: null,
        hashXml: null,
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
        updatedAt: new Date('2026-01-05T00:00:00.000Z')
      }
    ]);

    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42167012244454248000106000000000002924081114719252">
    <nNFSe>29</nNFSe>
    <cStat>100</cStat>
    <emit><CNPJ>44454248000106</CNPJ><xNome>Prestador</xNome></emit>
    <DPS><infDPS><serie>900</serie><dhEmi>2024-08-01T11:08:50-03:00</dhEmi><dCompet>2024-08-01</dCompet><toma><CNPJ>06960810000176</CNPJ><xNome>Tomador</xNome></toma><serv><locPrest><cLocPrestacao>4211009</cLocPrestacao></locPrest><cServ><cTribNac>170101</cTribNac><xDescServ>consultoria</xDescServ></cServ></serv><valores><vServPrest><vServ>1720.00</vServ></vServPrest></valores></infDPS></DPS>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );
    storage.putObject.mockResolvedValue('/tmp/danfse.pdf');
    prisma.nfseDocumento.update.mockResolvedValue({});

    const result = await service.reprocessarXmls({
      clienteId: 'cliente-1',
      somenteIncompletos: false,
      regenerarDanfse: true,
      limit: 50
    });

    expect(result.totalSelecionados).toBe(1);
    expect(result.atualizados).toBe(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/danfse/42167012244454248000106000000000002924081114719252.pdf'),
      expect.any(Buffer)
    );
    expect(prisma.nfseDocumento.update).toHaveBeenCalledTimes(1);
  });

  it('regenera DANFSE legado mesmo quando ja existe caminho salvo', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-4',
      clienteId: 'cliente-1',
      chaveAcesso: '42110092206960810000176000000000000426016992784181',
      ambiente: Ambiente.producao,
      danfsePath: 'nfse/producao/06960810000176/2026/01/danfse/42110092206960810000176000000000000426016992784181.pdf',
      xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-4.xml',
      numeroNfse: '4',
      dataEmissao: new Date('2026-01-08T00:00:00.000Z'),
      status: 'autorizada',
      cnpjPrestador: '06960810000176',
      razaoSocialPrestador: 'Prestador Teste',
      cnpjTomador: '12345678000199',
      razaoSocialTomador: 'Tomador Teste',
      valorServico: {
        toString: () => '100.00'
      },
      descricaoServico: 'Servico de teste',
      createdAt: new Date('2026-01-08T00:00:00.000Z')
    });

    storage.getObject
      .mockResolvedValueOnce(Buffer.from('<NFSe><nNFSe>4</nNFSe></NFSe>', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('%PDF-1.4\n(arquivo legado sem marcador novo)', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('<NFSe><nNFSe>4</nNFSe></NFSe>', 'utf8'));
    storage.putObject.mockResolvedValue('/tmp/danfse-regenerado.pdf');

    const result = await service.getDanfse('doc-4', 'cliente-1');

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/danfse/42110092206960810000176000000000000426016992784181.pdf'),
      expect.any(Buffer)
    );
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentBase64.length).toBeGreaterThan(20);
  });

  it('regenera DANFSE cancelada mesmo quando ja existe PDF salvo', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-4-cancelada',
      clienteId: 'cliente-1',
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      ambiente: Ambiente.producao,
      danfsePath: 'nfse/producao/06960810000176/2026/06/danfse/42110092206960810000176000000000033326062205552016.pdf',
      xmlPath: 'nfse/producao/06960810000176/2026/06/xml/doc-4-cancelada.xml',
      numeroNfse: '333',
      dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
      status: 'cancelada',
      dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
      eventos: [
        {
          tipoEvento: 'e101101',
          descricao: 'Cancelamento de NFS-e',
          dataEvento: new Date('2026-06-03T18:43:08.000Z')
        }
      ],
      cnpjPrestador: '06960810000176',
      razaoSocialPrestador: 'Prestador Teste',
      cnpjTomador: '12345678000199',
      razaoSocialTomador: 'Tomador Teste',
      valorServico: {
        toString: () => '100.00'
      },
      descricaoServico: 'Servico cancelado',
      createdAt: new Date('2026-06-03T12:00:00.000Z')
    });

    storage.getObject.mockResolvedValue(Buffer.from('<NFSe><nNFSe>333</nNFSe></NFSe>', 'utf8'));
    storage.putObject.mockResolvedValue('/tmp/danfse-cancelada.pdf');

    const result = await service.getDanfse('doc-4-cancelada', 'cliente-1');

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/danfse/42110092206960810000176000000000033326062205552016.pdf'),
      expect.any(Buffer)
    );
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentBase64.length).toBeGreaterThan(20);
  });

  it('reprocessa DANFSEs legadas e ignora PDFs ja no modelo novo', async () => {
    const legacyDoc = {
      id: '10000000-0000-4000-8000-000000000001',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      chaveAcesso: '42110092206960810000176000000000000726016992784184',
      ambiente: Ambiente.producao,
      danfsePath: 'nfse/legado/danfse-antigo.pdf',
      xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-7.xml',
      numeroNfse: '7',
      dataEmissao: new Date('2026-01-09T00:00:00.000Z'),
      status: 'autorizada',
      cnpjPrestador: '06960810000176',
      razaoSocialPrestador: 'Prestador Teste',
      cnpjTomador: '12345678000199',
      razaoSocialTomador: 'Tomador Teste',
      valorServico: {
        toString: () => '100.00'
      },
      descricaoServico: 'Servico de teste',
      createdAt: new Date('2026-01-09T00:00:00.000Z'),
      updatedAt: new Date('2026-01-09T00:00:00.000Z')
    };
    const currentDoc = {
      ...legacyDoc,
      id: '10000000-0000-4000-8000-000000000002',
      chaveAcesso: '42110092206960810000176000000000000826016992784185',
      danfsePath:
        'nfse/producao/06960810000176/2026/01/danfse/42110092206960810000176000000000000826016992784185.pdf',
      xmlPath: 'nfse/producao/06960810000176/2026/01/xml/doc-8.xml',
      numeroNfse: '8'
    };

    prisma.nfseDocumento.findMany.mockResolvedValueOnce([legacyDoc, currentDoc]).mockResolvedValueOnce([]);
    storage.getObject
      .mockResolvedValueOnce(Buffer.from('%PDF-1.4\narquivo legado', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('<NFSe><nNFSe>7</nNFSe></NFSe>', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('%PDF-1.4\nDANFSE - pagina 1', 'utf8'));
    storage.putObject.mockResolvedValue('/tmp/danfse-regenerado.pdf');
    prisma.nfseDocumento.update.mockResolvedValue({});

    const result = await service.reprocessarDanfses({
      somenteLegadas: true,
      lote: 2
    });

    expect(result).toMatchObject({
      processados: 2,
      regeneradas: 1,
      ignoradas: 1,
      falhas: 0
    });
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/danfse/42110092206960810000176000000000000726016992784184.pdf'),
      expect.any(Buffer)
    );
    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith({
      where: { id: legacyDoc.id },
      data: {
        danfsePath:
          'nfse/producao/06960810000176/2026/01/danfse/42110092206960810000176000000000000726016992784184.pdf'
      }
    });
  });

  it('importa XML de NFS-e com nsu nulo para nao colidir com defaults legados do banco', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse>
    <InfNfse>
      <Numero>267</Numero>
      <CodigoVerificacao>42110092206960810000176000000000026726041826944060</CodigoVerificacao>
      <DataEmissao>2026-04-29T16:00:58-03:00</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <CpfCnpj>
            <Cnpj>06960810000176</Cnpj>
          </CpfCnpj>
        </IdentificacaoPrestador>
        <RazaoSocial>GCONT GESTAO CONTABIL E EMPRESARIAL LTDA</RazaoSocial>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Competencia>2026-04-29T00:00:00</Competencia>
          <Servico>
            <Valores>
              <ValorServicos>8890.00</ValorServicos>
            </Valores>
            <ItemListaServico>1719</ItemListaServico>
            <Discriminacao>HONORARIOS</Discriminacao>
          </Servico>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj>
                <Cnpj>20714171000190</Cnpj>
              </CpfCnpj>
            </IdentificacaoTomador>
            <RazaoSocial>P2 PRE FABRICADOS LTDA</RazaoSocial>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    prisma.nfseDocumento.findUnique.mockResolvedValue(null);
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    prisma.nfseDocumento.create.mockResolvedValue({
      id: 'doc-267',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao,
      nsu: null,
      chaveAcesso: '42110092206960810000176000000000026726041826944060',
      numeroNfse: '267',
      origem: 'importacao_xml',
      xmlPath: 'nfse/producao/06960810000176/2026/04/xml/42110092206960810000176000000000026726041826944060.xml',
      danfsePath: 'nfse/producao/06960810000176/2026/04/danfse/42110092206960810000176000000000026726041826944060.pdf'
    });
    storage.putObject.mockResolvedValue('/tmp/nfse-file');

    const result = await service.importXml({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      xml,
      ambiente: 'producao'
    });

    expect(prisma.nfseDocumento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ambiente: Ambiente.producao,
          nsu: null,
          chaveAcesso: '42110092206960810000176000000000026726041826944060',
          numeroNfse: '267'
        })
      })
    );
    expect(result).toMatchObject({
      id: 'doc-267',
      chaveAcesso: '42110092206960810000176000000000026726041826944060',
      tipo: 'nfse'
    });
  });

  it('importa XML de evento de cancelamento e vincula a NFS-e relacionada', async () => {
    const eventXml = `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento Id="EVT42110092206960810000176000000000033326062205552016101101001">
    <dhProc>2026-06-03T15:43:08-03:00</dhProc>
    <pedRegEvento versao="1.01">
      <infPedReg Id="PRE42110092206960810000176000000000033326062205552016101101">
        <dhEvento>2026-06-03T15:43:08-03:00</dhEvento>
        <CNPJAutor>06960810000176</CNPJAutor>
        <chNFSe>42110092206960810000176000000000033326062205552016</chNFSe>
        <e101101>
          <xDesc>Cancelamento de NFS-e</xDesc>
          <xMotivo>erro de digitacao</xMotivo>
        </e101101>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`;

    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-placeholder',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        cnpjPrestador: null,
        cnpjTomador: null,
        xmlPath: null,
        numeroNfse: null,
        dataEmissao: null,
        createdAt: new Date('2026-06-03T18:43:09.000Z'),
        updatedAt: new Date('2026-06-03T18:43:09.000Z')
      },
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
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-original',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao_restrita,
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      origem: 'importacao_xml',
      xmlPath: 'nfse/producao_restrita/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
      danfsePath: null,
      cnpjPrestador: '06960810000176',
      cnpjTomador: null
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-original',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao_restrita,
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      origem: 'importacao_xml',
      status: 'cancelada',
      dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
      xmlPath: 'nfse/producao_restrita/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
      danfsePath: null,
      cnpjPrestador: '06960810000176',
      cnpjTomador: null
    });
    prisma.nfseEvento.upsert.mockResolvedValue({
      id: 'evento-1',
      tipoEvento: 'e101101',
      xmlPath: 'nfse/producao_restrita/06960810000176/2026/06/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'
    });

    const result = await service.importXml({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      xml: eventXml,
      ambiente: 'producao'
    });

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining(
        'nfse/producao_restrita/06960810000176/2026/06/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'
      ),
      eventXml
    );
    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-original' },
        data: expect.objectContaining({
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          nsu: null,
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
    expect(result).toMatchObject({
      id: 'doc-original',
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      tipo: 'evento',
      eventoId: 'evento-1',
      tipoEvento: 'e101101',
      status: 'cancelada'
    });
  });

  it('recupera NFS-e faltante por chave usando a API oficial do Emissor Publico', async () => {
    prisma.clienteEstabelecimento.findFirst.mockImplementation(({ where }) => {
      if (where?.clienteId === 'cliente-1' && where?.cnpj === '06960810000176') {
        return Promise.resolve({
          id: 'estab-1',
          cnpj: '06960810000176'
        });
      }

      return Promise.resolve(undefined);
    });
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    prisma.nfseDocumento.findUnique.mockResolvedValue(null);
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    prisma.nfseDocumento.create.mockResolvedValue({
      id: 'doc-rec-1',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao,
      nsu: null,
      chaveAcesso: '42110092206960810000176000000000064126070112345678',
      numeroNfse: '641',
      origem: 'importacao_xml',
      xmlPath: 'nfse/producao/06960810000176/2026/07/xml/42110092206960810000176000000000064126070112345678.xml',
      danfsePath: 'nfse/producao/06960810000176/2026/07/danfse/42110092206960810000176000000000064126070112345678.pdf'
    });
    storage.putObject.mockResolvedValue('/tmp/nfse-file');
    emissorPublicoClient.getNfseByChave.mockResolvedValue({
      statusCode: 200,
      chaveAcesso: '42110092206960810000176000000000064126070112345678',
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<NFSe>
  <infNFSe>
    <chaveAcesso>42110092206960810000176000000000064126070112345678</chaveAcesso>
    <numeroNFSe>641</numeroNFSe>
    <serie>70000</serie>
    <tpAmb>1</tpAmb>
    <dataEmissao>2026-07-10T10:31:00-03:00</dataEmissao>
    <prestador><cnpj>06960810000176</cnpj><razaoSocial>CLINILAB LABORATORIO DE ANALISES CLINICAS LTDA</razaoSocial></prestador>
    <tomador><cnpj>11111111000111</cnpj><razaoSocial>TOMADOR TESTE</razaoSocial></tomador>
    <valorServico>405.00</valorServico>
  </infNFSe>
</NFSe>`
    });

    const result = await service.recuperarPorChave({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      ambiente: 'producao',
      chavesAcesso: ['https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=42110092206960810000176000000000064126070112345678']
    });

    expect(emissorPublicoClient.getNfseByChave).toHaveBeenCalledWith({
      chaveAcesso: '42110092206960810000176000000000064126070112345678',
      ambiente: 'producao',
      certificateId: 'cert-1'
    });
    expect(result).toMatchObject({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '06960810000176',
      ambiente: 'producao',
      requestedKeys: 1,
      processedKeys: 1,
      documentsRecovered: 1,
      failures: 0
    });
    expect(result.detalhes).toEqual([
      expect.objectContaining({
        chaveAcesso: '42110092206960810000176000000000064126070112345678',
        status: 'recuperada',
        documentoId: 'doc-rec-1'
      })
    ]);
  });

  it('retorna falha legivel quando a recuperacao por chave nao devolve XML', async () => {
    prisma.clienteEstabelecimento.findFirst.mockImplementation(({ where }) => {
      if (where?.clienteId === 'cliente-1' && where?.cnpj === '06960810000176') {
        return Promise.resolve({
          id: 'estab-1',
          cnpj: '06960810000176'
        });
      }

      return Promise.resolve(undefined);
    });
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    emissorPublicoClient.getNfseByChave.mockResolvedValue({
      statusCode: 404,
      chaveAcesso: '42110092206960810000176000000000068826070112345679',
      rawResponse: { error: 'nao localizada' },
      message: 'NFS-e nao localizada no Emissor Publico.'
    });

    const result = await service.recuperarPorChave({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      ambiente: 'producao',
      chavesAcesso: ['42110092206960810000176000000000068826070112345679']
    });

    expect(result).toMatchObject({
      requestedKeys: 1,
      processedKeys: 1,
      documentsRecovered: 0,
      failures: 1
    });
    expect(result.detalhes).toEqual([
      {
        chaveAcesso: '42110092206960810000176000000000068826070112345679',
        status: 'falha',
        mensagem: 'NFS-e nao localizada no Emissor Publico.'
      }
    ]);
  });

  it('recupera NFS-e faltante a partir do Id inferido da DPS', async () => {
    prisma.clienteEstabelecimento.findFirst.mockImplementation(({ where }) => {
      if (where?.clienteId === 'cliente-1' && where?.cnpj === '10652054000195') {
        return Promise.resolve({
          id: 'estab-1',
          cnpj: '10652054000195',
          municipioCodigoIbge: '4211009'
        });
      }

      return Promise.resolve(undefined);
    });
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        ambiente: Ambiente.producao,
        serie: '900',
        numeroNfse: '84',
        chaveAcesso: '4211009221065205400019500000000008426070112345678',
        cnpjPrestador: '10652054000195',
        municipioPrestacaoCodigo: '4211009',
        xmlPath: 'nfse/producao/10652054000195/2026/07/xml/4211009221065205400019500000000008426070112345678.xml'
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<NFSe>
  <infNFSe Id="NFS4211009221065205400019500000000008426070112345678">
    <chaveAcesso>4211009221065205400019500000000008426070112345678</chaveAcesso>
    <nNFSe>84</nNFSe>
    <DPS>
      <infDPS Id="DPS421100921065205400019500900000000000001084">
        <serie>900</serie>
        <nDPS>1084</nDPS>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );
    emissorPublicoClient.getNfseByDpsId.mockResolvedValue({
      statusCode: 200,
      dpsId: 'DPS421100921065205400019500900000000000001083',
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<NFSe>
  <infNFSe>
    <chaveAcesso>4211009221065205400019500000000008326070112345679</chaveAcesso>
    <numeroNFSe>83</numeroNFSe>
    <serie>900</serie>
    <tpAmb>1</tpAmb>
    <dataEmissao>2026-07-10T10:31:00-03:00</dataEmissao>
    <prestador><cnpj>10652054000195</cnpj><razaoSocial>CLINILAB LABORATORIO DE ANALISES CLINICAS LTDA</razaoSocial></prestador>
    <tomador><cnpj>11111111000111</cnpj><razaoSocial>TOMADOR TESTE</razaoSocial></tomador>
    <valorServico>405.00</valorServico>
  </infNFSe>
</NFSe>`,
      rawResponse: { ok: true }
    });

    const result = await service.recuperarPorDps({
      clienteId: 'cliente-1',
      cnpjConsulta: '10652054000195',
      ambiente: 'producao',
      lacunas: [
        {
          ambiente: 'producao',
          serie: '900',
          numeroInicial: 83,
          numeroFinal: 83
        }
      ]
    });

    expect(emissorPublicoClient.getNfseByDpsId).toHaveBeenCalledWith({
      dpsId: 'DPS421100921065205400019500900000000000001083',
      ambiente: 'producao',
      certificateId: 'cert-1'
    });
    expect(result).toMatchObject({
      requestedDps: 1,
      processedDps: 1,
      documentsRecovered: 1,
      failures: 0
    });
    expect(result.detalhes).toEqual([
      expect.objectContaining({
        numeroDps: '83',
        dpsId: 'DPS421100921065205400019500900000000000001083',
        chaveAcesso: '4211009221065205400019500000000008326070112345679',
        status: 'recuperada'
      })
    ]);
  });

  it('retorna falha clara quando nao ha notas vizinhas para inferir o Id da DPS', async () => {
    prisma.clienteEstabelecimento.findFirst.mockImplementation(({ where }) => {
      if (where?.clienteId === 'cliente-1' && where?.cnpj === '06960810000176') {
        return Promise.resolve({
          id: 'estab-1',
          cnpj: '06960810000176',
          municipioCodigoIbge: '4211009'
        });
      }

      return Promise.resolve(undefined);
    });
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    prisma.nfseDocumento.findMany.mockResolvedValue([]);

    const result = await service.recuperarPorDps({
      clienteId: 'cliente-1',
      cnpjConsulta: '06960810000176',
      ambiente: 'producao',
      lacunas: [
        {
          ambiente: 'producao',
          serie: '70000',
          numeroInicial: 83,
          numeroFinal: 83
        }
      ]
    });

    expect(emissorPublicoClient.getNfseByDpsId).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requestedDps: 1,
      processedDps: 1,
      documentsRecovered: 0,
      failures: 1
    });
    expect(result.detalhes).toEqual([
      expect.objectContaining({
        numeroDps: '83',
        status: 'falha',
        mensagem: expect.stringContaining('Nenhuma NFS-e vizinha')
      })
    ]);
  });

  it('sincroniza eventos de NFS-e salvas consultando o ADN por chave', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-evt-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000033326062205552016',
        dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
        createdAt: new Date('2026-06-03T12:00:00.000Z')
      }
    ]);
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    adnClient.getEventosByChave.mockResolvedValue({
      statusCode: 200,
      data: {
        eventos: [
          {
            xml: `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento Id="EVT42110092206960810000176000000000033326062205552016101101001">
    <dhProc>2026-06-03T15:43:08-03:00</dhProc>
    <pedRegEvento versao="1.01">
      <infPedReg Id="PRE42110092206960810000176000000000033326062205552016101101">
        <dhEvento>2026-06-03T15:43:08-03:00</dhEvento>
        <CNPJAutor>06960810000176</CNPJAutor>
        <chNFSe>42110092206960810000176000000000033326062205552016</chNFSe>
        <e101101>
          <xDesc>Cancelamento de NFS-e</xDesc>
        </e101101>
      </infPedReg>
    </pedRegEvento>
  </infEvento>
</evento>`
          }
        ]
      }
    });
    const importSpy = jest.spyOn(service, 'importXml').mockResolvedValue({
      id: 'doc-evt-1',
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      tipo: 'evento',
      eventoId: 'evento-1',
      tipoEvento: 'e101101',
      status: 'cancelada'
    } as never);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      limit: 10
    });

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clienteId: 'cliente-1',
          eventos: { none: {} }
        }),
        take: 10
      })
    );
    expect(adnClient.getEventosByChave).toHaveBeenCalledWith({
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      ambiente: 'producao',
      certificateId: 'cert-1'
    });
    expect(importSpy).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: 'producao',
      xml: expect.stringContaining('<evento versao="1.01"')
    });
    expect(result).toEqual({
      documentosAnalisados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 1,
      eventosImportados: 1,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-evt-1',
          chaveAcesso: '42110092206960810000176000000000033326062205552016',
          estabelecimentoId: 'estab-1',
          ambiente: 'producao',
          status: 'sincronizado',
          eventosEncontrados: 1,
          eventosImportados: 1,
          mensagem: undefined
        }
      ]
    });
    importSpy.mockRestore();
  });

  it('sincroniza evento estruturado em JSON e persiste cancelamento da NFS-e', async () => {
    prisma.nfseDocumento.findMany
      .mockResolvedValueOnce([
        {
          id: 'doc-evt-json-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: Ambiente.producao,
          chaveAcesso: '42110092206960810000176000000000033326062205552016',
          dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
          createdAt: new Date('2026-06-03T12:00:00.000Z')
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'doc-original-json',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: Ambiente.producao,
          chaveAcesso: '42110092206960810000176000000000033326062205552016',
          cnpjPrestador: '06960810000176',
          cnpjTomador: null,
          xmlPath: 'nfse/producao/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
          numeroNfse: '333',
          dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
          createdAt: new Date('2026-06-03T12:00:00.000Z'),
          updatedAt: new Date('2026-06-03T12:00:00.000Z')
        }
      ]);
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    adnClient.getEventosByChave.mockResolvedValue({
      statusCode: 200,
      data: {
        eventos: [
          {
            chNFSe: '42110092206960810000176000000000033326062205552016',
            tpEvento: '101101',
            dhEvento: '2026-06-03T15:43:08-03:00',
            CNPJAutor: '06960810000176',
            xDesc: 'Cancelamento de NFS-e',
            xMotivo: 'erro de digitacao'
          }
        ]
      }
    });
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-original-json',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao,
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      origem: 'importacao_xml',
      xmlPath: 'nfse/producao/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
      danfsePath: null,
      cnpjPrestador: '06960810000176',
      cnpjTomador: null
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-original-json',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao,
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      origem: 'importacao_xml',
      status: 'cancelada',
      dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
      xmlPath: 'nfse/producao/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
      danfsePath: null,
      cnpjPrestador: '06960810000176',
      cnpjTomador: null
    });
    prisma.nfseEvento.upsert.mockResolvedValue({
      id: 'evento-json-1',
      tipoEvento: 'e101101',
      xmlPath: 'nfse/producao/06960810000176/2026/06/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      limit: 10
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining(
        'nfse/producao/06960810000176/2026/06/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'
      ),
      expect.stringContaining('<e101101><xDesc>Cancelamento de NFS-e - erro de digitacao</xDesc><xMotivo>erro de digitacao</xMotivo></e101101>')
    );
    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-original-json' },
        data: expect.objectContaining({
          status: 'cancelada',
          dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
          danfsePath: null
        })
      })
    );
    expect(result).toEqual({
      documentosAnalisados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 1,
      eventosImportados: 1,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-evt-json-1',
          chaveAcesso: '42110092206960810000176000000000033326062205552016',
          estabelecimentoId: 'estab-1',
          ambiente: 'producao',
          status: 'sincronizado',
          eventosEncontrados: 1,
          eventosImportados: 1,
          mensagem: undefined
        }
      ]
    });
  });

  it('reporta falha de certificado ao sincronizar eventos quando nao ha certificado valido', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-evt-2',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao_restrita,
        chaveAcesso: '42110092206960810000176000000000044426062205552016',
        dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
        createdAt: new Date('2026-06-03T12:00:00.000Z')
      }
    ]);
    prisma.certificado.findFirst.mockResolvedValue(null);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1'
    });

    expect(adnClient.getEventosByChave).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentosAnalisados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 1,
      detalhes: [
        {
          documentoId: 'doc-evt-2',
          chaveAcesso: '42110092206960810000176000000000044426062205552016',
          estabelecimentoId: 'estab-1',
          ambiente: 'producao_restrita',
          status: 'falha_certificado',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: 'Nenhum certificado ativo para o estabelecimento'
        }
      ]
    });
  });

  it('trata retorno E2240 sem documentos no ADN como sem eventos', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-evt-404',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao,
        chaveAcesso: '42110092206960810000176000000000077726062205552016',
        status: 'cancelada',
        dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
        dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
        createdAt: new Date('2026-06-03T12:00:00.000Z')
      }
    ]);
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    adnClient.getEventosByChave.mockResolvedValue({
      statusCode: 404,
      rawBody:
        '{"StatusProcessamento":"NENHUM_DOCUMENTO_LOCALIZADO","LoteDFe":[],"Alertas":[],"Erros":[{"Mensagem":{},"Codigo":"E2240","Descricao":"Nenhum documento localizado -não existem documentos fiscais para a chave de acesso informada."}],"TipoAmbiente":"HOMOLOGACAO","VersaoAplicativo":"1.0.0.0","DataHoraProcessamento":"2026-08-04T11:45:41.1146376-03:00"}',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': 'req-404'
      },
      data: {
        StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO',
        LoteDFe: [],
        Alertas: [],
        Erros: [
          {
            Mensagem: {},
            Codigo: 'E2240',
            Descricao: 'Nenhum documento localizado -não existem documentos fiscais para a chave de acesso informada.'
          }
        ],
        TipoAmbiente: 'HOMOLOGACAO',
        VersaoAplicativo: '1.0.0.0',
        DataHoraProcessamento: '2026-08-04T11:45:41.1146376-03:00'
      }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      limit: 1
    });

    expect(result).toEqual({
      documentosAnalisados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-evt-404',
          chaveAcesso: '42110092206960810000176000000000077726062205552016',
          estabelecimentoId: 'estab-1',
          ambiente: 'producao',
          status: 'sem_eventos',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: 'Nenhum evento encontrado no ADN'
        }
      ]
    });
  });

  it('corrige o ambiente do documento antes da consulta de eventos com base no tpAmb do XML salvo', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-evt-amb-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: Ambiente.producao_restrita,
        chaveAcesso: '42110092227260384000138000000000005726070184044075',
        xmlPath: 'nfse/producao_restrita/27260384000138/2026/07/xml/42110092227260384000138000000000005726070184044075.xml',
        dataEmissao: new Date('2026-07-20T20:21:44.000Z'),
        createdAt: new Date('2026-07-20T20:21:44.000Z')
      }
    ]);
    storage.getObject.mockResolvedValueOnce(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42110092227260384000138000000000005726070184044075">
    <nNFSe>57</nNFSe>
    <DPS><infDPS><tpAmb>1</tpAmb></infDPS></DPS>
  </infNFSe>
</NFSe>`,
        'utf8'
      )
    );
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-evt-amb-1',
      ambiente: Ambiente.producao
    });
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    adnClient.getEventosByChave.mockResolvedValue({
      statusCode: 200,
      data: {
        eventos: []
      }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      limit: 1
    });

    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith({
      where: { id: 'doc-evt-amb-1' },
      data: {
        ambiente: Ambiente.producao
      }
    });
    expect(adnClient.getEventosByChave).toHaveBeenCalledWith({
      chaveAcesso: '42110092227260384000138000000000005726070184044075',
      ambiente: 'producao',
      certificateId: 'cert-1'
    });
    expect(result.detalhes[0]).toMatchObject({
      ambiente: 'producao',
      status: 'sem_eventos'
    });
  });

  it('continua sincronizacao manual de eventos quando a tabela nfse_eventos nao existe', async () => {
    prisma.nfseDocumento.findMany
      .mockRejectedValueOnce(new Error('The table `public.nfse_eventos` does not exist in the current database.'))
      .mockResolvedValueOnce([
        {
          id: 'doc-evt-3',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: Ambiente.producao,
          chaveAcesso: '42110092206960810000176000000000055526062205552016',
          dataEmissao: new Date('2026-06-03T12:00:00.000Z'),
          createdAt: new Date('2026-06-03T12:00:00.000Z')
        }
      ]);
    prisma.certificado.findFirst.mockResolvedValue({
      id: 'cert-1',
      validadeFim: new Date('2099-01-01T00:00:00.000Z')
    });
    adnClient.getEventosByChave.mockResolvedValue({
      statusCode: 200,
      data: {
        eventos: []
      }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      somenteSemEventos: true,
      limit: 1
    });

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledTimes(2);
    expect(adnClient.getEventosByChave).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      documentosAnalisados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-evt-3',
          chaveAcesso: '42110092206960810000176000000000055526062205552016',
          estabelecimentoId: 'estab-1',
          ambiente: 'producao',
          status: 'sem_eventos',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: 'Nenhum evento encontrado no ADN'
        }
      ]
    });
  });

  it('bloqueia leitura quando NFS-e nao pertence ao cliente informado', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-5',
      clienteId: 'cliente-2',
      chaveAcesso: '42110092206960810000176000000000000526016992784182',
      xmlPath: 'nfse/producao/123/2026/05/xml/doc-5.xml'
    });

    await expect(service.getXml('doc-5', 'cliente-1')).rejects.toThrow('NFS-e nao encontrada');
  });

  it('gera ZIP de lote com XMLs e manifest', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: '550e8400-e29b-41d4-a716-446655440010',
        clienteId: '550e8400-e29b-41d4-a716-446655440001',
        chaveAcesso: '42110092206960810000176000000000001026016992784180',
        ambiente: Ambiente.producao,
        xmlPath: 'nfse/producao/123/2026/05/xml/doc-10.xml',
        danfsePath: null,
        numeroNfse: '10',
        dataEmissao: new Date('2026-01-10T00:00:00.000Z'),
        status: 'autorizada',
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador',
        cnpjTomador: '12345678000199',
        razaoSocialTomador: 'Tomador',
        valorServico: null,
        descricaoServico: null,
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        updatedAt: new Date('2026-01-10T00:00:00.000Z'),
        eventos: [
          {
            id: 'evento-zip-1',
            tipoEvento: 'CANCELAMENTO',
            dataEvento: new Date('2026-01-10T10:20:30.000Z'),
            xmlPath:
              'nfse/producao/123/2026/05/eventos/42110092206960810000176000000000001026016992784180_CANCELAMENTO.xml',
            createdAt: new Date('2026-01-10T10:20:31.000Z')
          }
        ]
      }
    ]);

    storage.getObject
      .mockResolvedValueOnce(Buffer.from('<xml>doc-10</xml>', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('<evento>cancelamento</evento>', 'utf8'));

    const result = await service.downloadLote({
      ids: ['550e8400-e29b-41d4-a716-446655440010'],
      tipoArquivo: 'xml',
      clienteId: '550e8400-e29b-41d4-a716-446655440001'
    });

    expect(result.contentType).toBe('application/zip');
    expect(result.totalArquivosIncluidos).toBe(2);
    expect(result.idsNaoEncontrados).toEqual([]);
    expect(result.erros).toEqual([]);

    const zipBuffer = Buffer.from(result.contentBase64, 'base64');
    const zip = await JSZip.loadAsync(zipBuffer);
    const xmlEntry = zip.file('xml/NFSE-42110092206960810000176000000000001026016992784180.xml');
    const eventoXmlEntry = zip.file(
      'xml/eventos/42110092206960810000176000000000001026016992784180_CANCELAMENTO.xml'
    );
    const manifestEntry = zip.file('manifest.json');

    expect(xmlEntry).toBeTruthy();
    expect(eventoXmlEntry).toBeTruthy();
    expect(manifestEntry).toBeTruthy();

    const xmlContent = await xmlEntry!.async('string');
    const eventoXmlContent = await eventoXmlEntry!.async('string');
    expect(xmlContent).toBe('<xml>doc-10</xml>');
    expect(eventoXmlContent).toBe('<evento>cancelamento</evento>');
  });

  it('retorna IDs nao encontrados no manifest de lote', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: '550e8400-e29b-41d4-a716-446655440011',
        clienteId: '550e8400-e29b-41d4-a716-446655440001',
        chaveAcesso: '42110092206960810000176000000000001126016992784181',
        ambiente: Ambiente.producao,
        xmlPath: 'nfse/producao/123/2026/05/xml/doc-11.xml',
        danfsePath: null,
        numeroNfse: '11',
        dataEmissao: new Date('2026-01-11T00:00:00.000Z'),
        status: 'autorizada',
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador',
        cnpjTomador: '12345678000199',
        razaoSocialTomador: 'Tomador',
        valorServico: null,
        descricaoServico: null,
        createdAt: new Date('2026-01-11T00:00:00.000Z'),
        updatedAt: new Date('2026-01-11T00:00:00.000Z')
      }
    ]);
    storage.getObject.mockResolvedValue(Buffer.from('<xml>doc-11</xml>', 'utf8'));

    const result = await service.downloadLote({
      ids: [
        '550e8400-e29b-41d4-a716-446655440011',
        '550e8400-e29b-41d4-a716-446655440012'
      ],
      tipoArquivo: 'xml',
      clienteId: '550e8400-e29b-41d4-a716-446655440001'
    });

    expect(result.idsNaoEncontrados).toEqual(['550e8400-e29b-41d4-a716-446655440012']);
  });

  it('permite baixar lote quando a NFS-e esta vinculada ao cliente, mesmo com custodia em outro clienteId', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: '550e8400-e29b-41d4-a716-446655440021',
        clienteId: 'cliente-custodia-outra-empresa',
        chaveAcesso: '42110092206960810000176000000000002126016992784189',
        ambiente: Ambiente.producao,
        xmlPath: 'nfse/producao/123/2026/05/xml/doc-21.xml',
        danfsePath: null,
        numeroNfse: '21',
        dataEmissao: new Date('2026-01-21T00:00:00.000Z'),
        status: 'autorizada',
        cnpjPrestador: '06960810000176',
        razaoSocialPrestador: 'Prestador',
        cnpjTomador: '12345678000199',
        razaoSocialTomador: 'Tomador',
        valorServico: null,
        descricaoServico: null,
        createdAt: new Date('2026-01-21T00:00:00.000Z'),
        updatedAt: new Date('2026-01-21T00:00:00.000Z'),
        vinculos: [{ clienteId: '550e8400-e29b-41d4-a716-446655440001', papel: 'tomada' }]
      }
    ]);
    storage.getObject.mockResolvedValue(Buffer.from('<xml>doc-21</xml>', 'utf8'));

    const result = await service.downloadLote({
      ids: ['550e8400-e29b-41d4-a716-446655440021'],
      tipoArquivo: 'xml',
      clienteId: '550e8400-e29b-41d4-a716-446655440001'
    });

    expect(prisma.nfseDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            in: ['550e8400-e29b-41d4-a716-446655440021']
          },
          OR: [{ clienteId: '550e8400-e29b-41d4-a716-446655440001' }, { vinculos: { some: { clienteId: '550e8400-e29b-41d4-a716-446655440001' } } }]
        })
      })
    );
    expect(result.idsNaoEncontrados).toEqual([]);
    expect(result.totalArquivosIncluidos).toBe(1);
    expect(result.erros).toEqual([]);
  });

  it('permite leitura da NFS-e quando o cliente tem vinculo (mesmo sem ser o dono de custodia)', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-6',
      clienteId: 'cliente-2',
      chaveAcesso: '42110092206960810000176000000000000526016992784183',
      xmlPath: null,
      ambiente: Ambiente.producao,
      vinculos: [{ clienteId: 'cliente-1', papel: 'tomada' }]
    });
    prisma.nfseDocumento.findMany.mockResolvedValue([]);

    const result = await service.findOne('doc-6', 'cliente-1');

    expect(result.id).toBe('doc-6');
  });

  it('syncDocumentoVinculos cria vinculo de emissao e de tomada quando prestador e tomador sao clientes distintos', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse>
    <InfNfse>
      <Numero>300</Numero>
      <CodigoVerificacao>42110092206960810000176000000000030026041826944060</CodigoVerificacao>
      <DataEmissao>2026-04-29T16:00:58-03:00</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <CpfCnpj>
            <Cnpj>06960810000176</Cnpj>
          </CpfCnpj>
        </IdentificacaoPrestador>
        <RazaoSocial>GCONT GESTAO CONTABIL E EMPRESARIAL LTDA</RazaoSocial>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Competencia>2026-04-29T00:00:00</Competencia>
          <Servico>
            <Valores>
              <ValorServicos>8890.00</ValorServicos>
            </Valores>
            <ItemListaServico>1719</ItemListaServico>
            <Discriminacao>HONORARIOS</Discriminacao>
          </Servico>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj>
                <Cnpj>20714171000190</Cnpj>
              </CpfCnpj>
            </IdentificacaoTomador>
            <RazaoSocial>P2 PRE FABRICADOS LTDA</RazaoSocial>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    prisma.nfseDocumento.findUnique.mockResolvedValue(null);
    prisma.nfseDocumento.findFirst.mockResolvedValue(null);
    prisma.nfseDocumento.create.mockResolvedValue({
      id: 'doc-300',
      clienteId: 'cliente-prestador',
      estabelecimentoId: 'estab-prestador',
      ambiente: Ambiente.producao,
      nsu: null,
      chaveAcesso: '42110092206960810000176000000000030026041826944060',
      cnpjPrestador: '06960810000176',
      cnpjTomador: '20714171000190'
    });
    storage.putObject.mockResolvedValue('/tmp/nfse-file');
    prisma.clienteEstabelecimento.findMany.mockImplementation(({ where }: { where: { cnpj: string } }) => {
      if (where.cnpj === '06960810000176') {
        return Promise.resolve([{ id: 'estab-prestador', clienteId: 'cliente-prestador', cnpj: where.cnpj }]);
      }
      if (where.cnpj === '20714171000190') {
        return Promise.resolve([{ id: 'estab-tomador', clienteId: 'cliente-tomador', cnpj: where.cnpj }]);
      }
      return Promise.resolve([]);
    });

    await service.importXml({
      clienteId: 'cliente-prestador',
      estabelecimentoId: 'estab-prestador',
      xml,
      ambiente: 'producao'
    });

    expect(prisma.nfseDocumentoVinculo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nfseDocumentoId_papel: { nfseDocumentoId: 'doc-300', papel: 'emissao' } },
        create: expect.objectContaining({ clienteId: 'cliente-prestador', estabelecimentoId: 'estab-prestador', papel: 'emissao' })
      })
    );
    expect(prisma.nfseDocumentoVinculo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nfseDocumentoId_papel: { nfseDocumentoId: 'doc-300', papel: 'tomada' } },
        create: expect.objectContaining({ clienteId: 'cliente-tomador', estabelecimentoId: 'estab-tomador', papel: 'tomada' })
      })
    );
  });

  it('preserva a custodia original quando outro cliente importa a mesma chave de acesso', async () => {
    const chaveAcesso = '42110092206960810000176000000000050026041826944060';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse>
    <InfNfse>
      <Numero>500</Numero>
      <CodigoVerificacao>${chaveAcesso}</CodigoVerificacao>
      <DataEmissao>2026-04-29T16:00:58-03:00</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <CpfCnpj>
            <Cnpj>06960810000176</Cnpj>
          </CpfCnpj>
        </IdentificacaoPrestador>
        <RazaoSocial>GCONT GESTAO CONTABIL E EMPRESARIAL LTDA</RazaoSocial>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Competencia>2026-04-29T00:00:00</Competencia>
          <Servico>
            <Valores>
              <ValorServicos>8890.00</ValorServicos>
            </Valores>
            <ItemListaServico>1719</ItemListaServico>
            <Discriminacao>HONORARIOS</Discriminacao>
          </Servico>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj>
                <Cnpj>20714171000190</Cnpj>
              </CpfCnpj>
            </IdentificacaoTomador>
            <RazaoSocial>P2 PRE FABRICADOS LTDA</RazaoSocial>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    prisma.nfseDocumento.findUnique.mockImplementation(({ where }: { where: { ambiente_chaveAcesso?: unknown; id?: string } }) => {
      if (where.ambiente_chaveAcesso || where.id === 'doc-500') {
        return Promise.resolve({
          id: 'doc-500',
          clienteId: 'cliente-A',
          estabelecimentoId: 'estab-A',
          ambiente: Ambiente.producao,
          chaveAcesso,
          status: 'autorizada',
          dataCancelamento: null,
          eventos: []
        });
      }
      return Promise.resolve(null);
    });
    prisma.nfseDocumento.update.mockResolvedValue({
      id: 'doc-500',
      clienteId: 'cliente-A',
      estabelecimentoId: 'estab-A',
      ambiente: Ambiente.producao,
      chaveAcesso,
      cnpjPrestador: '06960810000176',
      cnpjTomador: '20714171000190'
    });
    storage.putObject.mockResolvedValue('/tmp/nfse-file');

    await service.importXml({
      clienteId: 'cliente-B',
      estabelecimentoId: 'estab-B',
      xml,
      ambiente: 'producao'
    });

    expect(prisma.nfseDocumento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-500' },
        data: expect.objectContaining({
          clienteId: 'cliente-A',
          estabelecimentoId: 'estab-A'
        })
      })
    );
  });

  it('gera vinculo de emissao e de tomada para o mesmo cliente em caso de autofaturamento', async () => {
    prisma.clienteEstabelecimento.findMany.mockResolvedValue([
      { id: 'estab-unico', clienteId: 'cliente-unico', cnpj: '06960810000176' }
    ]);

    await service.syncDocumentoVinculos('doc-700', Ambiente.producao, '06960810000176', '06960810000176');

    expect(prisma.nfseDocumentoVinculo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nfseDocumentoId_papel: { nfseDocumentoId: 'doc-700', papel: 'emissao' } }
      })
    );
    expect(prisma.nfseDocumentoVinculo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nfseDocumentoId_papel: { nfseDocumentoId: 'doc-700', papel: 'tomada' } }
      })
    );
    expect(prisma.nfseDocumentoVinculo.upsert).toHaveBeenCalledTimes(2);
  });
});
