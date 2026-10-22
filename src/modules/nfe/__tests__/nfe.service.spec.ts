import { NfeAmbiente, NfeSyncStatus, NfeTipoRelacao, Prisma } from '@prisma/client';
import { BadRequestException, Logger } from '@nestjs/common';
import JSZip from 'jszip';
import { DanfePdfGenerator } from '../../../integrations/danfe/danfe.types';
import { DominioNfeXmlSource } from '../../../integrations/dominio-nfe/dominio-nfe.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { NfeDistribuicaoClient } from '../../../integrations/nfe-distribuicao/nfe-distribuicao.types';
import { LocalStorageService } from '../../storage/storage.service';
import type { NfseService as NfseModuleService } from '../../nfse/nfse.service';
import type { CteService } from '../../cte/cte.service';
import { NfeService } from '../nfe.service';
import { NfeXmlParserService } from '../nfe-xml-parser.service';

describe('NfeService', () => {
  const prisma = {
    cliente: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    clienteEstabelecimento: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    certificado: {
      findMany: jest.fn()
    },
    nfeDocumento: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn()
    },
    nfeEvento: {
      upsert: jest.fn()
    },
    nfeSyncControle: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn(),
    putObject: jest.fn(),
    hasObject: jest.fn(),
    deleteObject: jest.fn()
  };

  const nfseService = {
    importXml: jest.fn()
  };

  const danfePdfGenerator: DanfePdfGenerator = {
    generateNfePdf: jest.fn()
  };

  const cteService = {
    consultarChaveInternal: jest.fn(),
    persistDocumentFromExternalSource: jest.fn()
  };

  const distribuicaoClient: NfeDistribuicaoClient = {
    distribuirPorNsu: jest.fn(),
    consultarPorNsu: jest.fn(),
    consultarPorChave: jest.fn()
  };

  const dominioXmlSource: DominioNfeXmlSource = {
    listCompanyAddresses: jest.fn(),
    listDocuments: jest.fn(),
    listCatalog: jest.fn()
  };

  const service = new NfeService(
    prisma as unknown as PrismaService,
    new NfeXmlParserService(),
    nfseService as unknown as NfseModuleService,
    storage as unknown as LocalStorageService,
    danfePdfGenerator,
    cteService as unknown as CteService,
    distribuicaoClient,
    dominioXmlSource
  );

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    (service as any).sefazDiagnosticMode = null;
    (NfeService as any).activeSefazActorQueries.clear();
    (NfeService as any).activeSefazPointQueryQuotaActors.clear();
    delete process.env.NFE_SYNC_SOURCE_MODE;
    delete process.env.NFE_DISTRIBUICAO_CLIENT_MODE;
    delete process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN;
    prisma.cliente.findUnique.mockResolvedValue({ id: 'cliente-1', nfeHabilitado: true, codigoEmpresaDominio: 57 });
    prisma.cliente.findMany.mockResolvedValue([
      { id: 'cliente-1', ativo: true, nfeHabilitado: true, createdAt: new Date('2026-06-29T00:00:00.000Z') }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-1',
      clienteId: 'cliente-1',
      cnpj: '12345678000199',
      municipioCodigoIbge: '4204202'
    });
    prisma.clienteEstabelecimento.findMany.mockResolvedValue([
      {
        id: 'estab-1',
        clienteId: 'cliente-1',
        cnpj: '12345678000199',
        municipioCodigoIbge: '4204202',
        createdAt: new Date('2026-06-29T00:00:00.000Z')
      }
    ]);
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-1',
        nome: 'Certificado Principal',
        estabelecimentoId: 'estab-1',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
      }
    ]);
    prisma.nfeDocumento.findUnique.mockResolvedValue(null);
    prisma.nfeDocumento.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
      id: 'doc-1',
      ...args.create
    }));
    prisma.nfeEvento.upsert.mockResolvedValue({});
    prisma.nfeSyncControle.findFirst.mockResolvedValue(null);
    prisma.nfeSyncControle.findMany.mockResolvedValue([]);
    prisma.nfeSyncControle.create.mockResolvedValue({});
    prisma.nfeSyncControle.upsert.mockResolvedValue({});
    prisma.nfeSyncControle.updateMany.mockResolvedValue({ count: 1 });
    prisma.nfeSyncControle.update.mockResolvedValue({});
    nfseService.importXml.mockResolvedValue({
      id: 'nfse-1',
      chaveAcesso: '42167012244454248000106000000000002924081114719252',
      tipo: 'nfse',
      origem: 'importacao_xml',
      xmlPath: 'nfse/producao/123/2026/06/xml/a.xml',
      danfsePath: 'nfse/producao/123/2026/06/danfse/a.pdf'
    });
    (danfePdfGenerator.generateNfePdf as jest.Mock).mockResolvedValue(Buffer.from('%PDF-1.4 fake', 'utf8'));
    cteService.consultarChaveInternal.mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'Autorizado o uso do CT-e',
      requestedChave: '42260795849600000135570010000319691243772228',
      persistido: true,
      consultaValida: true,
      documentosEncontrados: 1,
      documentosPersistidos: 1,
      eventosEncontrados: 0,
      eventosPersistidos: 0,
      documentos: [{ schema: 'cteProc_v4.00', chaveAcesso: '42260795849600000135570010000319691243772228' }]
    });
    cteService.persistDocumentFromExternalSource.mockResolvedValue({
      tipo: 'documento',
      chaveAcesso: '42260795849600000135570010000319691243772228'
    });
    storage.putObject.mockResolvedValue(undefined);
    storage.hasObject.mockResolvedValue(true);
    storage.deleteObject.mockResolvedValue(undefined);
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([]);
  });

  it('aplica aliquota fixa de 4% para pneus na conferencia CST 060', () => {
    const row = (service as any).toCst060AnalysisItem(
      { id: 'nfe-1', chaveAcesso: '1'.repeat(44), dataEmissao: new Date('2026-07-29'), cnpjEmitente: null },
      { itemNumero: 1, descricaoProduto: 'PNEU 295/80R22.5', quantidade: 1, valorUnitario: 7164, valorProduto: 7164, desconto: 0, vICMSSTRet: 1217.88 },
      17
    );
    expect(row.aliquotaInterna).toBe(4);
    expect(row.origemAliquota).toBe('regra-pneu');
    expect(row.icmsCalculado).toBe(286.56);
  });

  it('limita a base CST 060 ao valor da mercadoria e usa a aliquota do XML', () => {
    const row = (service as any).toCst060AnalysisItem(
      { id: 'nfe-1', chaveAcesso: '1'.repeat(44), dataEmissao: new Date('2026-07-29'), cnpjEmitente: null },
      {
        itemNumero: 1,
        descricaoProduto: 'PRODUTO CST 060',
        quantidade: 1,
        valorUnitario: 1000,
        valorProduto: 1000,
        desconto: 0,
        vBCSTRet: 1200,
        pST: 12.5,
        vICMSSTRet: 150
      },
      17
    );

    expect(row.baseCalculada).toBe(1000);
    expect(row.aliquotaInterna).toBe(12.5);
    expect(row.icmsCalculado).toBe(125);
  });

  it('preserva a base CST 060 do XML quando ela for menor que o valor da mercadoria', () => {
    const row = (service as any).toCst060AnalysisItem(
      { id: 'nfe-1', chaveAcesso: '1'.repeat(44), dataEmissao: new Date('2026-07-29'), cnpjEmitente: null },
      {
        itemNumero: 1,
        descricaoProduto: 'PRODUTO CST 060',
        quantidade: 1,
        valorUnitario: 1000,
        valorProduto: 1000,
        desconto: 50,
        vBCSTRet: 700,
        pST: 12.5,
        vICMSSTRet: 105
      },
      17
    );

    expect(row.baseCalculada).toBe(700);
    expect(row.aliquotaInterna).toBe(12.5);
    expect(row.icmsCalculado).toBe(87.5);
  });

  it('zera o ICMS recalculado quando o ICMS ST retido no XML esta zerado', () => {
    const row = (service as any).toCst060AnalysisItem(
      { id: 'nfe-1', chaveAcesso: '1'.repeat(44), dataEmissao: new Date('2026-07-29'), cnpjEmitente: null },
      { itemNumero: 1, descricaoProduto: 'PRODUTO CST 060', quantidade: 1, valorUnitario: 100, valorProduto: 100, desconto: 0, vICMSSTRet: 0 },
      17
    );

    expect(row.icmsStXml).toBe(0);
    expect(row.icmsCalculado).toBe(0);
    expect(row.diferenca).toBe(0);
    expect(row.status).toBe('OK');
  });

  it('filtra a listagem de NF-e pelo modelo fiscal e pagina os resultados', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(275);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      modelo: '55',
      page: 2,
      pageSize: 100
    });

    expect(prisma.nfeDocumento.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ clienteId: 'cliente-1' }, { modelo: '55' }])
      })
    });
    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 100,
        take: 100
      })
    );
    expect(result).toEqual({
      items: [],
      total: 275,
      page: 2,
      pageSize: 100,
      totalPages: 3
    });
  });

  it('filtra NF-e por dia do calendario e nao inclui 31/07 em uma busca de agosto', async () => {
    const documentos = [
      {
        id: 'doc-julho',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        serie: '1',
        dataEmissao: new Date('2026-07-31T23:30:00-03:00'),
        dataAutorizacao: null,
        cnpjEmitente: '12345678000199',
        cnpjDestinatario: '99887766000155',
        xmlCompletoDisponivel: true,
        resumoDisponivel: true,
        xmlResumoPath: 'nfe/producao/12345678000199/2026/07/resumos/julho.xml',
        xmlCompletoPath: 'nfe/producao/12345678000199/2026/07/xml/julho.xml',
        updatedAt: new Date('2026-07-31T23:40:00-03:00'),
        createdAt: new Date('2026-07-31T23:40:00-03:00'),
        eventos: []
      },
      {
        id: 'doc-agosto',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001232',
        numeroNfe: '124',
        serie: '1',
        dataEmissao: new Date('2026-08-01T00:30:00-03:00'),
        dataAutorizacao: null,
        cnpjEmitente: '12345678000199',
        cnpjDestinatario: '99887766000155',
        xmlCompletoDisponivel: true,
        resumoDisponivel: true,
        xmlResumoPath: 'nfe/producao/12345678000199/2026/08/resumos/agosto.xml',
        xmlCompletoPath: 'nfe/producao/12345678000199/2026/08/xml/agosto.xml',
        updatedAt: new Date('2026-08-01T00:40:00-03:00'),
        createdAt: new Date('2026-08-01T00:40:00-03:00'),
        eventos: []
      },
      {
        // Emissoes no fim do dia em Brasilia sao persistidas no dia seguinte em UTC.
        // A NF-e 32340 e um caso real desta situacao.
        id: 'doc-32340',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000323401000001234',
        numeroNfe: '32340',
        serie: '1',
        dataEmissao: new Date('2026-09-01T02:30:00.000Z'),
        dataAutorizacao: null,
        cnpjEmitente: '12345678000199',
        cnpjDestinatario: '99887766000155',
        xmlCompletoDisponivel: true,
        resumoDisponivel: true,
        xmlResumoPath: 'nfe/producao/12345678000199/2026/08/resumos/32340.xml',
        xmlCompletoPath: 'nfe/producao/12345678000199/2026/08/xml/32340.xml',
        updatedAt: new Date('2026-09-01T02:40:00.000Z'),
        createdAt: new Date('2026-09-01T02:40:00.000Z'),
        eventos: []
      }
    ];

    const getDateRange = (where: { AND?: Array<{ dataEmissao?: { gte?: Date; lte?: Date } }> }) =>
      Array.isArray(where.AND) ? where.AND.find((item) => item.dataEmissao)?.dataEmissao : undefined;
    const filterByRange = (items: typeof documentos, range?: { gte?: Date; lte?: Date }) =>
      items.filter((item) => {
        const timestamp = item.dataEmissao.getTime();
        return (!range?.gte || timestamp >= range.gte.getTime()) && (!range?.lte || timestamp <= range.lte.getTime());
      });

    prisma.nfeDocumento.count.mockImplementation(async (args: { where: { AND?: Array<{ dataEmissao?: { gte?: Date; lte?: Date } }> } }) =>
      filterByRange(documentos, getDateRange(args.where)).length
    );
    prisma.nfeDocumento.findMany.mockImplementation(async (args: { where: { AND?: Array<{ dataEmissao?: { gte?: Date; lte?: Date } }> } }) =>
      filterByRange(documentos, getDateRange(args.where))
    );

    const result = await service.findAll({
      clienteId: 'cliente-1',
      dataInicio: '2026-08-01T00:00:00.000-03:00',
      dataFim: '2026-08-31T23:59:59.999-03:00',
      all: true
    });

    expect(result.items.map((item) => item.id)).toEqual(['doc-32340', 'doc-agosto']);
    const dateRange = getDateRange((prisma.nfeDocumento.findMany as jest.Mock).mock.calls[0][0].where);
    expect(dateRange?.gte).toBeInstanceOf(Date);
    expect(dateRange?.lte).toBeInstanceOf(Date);
    expect(dateRange?.gte?.getDate()).toBe(1);
    expect(dateRange?.gte?.getHours()).toBe(0);
    expect(dateRange?.lte?.getDate()).toBe(31);
    expect(dateRange?.lte?.getHours()).toBe(23);
    expect(dateRange?.gte?.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(dateRange?.lte?.toISOString()).toBe('2026-09-01T02:59:59.999Z');
  });

  it('colapsa duplicatas legadas por ambiente e chave_acesso na listagem ampla', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(2);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-resumo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        serie: '1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        dataAutorizacao: null,
        cnpjEmitente: '12345678000199',
        razaoSocialEmitente: 'EMITENTE LTDA',
        cnpjDestinatario: '99887766000155',
        razaoSocialDestinatario: 'DESTINATARIO LTDA',
        valorTotal: new Prisma.Decimal('890.00'),
        resumoDisponivel: true,
        xmlCompletoDisponivel: false,
        xmlResumoPath: 'nfe/producao/12345678000199/2026/06/resumos/a.xml',
        xmlCompletoPath: null,
        updatedAt: new Date('2026-07-31T16:23:00.000Z'),
        createdAt: new Date('2026-07-31T16:23:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-completo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        serie: '1',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        dataAutorizacao: new Date('2026-06-01T01:00:00.000Z'),
        cnpjEmitente: '12345678000199',
        razaoSocialEmitente: 'EMITENTE LTDA',
        cnpjDestinatario: '99887766000155',
        razaoSocialDestinatario: 'DESTINATARIO LTDA',
        valorTotal: new Prisma.Decimal('890.00'),
        resumoDisponivel: true,
        xmlCompletoDisponivel: true,
        xmlResumoPath: 'nfe/producao/12345678000199/2026/06/resumos/b.xml',
        xmlCompletoPath: 'nfe/producao/12345678000199/2026/06/xml/b.xml',
        updatedAt: new Date('2026-08-03T09:31:00.000Z'),
        createdAt: new Date('2026-08-03T09:31:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      all: true
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({
        skip: expect.anything(),
        take: expect.anything()
      })
    );
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.pageSize).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items[0].id).toBe('doc-completo');
  });

  it('nao colapsa a mesma chave entre producao e homologacao na listagem geral', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(2);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-prod',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        serie: '1',
        modelo: '55',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        dataAutorizacao: new Date('2026-06-01T01:00:00.000Z'),
        cnpjEmitente: '12345678000199',
        razaoSocialEmitente: 'EMITENTE LTDA',
        cnpjDestinatario: '99887766000155',
        razaoSocialDestinatario: 'DESTINATARIO LTDA',
        valorTotal: new Prisma.Decimal('890.00'),
        resumoDisponivel: true,
        xmlCompletoDisponivel: true,
        xmlResumoPath: 'nfe/producao/12345678000199/2026/06/resumos/a.xml',
        xmlCompletoPath: 'nfe/producao/12345678000199/2026/06/xml/a.xml',
        hashResumo: 'hash-prod',
        hashXmlCompleto: 'hash-prod-full',
        updatedAt: new Date('2026-08-03T09:31:00.000Z'),
        createdAt: new Date('2026-08-03T09:31:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-hom',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.homologacao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        serie: '1',
        modelo: '55',
        dataEmissao: new Date('2026-06-01T00:00:00.000Z'),
        dataAutorizacao: new Date('2026-06-01T01:00:00.000Z'),
        cnpjEmitente: '12345678000199',
        razaoSocialEmitente: 'EMITENTE LTDA',
        cnpjDestinatario: '99887766000155',
        razaoSocialDestinatario: 'DESTINATARIO LTDA',
        valorTotal: new Prisma.Decimal('890.00'),
        resumoDisponivel: true,
        xmlCompletoDisponivel: true,
        xmlResumoPath: 'nfe/homologacao/12345678000199/2026/06/resumos/a.xml',
        xmlCompletoPath: 'nfe/homologacao/12345678000199/2026/06/xml/a.xml',
        hashResumo: 'hash-hom',
        hashXmlCompleto: 'hash-hom-full',
        updatedAt: new Date('2026-08-03T09:31:00.000Z'),
        createdAt: new Date('2026-08-03T09:31:00.000Z'),
        eventos: []
      }
    ]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      all: true
    });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.ambiente).sort()).toEqual([
      NfeAmbiente.homologacao,
      NfeAmbiente.producao
    ]);
  });

  it('classifica XML importado com tpAmb=2 como homologacao', async () => {
    const result = await service.importXml({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: NfeAmbiente.producao,
      xmlBase64: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>123</nNF>
        <tpAmb>2</tpAmb>
        <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
      </ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`,
        'utf8'
      ).toString('base64')
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('nfe/homologacao/12345678000199/2026/06/xml/35260612345678000199550010000001231000001231.xml'),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ambiente_chaveAcesso: {
            ambiente: NfeAmbiente.homologacao,
            chaveAcesso: '35260612345678000199550010000001231000001231'
          }
        },
        create: expect.objectContaining({
          ambiente: NfeAmbiente.homologacao
        })
      })
    );
    expect(result).toMatchObject({
      ambiente: NfeAmbiente.homologacao,
      chaveAcesso: '35260612345678000199550010000001231000001231'
    });
  });

  it('retorna estatisticas agregadas do dashboard por cliente', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(12).mockResolvedValueOnce(9);
    prisma.nfeDocumento.groupBy
      .mockResolvedValueOnce([
        {
          clienteId: 'cliente-1',
          _count: { _all: 10 }
        },
        {
          clienteId: 'cliente-2',
          _count: { _all: 2 }
        }
      ])
      .mockResolvedValueOnce([
        {
          clienteId: 'cliente-1',
          _count: { _all: 8 }
        },
        {
          clienteId: 'cliente-2',
          _count: { _all: 1 }
        }
      ]);

    const result = await service.getDashboardStats({});

    expect(result).toEqual({
      totalNfe: 12,
      xmlsCompletos: 9,
      byClient: [
        {
          clienteId: 'cliente-1',
          totalNfe: 10,
          xmlsCompletos: 8
        },
        {
          clienteId: 'cliente-2',
          totalNfe: 2,
          xmlsCompletos: 1
        }
      ]
    });
  });

  it('retorna XML com metadados de download', async () => {
    prisma.nfeDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      xmlCompletoPath: 'nfe/producao/123/2026/06/xml/a.xml',
      xmlResumoPath: null
    });
    storage.getObject.mockResolvedValue(Buffer.from('<xml>conteudo</xml>', 'utf8'));

    const result = await service.getXml('doc-1', 'cliente-1');

    expect(result.fileName).toBe('NFE-35260612345678000199550010000001231000001231.xml');
    expect(result.contentType).toBe('application/xml');
    expect(result.contentBase64).toBe(Buffer.from('<xml>conteudo</xml>', 'utf8').toString('base64'));
  });

  it('gera DANFE da NF-e com XML completo armazenado', async () => {
    prisma.nfeDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      xmlCompletoPath: 'nfe/producao/123/2026/06/xml/a.xml',
      xmlResumoPath: null
    });
    storage.getObject.mockResolvedValue(Buffer.from('<nfeProc>conteudo</nfeProc>', 'utf8'));

    const result = await service.getDanfe('doc-1', 'cliente-1');

    expect(danfePdfGenerator.generateNfePdf).toHaveBeenCalledWith({
      xml: '<nfeProc>conteudo</nfeProc>',
      chaveAcesso: '35260612345678000199550010000001231000001231'
    });
    expect(result.fileName).toBe('DANFE-35260612345678000199550010000001231000001231.pdf');
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentBase64).toBe(Buffer.from('%PDF-1.4 fake', 'utf8').toString('base64'));
  });

  it('recusa DANFE quando a NF-e nao possui XML completo armazenado', async () => {
    prisma.nfeDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      xmlCompletoPath: null,
      xmlResumoPath: 'nfe/producao/123/2026/06/resumo/a.xml'
    });

    await expect(service.getDanfe('doc-1', 'cliente-1')).rejects.toThrow(BadRequestException);
    expect(danfePdfGenerator.generateNfePdf).not.toHaveBeenCalled();
  });

  it('gera ZIP de lote com XML e DANFE', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-lote-1',
        clienteId: 'cliente-1',
        chaveAcesso: '35260612345678000199550010000001231000009999',
        xmlCompletoPath: 'nfe/producao/123/2026/06/xml/a.xml',
        xmlResumoPath: null,
        xmlCompletoDisponivel: true,
        resumoDisponivel: false
      }
    ]);
    storage.getObject.mockResolvedValue(Buffer.from('<nfeProc>conteudo</nfeProc>', 'utf8'));
    (danfePdfGenerator.generateNfePdf as jest.Mock).mockResolvedValue(Buffer.from('%PDF-1.4 nf-e', 'utf8'));

    const result = await service.downloadLote({
      ids: ['doc-lote-1'],
      tipoArquivo: 'ambos',
      clienteId: 'cliente-1'
    });

    expect(result.contentType).toBe('application/zip');
    expect(result.totalSolicitados).toBe(1);
    expect(result.totalDocumentosEncontrados).toBe(1);
    expect(result.totalArquivosIncluidos).toBe(2);
    expect(result.idsNaoEncontrados).toEqual([]);
    expect(result.erros).toEqual([]);
    expect(storage.getObject).toHaveBeenCalledTimes(1);
    expect(danfePdfGenerator.generateNfePdf).toHaveBeenCalledWith({
      xml: '<nfeProc>conteudo</nfeProc>',
      chaveAcesso: '35260612345678000199550010000001231000009999'
    });

    const zip = await JSZip.loadAsync(Buffer.from(result.contentBase64, 'base64'));
    expect(zip.file('xml/NFE-35260612345678000199550010000001231000009999.xml')).toBeTruthy();
    expect(zip.file('danfe/DANFE-35260612345678000199550010000001231000009999.pdf')).toBeTruthy();
    expect(zip.file('manifest.json')).toBeTruthy();
  });

  it('retorna IDs nao encontrados no lote de NF-e', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-lote-2',
        clienteId: 'cliente-1',
        chaveAcesso: '35260612345678000199550010000001231000008888',
        xmlCompletoPath: 'nfe/producao/123/2026/06/xml/b.xml',
        xmlResumoPath: null,
        xmlCompletoDisponivel: true,
        resumoDisponivel: false
      }
    ]);
    storage.getObject.mockResolvedValue(Buffer.from('<nfeProc>conteudo-2</nfeProc>', 'utf8'));

    const result = await service.downloadLote({
      ids: ['doc-lote-2', 'doc-lote-inexistente'],
      tipoArquivo: 'xml',
      clienteId: 'cliente-1'
    });

    expect(result.idsNaoEncontrados).toEqual(['doc-lote-inexistente']);
    const zip = await JSZip.loadAsync(Buffer.from(result.contentBase64, 'base64'));
    expect(zip.file('xml/NFE-35260612345678000199550010000001231000008888.xml')).toBeTruthy();
  });

  it('exporta XML da NFC-e junto com os eventos vinculados no ZIP de lote', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-nfce-lote',
        clienteId: 'cliente-1',
        chaveAcesso: '35260612345678000199650010000001231000006666',
        modelo: '65',
        xmlCompletoPath: 'nfce-sc/producao/123/2026/06/xml/a.xml',
        xmlResumoPath: null,
        xmlCompletoDisponivel: true,
        resumoDisponivel: false,
        eventos: [
          {
            id: 'evento-cancelamento-1',
            tipoEvento: '110111',
            xmlPath: 'nfce-sc/producao/123/2026/06/eventos/cancelamento.xml'
          }
        ]
      }
    ]);
    storage.getObject
      .mockResolvedValueOnce(Buffer.from('<nfeProc>nfce</nfeProc>', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('<procEventoNFe>cancelamento</procEventoNFe>', 'utf8'));

    const result = await service.downloadLote({
      ids: ['doc-nfce-lote'],
      tipoArquivo: 'xml',
      clienteId: 'cliente-1'
    });

    const zip = await JSZip.loadAsync(Buffer.from(result.contentBase64, 'base64'));
    expect(zip.file('xml/NFCE-35260612345678000199650010000001231000006666.xml')).toBeTruthy();
    const eventPath = 'xml/NFCE-EVENTO-35260612345678000199650010000001231000006666-evento-cancelamento-1-cancelamento.xml';
    const eventEntry = zip.file(eventPath);
    expect(eventEntry).toBeTruthy();
    expect(await eventEntry!.async('string')).toBe('<procEventoNFe>cancelamento</procEventoNFe>');
    expect(result.totalArquivosIncluidos).toBe(2);
  });

  it('importa XMLs da Dominio vinculando estabelecimento por CNPJ', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 10,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <protNFe>
    <infProt>
      <chNFe>35260612345678000199550010000001231000001231</chNFe>
      <dhRecbto>2026-06-29T10:00:00-03:00</dhRecbto>
      <cStat>100</cStat>
    </infProt>
  </protNFe>
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>123</nNF>
        <dhEmi>2026-06-29T09:55:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>12345678000199</CNPJ>
        <xNome>Empresa Emitente</xNome>
      </emit>
      <dest>
        <CNPJ>99887766000155</CNPJ>
        <xNome>Empresa Destinataria</xNome>
      </dest>
      <total>
        <ICMSTot>
          <vNF>150.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(dominioXmlSource.listDocuments).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: undefined,
      dataEmissaoInicio: undefined,
      dataEmissaoFim: undefined,
      numeroDocumento: undefined,
      fornecedor: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: undefined,
      sortDirection: undefined
    });
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledTimes(1);
    expect(result.xmlsEncontrados).toBe(1);
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.falhas).toBe(0);
    expect(result.resumoImportacao).toEqual(
      expect.objectContaining({
        nfeDocumentos: 1,
        nfeEventos: 0,
        cteDocumentos: 0,
        cteEventos: 0,
        nfseDocumentos: 0,
        outrosDocumentos: 0,
        totalDocumentosPrincipais: 1,
        totalEventos: 0,
        totalXmlsImportados: 1
      })
    );
  });

  it('repassa filtros pontuais de numero e fornecedor para a importacao da Dominio', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([]);

    await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao,
      dataEmissaoInicio: '2026-08-12',
      dataEmissaoFim: '2026-08-12',
      numeroDocumento: '99656206',
      fornecedor: 'VR BENEFICIOS'
    });

    expect(dominioXmlSource.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        cnpjs: ['12345678000199'],
        codigosEmpresaDominio: [57],
        dataEmissaoInicio: '2026-08-12',
        dataEmissaoFim: '2026-08-12',
        numeroDocumento: '99656206',
        fornecedor: 'VR BENEFICIOS'
      })
    );
  });

  it('redireciona XML ABRASF da Dominio para o armazenamento de NFS-e sem passar pelo pipeline de NF-e', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 528449,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: undefined,
        dataEmissao: '2024-04-12',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse>
    <InfNfse>
      <Numero>554172</Numero>
      <CodigoVerificacao>42024041210792305000137000000055417226051211387771</CodigoVerificacao>
      <DataEmissao>2024-04-12T10:10:08</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <Cnpj>12345678000199</Cnpj>
        </IdentificacaoPrestador>
        <RazaoSocial>Prestador Teste</RazaoSocial>
      </PrestadorServico>
      <TomadorServico>
        <IdentificacaoTomador>
          <CpfCnpj>
            <Cnpj>99887766000155</Cnpj>
          </CpfCnpj>
        </IdentificacaoTomador>
        <RazaoSocial>Tomador Teste</RazaoSocial>
      </TomadorServico>
      <Servico>
        <Valores>
          <ValorServicos>250.00</ValorServicos>
          <ValorIss>5.00</ValorIss>
          <Aliquota>0.0200</Aliquota>
        </Valores>
        <Discriminacao>Servico de entrada antigo</Discriminacao>
      </Servico>
    </InfNfse>
  </Nfse>
</CompNfse>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(nfseService.importXml).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      xml: expect.stringContaining('<CompNfse'),
      ambiente: 'producao'
    });
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.falhas).toBe(0);
    expect(result.resumoImportacao).toEqual(
      expect.objectContaining({
        nfseDocumentos: 1,
        totalDocumentosPrincipais: 1,
        totalEventos: 0,
        totalXmlsImportados: 1
      })
    );
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 528449,
          categoria: 'nfse_documento',
          status: 'persistido',
          mensagem: 'XML da Dominio identificado como NFS-e e importado com sucesso no armazenamento de servicos'
        })
      ])
    );
  });

  it('vincula XML da Dominio pelo codigo da empresa quando o CNPJ retornado nao encontra estabelecimento', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 99671960,
        codigoEmpresa: 57,
        cnpjEmpresa: '00000000000000',
        chaveAcesso: undefined,
        dataEmissao: '2026-08-17',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse>
    <InfNfse>
      <Numero>99671960</Numero>
      <DataEmissao>2026-08-17T15:58:38</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador><Cnpj>02535864000133</Cnpj></IdentificacaoPrestador>
        <RazaoSocial>VR BENEFICIOS E SERVICOS DE PROCESSAMENTOS S.A</RazaoSocial>
      </PrestadorServico>
      <TomadorServico>
        <IdentificacaoTomador><CpfCnpj><Cnpj>95849600000135</Cnpj></CpfCnpj></IdentificacaoTomador>
        <RazaoSocial>TRANSPORTES DIZA LTDA</RazaoSocial>
      </TomadorServico>
    </InfNfse>
  </Nfse>
</CompNfse>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao,
      numeroDocumento: '99671960',
      fornecedor: 'VR BENEFICIOS'
    });

    expect(nfseService.importXml).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      xml: expect.stringContaining('99671960'),
      ambiente: 'producao'
    });
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.ignoradosSemVinculo).toBe(0);
  });

  it('redireciona XML de evento de cancelamento nacional da Dominio para o armazenamento de NFS-e e vincula pela chave', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 525833,
        codigoEmpresa: 20,
        cnpjEmpresa: '07261210000182',
        chaveAcesso: undefined,
        dataEmissao: '2026-05-11',
        xmlBase64: Buffer.from(
          `<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento Id="EVT42110092207261210000182000000000046126053882314271101101001"><verAplic>SefinNacional_1.6.0</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-05-11T16:33:45-03:00</dhProc><nDFSe>0</nDFSe><pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infPedReg Id="PRE42110092207261210000182000000000046126053882314271101101"><tpAmb>1</tpAmb><verAplic>1.00</verAplic><dhEvento>2026-05-11T16:33:43-03:00</dhEvento><CNPJAutor>07261210000182</CNPJAutor><chNFSe>42110092207261210000182000000000046126053882314271</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>9</cMotivo><xMotivo>Cancelamento por motivos diversos</xMotivo></e101101></infPedReg></pedRegEvento></infEvento></evento>`,
          'utf8'
        ).toString('base64')
      }
    ]);
    prisma.clienteEstabelecimento.findMany.mockResolvedValueOnce([
      {
        id: 'estab-1',
        clienteId: 'cliente-1',
        cnpj: '07261210000182',
        municipioCodigoIbge: '4204202',
        createdAt: new Date('2026-06-29T00:00:00.000Z')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(nfseService.importXml).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      xml: expect.stringContaining('<evento'),
      ambiente: 'producao'
    });
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.falhas).toBe(0);
    expect(result.resumoImportacao).toEqual(
      expect.objectContaining({
        nfseDocumentos: 1,
        totalDocumentosPrincipais: 1,
        totalEventos: 0,
        totalXmlsImportados: 1
      })
    );
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 525833,
          categoria: 'nfse_documento',
          status: 'persistido',
          mensagem: 'XML da Dominio identificado como NFS-e e importado com sucesso no armazenamento de servicos'
        })
      ])
    );
  });

  it('ignora XML de baixa financeira da Dominio sem contar como falha nem tentar importar', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 521572,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: undefined,
        dataEmissao: '2026-05-04',
        xmlBase64: Buffer.from(
          `<Baixas><infBaixas versao="1.00"><parcela><cnpj>08560957000102</cnpj><tipo>1</tipo><especie>55</especie><serie>2</serie><numero>959</numero><datavencimento>2026-05-03</datavencimento><datapagamento>2026-05-04</datapagamento><valorrecebido>64.47</valorrecebido><fornecedor>59358635000108</fornecedor><historico>PAG. DUPLICATA COMAND MAC IMPORTS LTDA 959</historico><titulo>959-1</titulo></parcela></infBaixas></Baixas>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(nfseService.importXml).not.toHaveBeenCalled();
    expect(result.xmlsPersistidos).toBe(0);
    expect(result.falhas).toBe(0);
    expect(result.resumoImportacao).toEqual(
      expect.objectContaining({
        totalDocumentosPrincipais: 0,
        totalEventos: 0,
        totalXmlsImportados: 0
      })
    );
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 521572,
          status: 'ignorado_xml_nao_fiscal',
          mensagem: 'XML da Dominio ignorado por se tratar de baixa financeira, sem documento fiscal para importar'
        })
      ])
    );
  });

  it('roteia XML principal de CT-e retornado pela Dominio para o modulo dedicado', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 600001,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: undefined,
        dataEmissao: '2026-07-04',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe42260795849600000135570010000319691243772228">
      <ide>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>31969</nCT>
      </ide>
    </infCte>
  </CTe>
  <protCTe><infProt><chCTe>42260795849600000135570010000319691243772228</chCTe></infProt></protCTe>
</cteProc>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(cteService.persistDocumentFromExternalSource).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: NfeAmbiente.producao,
      cnpjConsulta: '12345678000199',
      fallbackDataEmissao: '2026-07-04',
      document: {
        schema: 'cteProc_v4.00',
        xml: expect.stringContaining('<cteProc'),
        chaveAcesso: '42260795849600000135570010000319691243772228'
      },
      origem: 'importacao_xml'
    });
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(nfseService.importXml).not.toHaveBeenCalled();
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.falhas).toBe(0);
    expect(result.resumoImportacao).toEqual(
      expect.objectContaining({
        cteDocumentos: 1,
        totalDocumentosPrincipais: 1,
        totalEventos: 0,
        totalXmlsImportados: 1
      })
    );
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 600001,
          categoria: 'cte_documento',
          status: 'persistido',
          mensagem: 'XML de CT-e importado com sucesso a partir da Dominio'
        })
      ])
    );
  });

  it('roteia XML de evento de CT-e retornado pela Dominio para o modulo dedicado', async () => {
    cteService.persistDocumentFromExternalSource.mockResolvedValueOnce({
      tipo: 'evento',
      chaveAcesso: '42260795849600000135570010000319691243772228'
    });
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 600002,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: undefined,
        dataEmissao: '2026-07-04',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento Id="ID1101114226079584960000013557001000031969124377222801">
      <tpEvento>110111</tpEvento>
      <chCTe>42260795849600000135570010000319691243772228</chCTe>
      <dhEvento>2026-07-04T10:00:00-03:00</dhEvento>
    </infEvento>
  </eventoCTe>
</procEventoCTe>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.importFromDominio({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(cteService.persistDocumentFromExternalSource).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: NfeAmbiente.producao,
      cnpjConsulta: '12345678000199',
      fallbackDataEmissao: '2026-07-04',
      document: {
        schema: 'procEventoCTe_v4.00',
        xml: expect.stringContaining('<procEventoCTe'),
        chaveAcesso: '42260795849600000135570010000319691243772228'
      },
      origem: 'importacao_xml'
    });
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(nfseService.importXml).not.toHaveBeenCalled();
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.falhas).toBe(0);
    expect(result.resumoImportacao).toEqual(
      expect.objectContaining({
        cteEventos: 1,
        totalDocumentosPrincipais: 0,
        totalEventos: 1,
        totalXmlsImportados: 1
      })
    );
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 600002,
          categoria: 'cte_evento',
          status: 'persistido',
          mensagem: 'XML de evento de CT-e importado com sucesso a partir da Dominio'
        })
      ])
    );
  });

  it('inicia controles de sync reaproveitando certificados', async () => {
    const result = await service.iniciarSync({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao,
      nsuInicial: '25'
    });

    expect(prisma.nfeSyncControle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          ultimoNsuConsultado: 24n
        })
      })
    );
    expect(result).toEqual({ controlesCriadosOuAtualizados: 1 });
  });

  it('ativa sync no NSU atual sem importar historico', async () => {
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documentos localizados',
      ultNsu: 12n,
      maxNsu: 99n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.ativarSyncNoNsuAtual({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      ultNsu: 0n,
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(prisma.nfeSyncControle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ultimoNsuConsultado: 99n,
          maxNsu: 99n,
          status: NfeSyncStatus.ativo
        })
      })
    );
    expect(result.controlesInicializados).toBe(1);
    expect(result.controlesReativados).toBe(0);
    expect(result.falhas).toBe(0);
  });

  it('recaptura NSU base quando controle existente esta zerado', async () => {
    prisma.nfeSyncControle.findFirst.mockResolvedValue({
      id: 'ctrl-1',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '12345678000199',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 0n,
      maxNsu: 0n
    });
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Nenhum documento localizado',
      ultNsu: 321n,
      maxNsu: 321n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.ativarSyncNoNsuAtual({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 321n,
          maxNsu: 321n,
          status: NfeSyncStatus.ativo
        })
      })
    );
    expect(result.controlesInicializados).toBe(0);
    expect(result.controlesReativados).toBe(1);
    expect(result.falhas).toBe(0);
  });

  it('nao cria controle quando captura inicial retorna cStat invalido ou sem NSU base', async () => {
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '656',
      xMotivo: 'Consumo indevido',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.ativarSyncNoNsuAtual({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(prisma.nfeSyncControle.create).not.toHaveBeenCalled();
    expect(result.controlesInicializados).toBe(0);
    expect(result.controlesReativados).toBe(0);
    expect(result.falhas).toBe(1);
    expect(result.detalhes[0]).toEqual(
      expect.objectContaining({
        status: 'falha',
        mensagem: expect.stringContaining('cStat 656')
      })
    );
  });

  it('bloqueia ativacao quando o cliente esta com busca de NF-e desabilitada', async () => {
    prisma.cliente.findUnique.mockResolvedValue({
      id: 'cliente-1',
      nfeHabilitado: false
    });

    await expect(
      service.ativarSyncNoNsuAtual({
        clienteId: 'cliente-1',
        ambiente: NfeAmbiente.producao
      })
    ).rejects.toThrow('Cliente com busca de NF-e desabilitada no cadastro');
  });

  it('ativa controles via Dominio sem consultar certificado ou NSU', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';

    const result = await service.ativarSyncNoNsuAtual({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    expect(prisma.certificado.findMany).not.toHaveBeenCalled();
    expect(prisma.nfeSyncControle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          cnpjConsulta: '12345678000199',
          status: NfeSyncStatus.ativo,
          ultimaMensagem: 'Busca de NF-e via banco Dominio habilitada'
        })
      })
    );
    expect(result.controlesInicializados).toBe(1);
    expect(result.falhas).toBe(0);
  });

  it('ativa produtor rural por CPF via distribuicao mesmo com a origem Dominio configurada', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.clienteEstabelecimento.findMany.mockResolvedValue([
      {
        id: 'estab-1',
        clienteId: 'cliente-1',
        cnpj: '01861020970',
        municipioCodigoIbge: '4204202'
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.ativarSyncNoNsuAtual({ clienteId: 'cliente-1' });

    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({ cnpjConsulta: '01861020970', ultNsu: 0n })
    );
    expect(dominioXmlSource.listDocuments).not.toHaveBeenCalled();
    expect(result.controlesInicializados).toBe(1);
  });

  it('roda distribuicao e persiste NF-e sincronizada', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documentos localizados',
      ultNsu: 11n,
      maxNsu: 99n,
      documents: [
        {
          nsu: 11n,
          schema: 'procNFe_v4.00',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.runNow({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/xml/35260612345678000199550010000001231000001231.xml'),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '35260612345678000199550010000001231000001231',
          tipoRelacao: NfeTipoRelacao.emitida,
          valorTotal: new Prisma.Decimal('150.00')
        })
      })
    );
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 11n,
          ultimoNsuDistribuido: 11n,
          maxNsu: 99n
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1,
      failures: 0,
      executionDetails: [],
      failureDetails: [],
      sefazDiagnostics: [expect.objectContaining({
        method: 'distNSU',
        clientMode: 'mock',
        actorType: 'CNPJ',
        cStat: '138',
        documentsReceived: 1,
        documentsProcessed: 1
      })]
    });
  });

  it('roda importacao via Dominio usando cursor salvo no controle', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '300';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        maxNsu: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 11,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.runNowGlobal();

    expect(dominioXmlSource.listDocuments).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 300,
      dataEmissaoInicio: undefined,
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: 10,
      sortDirection: 'asc'
    });
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 11n,
          ultimoNsuDistribuido: 11n,
          maxNsu: 11n,
          status: NfeSyncStatus.ativo
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1,
      failures: 0,
      executionDetails: [
        {
          kind: 'documento',
          status: 'persistido',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          serie: '1',
          modelo: '55',
          mensagem: 'XML importado com sucesso'
        }
      ],
      failureDetails: []
    });
  });

  it('roda CNPJ via Dominio e CPF via SEFAZ quando a origem configurada e Dominio', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-cnpj',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 12n,
        ultimoNsuDistribuido: 12n,
        maxNsu: 12n,
        status: NfeSyncStatus.ativo
      },
      {
        id: 'ctrl-cpf',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-cpf',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 20n,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      clienteId: 'cliente-1',
      cnpj: where.id === 'estab-cpf' ? '01861020970' : '12345678000199',
      municipioCodigoIbge: '4204202'
    }));
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-1',
        nome: 'Certificado da Empresa',
        estabelecimentoId: 'estab-1',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
      },
      {
        id: 'cert-cpf',
        nome: 'Certificado do Produtor',
        estabelecimentoId: 'estab-cpf',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-cpf.bin'
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.runNow({ clienteId: 'cliente-1' });

    expect(dominioXmlSource.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ cnpjs: ['12345678000199'] })
    );
    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({ cnpjConsulta: '01861020970' })
    );
    expect(result.processed).toBe(2);
  });

  it('executa a acao manual somente para CPFs na SEFAZ mesmo com Dominio configurada', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-cnpj',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 12n,
        ultimoNsuDistribuido: 12n,
        maxNsu: 12n,
        status: NfeSyncStatus.ativo
      },
      {
        id: 'ctrl-cpf',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-cpf',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 20n,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      clienteId: 'cliente-1',
      cnpj: where.id === 'estab-cpf' ? '01861020970' : '12345678000199',
      municipioCodigoIbge: '4204202'
    }));
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-1',
        nome: 'Certificado da Empresa',
        estabelecimentoId: 'estab-1',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
      },
      {
        id: 'cert-cpf',
        nome: 'Certificado do Produtor',
        estabelecimentoId: 'estab-cpf',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-cpf.bin'
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.runNowCpfViaSefazGlobal();

    expect(prisma.nfeSyncControle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [NfeSyncStatus.ativo, NfeSyncStatus.erro_api] }
        })
      })
    );
    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledTimes(1);
    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({ cnpjConsulta: '01861020970', certificateId: 'cert-cpf' })
    );
    expect(dominioXmlSource.listDocuments).not.toHaveBeenCalled();
    expect(dominioXmlSource.listCatalog).not.toHaveBeenCalled();
    expect(result.processed).toBe(1);
  });

  it('filtra a importacao manual da SEFAZ por cliente, ambiente e limite', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-cpf-homologacao',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.homologacao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 20n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.runNowCpfViaSefazGlobal({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.homologacao,
      limitControles: 1
    });

    expect(prisma.nfeSyncControle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clienteId: 'cliente-1',
          ambiente: NfeAmbiente.homologacao
        })
      })
    );
    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.homologacao
      })
    );
    expect(result.processed).toBe(1);
    expect(dominioXmlSource.listDocuments).not.toHaveBeenCalled();
  });

  it.each([
    { actorType: 'CPF' as const, taxId: '01861020970', controlId: 'ctrl-cpf', establishmentId: 'estab-cpf' },
    { actorType: 'CNPJ' as const, taxId: '12345678000199', controlId: 'ctrl-cnpj', establishmentId: 'estab-1' }
  ])('registra o retorno distNSU de $actorType sem incluir o identificador fiscal no log', async ({ actorType, taxId, controlId, establishmentId }) => {
    delete process.env.NFE_DISTRIBUICAO_CLIENT_MODE;
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: controlId,
        clienteId: 'cliente-1',
        estabelecimentoId: establishmentId,
        cnpjConsulta: taxId,
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 0n,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: establishmentId,
      clienteId: 'cliente-1',
      cnpj: taxId,
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: `cert-${actorType.toLowerCase()}`,
        clienteId: 'cliente-1',
        nome: 'Certificado de teste',
        estabelecimentoId: establishmentId,
        cnpjTitular: taxId,
        arquivoCriptografadoPath: 'certificados/teste/cert.bin'
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: actorType === 'CPF' ? `Sem documentos para CPF ${taxId}` : 'Sem documentos',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: '<retDistDFeInt>nao deve ser registrado</retDistDFeInt>'
    });
    const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    try {
      const result = actorType === 'CPF'
        ? await service.runNowCpfViaSefazGlobal()
        : await service.runNow({ clienteId: 'cliente-1' });
      const diagnostic = result.sefazDiagnostics?.[0];
      const diagnosticLog = loggerSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('nfe_distnsu_diagnostic'));

      expect(diagnostic).toMatchObject({
        method: 'distNSU',
        clientMode: 'mock',
        actorType,
        ambiente: NfeAmbiente.producao,
        httpStatus: 200,
        cStat: '137',
        ultNsu: '0',
        maxNsu: '20',
        documentsReceived: 0,
        documentsDecoded: 0,
        docZipDiscarded: 0,
        schemaCounts: {},
        documentsFiltered: 0,
        documentsProcessed: 0,
        documentsFailed: 0
      });
      expect(diagnosticLog).toContain('"event":"nfe_distnsu_diagnostic"');
      expect(diagnosticLog).toContain(`"actorType":"${actorType}"`);
      expect(diagnosticLog).not.toContain(taxId);
      expect(diagnosticLog).not.toContain('nao deve ser registrado');
      if (actorType === 'CPF') {
        expect(diagnostic?.xMotivo).toContain('[CPF mascarado]');
      }
      expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
        expect.objectContaining({ cnpjConsulta: taxId })
      );
    } finally {
      loggerSpy.mockRestore();
    }
  });

  it('conta schemas e processamento sem registrar XML bruto no diagnóstico incremental', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-cpf-schema',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-cpf',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 0n,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-cpf',
      clienteId: 'cliente-1',
      cnpj: '01861020970',
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-cpf',
        clienteId: 'cliente-1',
        nome: 'Certificado de teste',
        estabelecimentoId: 'estab-cpf',
        cnpjTitular: '01861020970',
        arquivoCriptografadoPath: 'certificados/teste/cert-cpf.bin'
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documentos localizados',
      ultNsu: 1n,
      maxNsu: 5n,
      documents: [{ nsu: 1n, schema: 'resNFe_v1.01.xsd', xml: '<resNFe>XML confidencial</resNFe>' }],
      rawResponse: '<retDistDFeInt>XML bruto confidencial</retDistDFeInt>'
    });
    const persistDocumentSpy = jest.spyOn(service as any, 'persistDocument').mockResolvedValue({ id: 'doc-cpf' });
    const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    try {
      const result = await service.runNowCpfViaSefazGlobal();
      const diagnosticLog = loggerSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('nfe_distnsu_diagnostic'));

      expect(result.sefazDiagnostics?.[0]).toMatchObject({
        actorType: 'CPF',
        cStat: '138',
        documentsReceived: 1,
        documentsDecoded: 1,
        docZipDiscarded: 0,
        schemaCounts: { 'resNFe_v1.01.xsd': 1 },
        documentsFiltered: 0,
        documentsAttempted: 1,
        documentsProcessed: 1,
        documentsFailed: 0,
        documentsNotAttempted: 0
      });
      expect(result.documentsSaved).toBe(1);
      expect(diagnosticLog).not.toContain('XML confidencial');
      expect(diagnosticLog).not.toContain('XML bruto confidencial');
    } finally {
      persistDocumentSpy.mockRestore();
      loggerSpy.mockRestore();
    }
  });

  it('usa o certificado vinculado ao estabelecimento do produtor CPF selecionado', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-jair',
        clienteId: 'cliente-jair',
        estabelecimentoId: 'estab-jair',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 20n,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-jair',
      clienteId: 'cliente-jair',
      cnpj: '01861020970',
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-jair',
        nome: 'Certificado Jair',
        clienteId: 'cliente-jair',
        estabelecimentoId: 'estab-jair',
        cnpjTitular: '12345678000199',
        ativo: true,
        arquivoCriptografadoPath: 'certificados/cliente-jair/cert-jair.bin'
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: { mock: true }
    });

    await service.runNowCpfViaSefazGlobal({ controleId: 'ctrl-jair', certificadoId: 'cert-jair' });

    expect(prisma.nfeSyncControle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clienteId: 'cliente-jair',
          estabelecimentoId: 'estab-jair',
          cnpjConsulta: '01861020970'
        })
      })
    );
    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({
        cnpjConsulta: '01861020970',
        certificateId: 'cert-jair'
      })
    );
  });

  it('recupera NSUs historicos por consNSU, salva apenas o periodo e preserva o cursor incremental', async () => {
    const xmlForDate = (key: string, emissionDate: string) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}">
  <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>${emissionDate}T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
  <dest><CPF>01861020970</CPF><xNome>Jair Jungkenn</xNome></dest>
  <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
</infNFe></NFe><protNFe><infProt><tpAmb>1</tpAmb><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const septemberDocument = {
      nsu: 10n,
      schema: 'procNFe_v4.00',
      chaveAcesso: '1'.repeat(44),
      xml: xmlForDate('1'.repeat(44), '2026-09-01')
    };
    const octoberDocument = {
      nsu: 90n,
      schema: 'procNFe_v4.00',
      chaveAcesso: '2'.repeat(44),
      xml: xmlForDate('2'.repeat(44), '2026-10-01')
    };
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-jair',
        clienteId: 'cliente-jair',
        estabelecimentoId: 'estab-jair',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 2n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 2n,
        ultimaExecucao: null,
        ultimaMensagem: null,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-jair',
      clienteId: 'cliente-jair',
      cnpj: '01861020970',
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-jair',
        clienteId: 'cliente-jair',
        estabelecimentoId: 'estab-jair',
        cnpjTitular: '01861020970',
        ativo: true,
        arquivoCriptografadoPath: 'certificados/cliente-jair/cert-jair.bin'
      }
    ]);
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockImplementation(async ({ nsu }: { nsu: bigint }) =>
      nsu === 2n
        ? {
            statusCode: 200,
            cStat: '138',
            xMotivo: 'Documento localizado',
            ultNsu: 2n,
            maxNsu: 2n,
            documents: [septemberDocument, octoberDocument],
            rawResponse: { mock: true }
          }
        : {
            statusCode: 200,
            cStat: '137',
            xMotivo: 'Nenhum documento localizado',
            ultNsu: nsu,
            maxNsu: 2n,
            documents: [],
            rawResponse: { mock: true }
          }
    );

    const result = await service.runNowCpfViaSefazGlobal({
      controleId: 'ctrl-jair',
      certificadoId: 'cert-jair',
      clienteId: 'cliente-jair',
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    });

    expect(distribuicaoClient.consultarPorNsu).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cnpjConsulta: '01861020970', nsu: 2n, certificateId: 'cert-jair' })
    );
    expect(distribuicaoClient.consultarPorNsu).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cnpjConsulta: '01861020970', nsu: 1n, certificateId: 'cert-jair' })
    );
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '1'.repeat(44),
          cnpjDestinatario: '01861020970'
        })
      })
    );
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ctrl-jair' },
      data: expect.objectContaining({
        status: NfeSyncStatus.ativo,
        totalDocumentosBaixados: { increment: 1 }
      })
    }));
    expect(prisma.nfeSyncControle.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { cnpjConsulta: '01861020970', ambiente: NfeAmbiente.producao },
      data: expect.objectContaining({
        ultimaMensagem: expect.stringContaining('O cursor normal 2 foi preservado')
      })
    }));
    expect(result.executionDetails[0].mensagem).toContain('cursor incremental 2 foi preservado');
    expect(result.documentsSaved).toBe(1);
    expect(result.failures).toBe(0);
  });

  it('preserva eventos de NF-e encontrados durante a recuperacao historica por CPF', async () => {
    const key = '1'.repeat(44);
    const eventXml = `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00"><infEvento Id="ID110111${key}01">
    <tpAmb>1</tpAmb><CPF>01861020970</CPF><chNFe>${key}</chNFe>
    <dhEvento>2026-08-13T14:10:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>
    <detEvento versao="1.00"><descEvento>Cancelamento</descEvento><xJust>Cancelamento homologado</xJust></detEvento>
  </infEvento></evento>
</procEventoNFe>`;
    const control = {
      id: 'ctrl-jair-evento',
      clienteId: 'cliente-jair',
      estabelecimentoId: 'estab-jair',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 1n,
      ultimoNsuDistribuido: 0n,
      maxNsu: 2n,
      ultimaExecucao: null,
      ultimaMensagem: null,
      status: NfeSyncStatus.ativo
    };
    prisma.nfeSyncControle.findMany.mockResolvedValue([control]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: control.estabelecimentoId,
      clienteId: control.clienteId,
      cnpj: control.cnpjConsulta,
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-jair-evento',
      clienteId: control.clienteId,
      estabelecimentoId: control.estabelecimentoId,
      cnpjTitular: control.cnpjConsulta,
      ativo: true,
      arquivoCriptografadoPath: 'certificados/cliente-jair/cert-jair-evento.bin'
    }]);
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockImplementation(async ({ nsu }: { nsu: bigint }) =>
      nsu === 2n
        ? {
            statusCode: 200,
            cStat: '138',
            xMotivo: 'Documento localizado',
            ultNsu: 2n,
            maxNsu: 2n,
            documents: [{ nsu: 2n, schema: 'procEventoNFe_v1.00.xsd', chaveAcesso: key, xml: eventXml }],
            rawResponse: { mock: true }
          }
        : {
            statusCode: 200,
            cStat: '632',
            xMotivo: 'Solicitacao fora do prazo de disponibilidade',
            ultNsu: 1n,
            maxNsu: 2n,
            documents: [],
            rawResponse: { mock: true }
          }
    );

    const result = await service.runNowCpfViaSefazGlobal({
      controleId: control.id,
      certificadoId: 'cert-jair-evento',
      clienteId: control.clienteId,
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    });

    expect(prisma.nfeEvento.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ chaveAcesso: key, tipoEvento: '110111' })
    }));
    expect(result.cpfDiagnostics).toMatchObject({
      status: 'concluida',
      documentosRetornados: 1,
      eventos: 1,
      documentosImportados: 1
    });
    expect(result.failures).toBe(0);
  });

  it('retoma automaticamente uma recuperacao CPF pendente pelo agendador', async () => {
    const certificateId = '00000000-0000-4000-8000-000000000001';
    const control = {
      id: 'ctrl-cpf-agendado',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 1n,
      ultimoNsuDistribuido: 0n,
      maxNsu: 1n,
      status: NfeSyncStatus.ativo,
      ultimaExecucao: new Date(Date.now() - 61 * 60 * 1000),
      ultimaMensagem: `Recuperacao historica CPF pausada. Proximo NSU: 1. [[SEFAZ_CPF_BACKFILL|1|1|2026-09-01|2026-09-30|${certificateId}]]`
    };
    prisma.nfeSyncControle.findMany.mockResolvedValue([control]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: control.estabelecimentoId,
      clienteId: control.clienteId,
      cnpj: control.cnpjConsulta,
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([{
      id: certificateId,
      clienteId: control.clienteId,
      estabelecimentoId: control.estabelecimentoId,
      cnpjTitular: control.cnpjConsulta,
      ativo: true,
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-cpf.bin'
    }]);
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '632',
      xMotivo: 'Solicitacao fora do prazo de disponibilidade',
      ultNsu: 1n,
      maxNsu: 1n,
      documents: [],
      rawResponse: { mock: true }
    });

    await (service as unknown as { runAutomaticSyncCycle(): Promise<void> }).runAutomaticSyncCycle();

    expect(distribuicaoClient.consultarPorNsu).toHaveBeenCalledWith(expect.objectContaining({
      cnpjConsulta: '01861020970',
      nsu: 1n,
      certificateId
    }));
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
  });

  it('permite recuperacao historica durante a pausa incremental cStat 137 sem liberar distNSU', async () => {
    const cooldownStartedAt = new Date(Date.now() - 5 * 60 * 1000);
    const control = {
      id: 'ctrl-cpf-137-historico',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 1n,
      ultimoNsuDistribuido: 0n,
      maxNsu: 1n,
      status: NfeSyncStatus.ativo,
      ultimaExecucao: cooldownStartedAt,
      ultimaMensagem: 'cStat 137 - Sem novos documentos. Aguardando pausa para evitar novo bloqueio por consumo indevido.'
    };
    prisma.nfeSyncControle.findMany.mockResolvedValue([control]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: control.estabelecimentoId,
      clienteId: control.clienteId,
      cnpj: control.cnpjConsulta,
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-cpf-137-historico',
      clienteId: control.clienteId,
      estabelecimentoId: control.estabelecimentoId,
      cnpjTitular: control.cnpjConsulta,
      ativo: true,
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-cpf-137-historico.bin'
    }]);
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '632',
      xMotivo: 'Solicitacao fora do prazo de disponibilidade',
      ultNsu: 1n,
      maxNsu: 1n,
      documents: [],
      rawResponse: { mock: true }
    });

    const historicalRun = await service.runNowCpfViaSefazGlobal({
      controleId: control.id,
      certificadoId: 'cert-cpf-137-historico',
      clienteId: control.clienteId,
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    });

    expect(distribuicaoClient.consultarPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({ nsu: 1n, certificateId: 'cert-cpf-137-historico' })
    );
    expect(historicalRun.cpfDiagnostics?.status).toBe('sem_documentos');
    const completionUpdate = prisma.nfeSyncControle.updateMany.mock.calls.at(-1)?.[0];
    expect(completionUpdate.data.ultimaExecucao).toEqual(cooldownStartedAt);
    expect(completionUpdate.data.ultimaMensagem).toContain('cStat 137');

    Object.assign(control, {
      ultimaExecucao: completionUpdate.data.ultimaExecucao,
      ultimaMensagem: completionUpdate.data.ultimaMensagem
    });
    const incrementalRun = await service.runNowCpfViaSefazGlobal();
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    expect(incrementalRun.executionDetails[0].mensagem).toContain('pausada ate');
  });

  it('mantem cStat 656 bloqueando tambem a recuperacao historica', async () => {
    const control = {
      id: 'ctrl-cpf-656-historico',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 1n,
      ultimoNsuDistribuido: 0n,
      maxNsu: 1n,
      status: NfeSyncStatus.ativo,
      ultimaExecucao: new Date(),
      ultimaMensagem: 'cStat 656 - Consumo indevido'
    };
    prisma.nfeSyncControle.findMany.mockResolvedValue([control]);
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-cpf-656-historico',
      clienteId: control.clienteId,
      estabelecimentoId: control.estabelecimentoId,
      cnpjTitular: control.cnpjConsulta,
      ativo: true,
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-cpf-656-historico.bin'
    }]);

    await expect(service.runNowCpfViaSefazGlobal({
      controleId: control.id,
      certificadoId: 'cert-cpf-656-historico',
      clienteId: control.clienteId,
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    })).rejects.toThrow('pausada ate');
    expect(distribuicaoClient.consultarPorNsu).not.toHaveBeenCalled();
  });

  it('limita a recuperacao historica a 15 NSUs e salva o ponto para retomar depois de uma hora', async () => {
    const control = {
      id: 'ctrl-cpf-historico',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 30n,
      ultimoNsuDistribuido: 0n,
      maxNsu: 30n,
      status: NfeSyncStatus.ativo,
      ultimaExecucao: null,
      ultimaMensagem: null
    };
    prisma.nfeSyncControle.findMany.mockResolvedValue([control]);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-1',
      clienteId: 'cliente-1',
      cnpj: '01861020970',
      municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-jair',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjTitular: '01861020970',
      ativo: true,
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-jair.bin'
    }]);
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockImplementation(async ({ nsu }: { nsu: bigint }) => ({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Nenhum documento localizado',
      ultNsu: nsu,
      maxNsu: 30n,
      documents: [],
      rawResponse: { mock: true }
    }));

    const result = await service.runNowCpfViaSefazGlobal({
      controleId: control.id,
      certificadoId: 'cert-jair',
      clienteId: control.clienteId,
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    });

    expect(distribuicaoClient.consultarPorNsu).toHaveBeenCalledTimes(15);
    expect(distribuicaoClient.consultarPorNsu).toHaveBeenNthCalledWith(
      15,
      expect.objectContaining({ nsu: 16n, certificateId: 'cert-jair' })
    );
    expect(prisma.nfeSyncControle.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { cnpjConsulta: control.cnpjConsulta, ambiente: control.ambiente },
      data: expect.objectContaining({
        ultimaExecucao: expect.any(Date),
        ultimaMensagem: expect.stringContaining('SEFAZ_CPF_BACKFILL|15|30|2026-09-01|2026-09-30')
      })
    }));
    expect(result.executionDetails[0].mensagem).toContain('parcial');
    expect(result.executionDetails[0].mensagem).toContain('NSU 15');
    expect(result.failures).toBe(0);

    const automaticRun = await service.runNowCpfViaSefazGlobal();
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    expect(automaticRun.executionDetails[0].mensagem).toContain('recuperacao historica por NSU');

    await expect(service.runNowCpfViaSefazGlobal({
      controleId: control.id,
      certificadoId: 'cert-jair',
      clienteId: control.clienteId,
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    })).rejects.toThrow('pausada ate');
    expect(distribuicaoClient.consultarPorNsu).toHaveBeenCalledTimes(15);

    Object.assign(control, { ultimaExecucao: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockImplementation(async ({ nsu }: { nsu: bigint }) => ({
      statusCode: 200,
      cStat: '632',
      xMotivo: 'Solicitacao fora do prazo de disponibilidade',
      ultNsu: nsu,
      maxNsu: 30n,
      documents: [],
      rawResponse: { mock: true }
    }));
    const resumedRun = await service.runNowCpfViaSefazGlobal({
      controleId: control.id,
      certificadoId: 'cert-jair',
      clienteId: control.clienteId,
      dataEmissaoInicio: '2026-09-01',
      dataEmissaoFim: '2026-09-30'
    });
    expect(distribuicaoClient.consultarPorNsu).toHaveBeenCalledTimes(16);
    expect(distribuicaoClient.consultarPorNsu).toHaveBeenLastCalledWith(
      expect.objectContaining({ nsu: 15n, certificateId: 'cert-jair' })
    );
    expect(resumedRun.cpfDiagnostics?.status).toBe('sem_documentos');
  });

  it('exibe falhas retornadas pela SEFAZ na busca manual de CPF', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-cpf',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 20n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 401,
      cStat: '999',
      xMotivo: 'Certificado nao autorizado',
      ultNsu: 0n,
      maxNsu: 20n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.runNowCpfViaSefazGlobal();

    expect(result.failures).toBe(1);
    expect(result.failureDetails).toEqual([
      expect.objectContaining({
        kind: 'controle',
        status: 'falha',
        cnpjConsulta: '01861020970',
        mensagem: 'Certificado nao autorizado'
      })
    ]);
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-cpf' },
        data: expect.objectContaining({ status: NfeSyncStatus.erro_api })
      })
    );
  });

  it.each([
    ['137', NfeSyncStatus.ativo],
    ['656', NfeSyncStatus.erro_api]
  ] as const)('respeita a pausa de uma hora depois de cStat %s', async (cStat, expectedStatus) => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    const control = {
      id: 'ctrl-cpf-pausa',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      ultimoNsuConsultado: 10n,
      ultimoNsuDistribuido: 10n,
      maxNsu: 10n,
      status: NfeSyncStatus.ativo,
      ultimaExecucao: null,
      ultimaMensagem: null
    };
    prisma.nfeSyncControle.findMany
      .mockResolvedValueOnce([control])
      .mockResolvedValueOnce([{
        ...control,
        ultimaExecucao: new Date(),
        ultimaMensagem: `cStat ${cStat} - ${cStat === '137' ? 'Sem novos documentos' : 'Consumo indevido'}`
      }]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat,
      xMotivo: cStat === '137' ? 'Nenhum documento localizado' : 'Consumo indevido',
      ultNsu: 10n,
      maxNsu: 10n,
      documents: [],
      rawResponse: { mock: true }
    });

    await service.runNowCpfViaSefazGlobal();
    const secondRun = await service.runNowCpfViaSefazGlobal();

    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledTimes(1);
    expect(prisma.nfeSyncControle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { cnpjConsulta: control.cnpjConsulta, ambiente: control.ambiente },
      data: expect.objectContaining({
        ultimaExecucao: expect.any(Date),
        ultimaMensagem: expect.stringContaining(`cStat ${cStat}`)
      })
    }));
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: control.id },
      data: expect.objectContaining({ status: expectedStatus })
    }));
    expect(secondRun.executionDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'persistido',
        cnpjConsulta: control.cnpjConsulta,
        mensagem: expect.stringContaining('pausada ate')
      })
    ]));
  });

  it('aplica o periodo do mes corrente apenas na busca noturna via Dominio', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T00:00:00.000Z'));
    try {
      (service as unknown as { nightlySweepEnabled: boolean }).nightlySweepEnabled = true;
      (service as unknown as { nightlySweepActiveSlots: string[] }).nightlySweepActiveSlots = ['00:00'];
      (service as unknown as { nightlySweepTimezoneOffsetMinutes: number }).nightlySweepTimezoneOffsetMinutes = 0;
      (service as unknown as { executedNightlySweepKeys: Set<string> }).executedNightlySweepKeys.clear();
      jest.spyOn(service, 'ativarSyncNoNsuAtualParaTodos').mockResolvedValue({
        ambiente: NfeAmbiente.producao,
        clientesProcessados: 0,
        clientesComSucesso: 0,
        controlesCriadosOuReativados: 0,
        controlesInicializados: 0,
        controlesReativados: 0,
        falhas: 0,
        detalhes: []
      });
      prisma.nfeSyncControle.findMany.mockResolvedValue([
        {
          id: 'ctrl-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          cnpjConsulta: '12345678000199',
          ambiente: NfeAmbiente.producao,
          ultimoNsuConsultado: 10n,
          ultimoNsuDistribuido: 10n,
          maxNsu: 10n,
          status: NfeSyncStatus.ativo
        }
      ]);
      (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
        {
          catalogoId: 11,
          codigoEmpresa: 20,
          cnpjEmpresa: '12345678000199',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          dataEmissao: '2026-06-29',
          xmlBase64: Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`,
            'utf8'
          ).toString('base64')
        }
      ]);

      await (service as unknown as { runNightlySweepCycle(): Promise<void> }).runNightlySweepCycle();

      expect(dominioXmlSource.listDocuments).toHaveBeenCalledWith({
        cnpjs: ['12345678000199'],
        codigosEmpresaDominio: [57],
        limit: 500,
        dataEmissaoInicio: '2026-08-01',
        dataEmissaoFim: '2026-08-31',
        chavesAcesso: undefined,
        catalogoIds: [],
        catalogoIdMinExclusive: 10,
        sortDirection: 'asc'
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('roda consulta por chave via catalogo Dominio usando cursor salvo no controle', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio_chave';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '300';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        maxNsu: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 11,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29'
      }
    ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procNFe_v4.00',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.runNowGlobal();

    expect(dominioXmlSource.listCatalog).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 300,
      dataEmissaoInicio: '2026-01-02',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: 10,
      sortDirection: 'asc'
    });
    expect(dominioXmlSource.listDocuments).not.toHaveBeenCalled();
    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 11n,
          ultimoNsuDistribuido: 11n,
          maxNsu: 11n,
          status: NfeSyncStatus.ativo
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1,
      failures: 0,
      executionDetails: [
        {
          kind: 'documento',
          status: 'persistido',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          serie: '1',
          modelo: '55',
          mensagem: 'NF-e consultada por chave e persistida com sucesso'
        }
      ],
      failureDetails: []
    });
  });

  it('consulta chaves de CT-e no catalogo Dominio pelo modulo dedicado e persiste separado de NF-e', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio_chave';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        maxNsu: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 22,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        dataEmissao: '2026-06-29'
      }
    ]);

    const result = await service.runNowGlobal();

    expect(distribuicaoClient.consultarPorChave).not.toHaveBeenCalled();
    expect(cteService.consultarChaveInternal).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao,
      persistir: true,
      tentarEventos: true,
      fallbackDataEmissao: '2026-06-29'
    });
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 22n,
          ultimoNsuDistribuido: 22n,
          maxNsu: 22n,
          status: NfeSyncStatus.ativo
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1,
      failures: 0,
      executionDetails: [
        {
          kind: 'documento',
          status: 'persistido',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 22,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          mensagem: 'CT-e consultado por chave e persistido com sucesso'
        }
      ],
      failureDetails: []
    });
  });

  it('previsualiza apenas chaves pendentes para o overlay de download por chave', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '2';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 999n,
        ultimoNsuDistribuido: 999n,
        maxNsu: 999n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock)
      .mockResolvedValueOnce([
        {
          catalogoId: 21,
          codigoEmpresa: 20,
          cnpjEmpresa: '12345678000199',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          dataEmissao: '2026-01-10'
        },
        {
          catalogoId: 22,
          codigoEmpresa: 20,
          cnpjEmpresa: '12345678000199',
          chaveAcesso: '35260612345678000199550010000002221000002221',
          dataEmissao: '2026-01-11'
        }
      ])
      .mockResolvedValueOnce([
        {
          catalogoId: 23,
          codigoEmpresa: 20,
          cnpjEmpresa: '12345678000199',
          chaveAcesso: '35260612345678000199550010000004561000004561',
          dataEmissao: '2026-01-12'
        }
      ]);
    prisma.nfeDocumento.findUnique
      .mockResolvedValueOnce({ xmlCompletoDisponivel: true })
      .mockResolvedValueOnce({ xmlCompletoDisponivel: true })
      .mockResolvedValueOnce(null);

    const result = await service.previewDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(dominioXmlSource.listCatalog).toHaveBeenNthCalledWith(1, {
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 2,
      dataEmissaoInicio: '2026-01-02',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: undefined,
      sortDirection: 'asc'
    });
    expect(dominioXmlSource.listCatalog).toHaveBeenNthCalledWith(2, {
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 2,
      dataEmissaoInicio: '2026-01-02',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: 22,
      sortDirection: 'asc'
    });

    expect(result).toEqual({
      processed: 1,
      pendingDownloads: 1,
      failures: 0,
      rows: [
        {
          kind: 'documento',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 23,
          chaveAcesso: '35260612345678000199550010000004561000004561',
          modelo: '55',
          mensagem: 'Chave localizada no catalogo Dominio e pronta para download oficial'
        }
      ]
    });
  });

  it('permite retroagir a previsualizacao do download por chave para 2026-01-01', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '2';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 999n,
        ultimoNsuDistribuido: 999n,
        maxNsu: 999n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 24,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000009991000009991',
        dataEmissao: '2026-01-01'
      }
    ]);
    prisma.nfeDocumento.findUnique.mockResolvedValueOnce(null);

    const result = await service.previewDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao,
      dataEmissaoInicio: '2026-01-01'
    });

    expect(dominioXmlSource.listCatalog).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 2,
      dataEmissaoInicio: '2026-01-01',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: undefined,
      sortDirection: 'asc'
    });
    expect(result.pendingDownloads).toBe(1);
  });

  it('ignora CT-e ja armazenado em resumo na previsualizacao do download por chave', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 999n,
        ultimoNsuDistribuido: 999n,
        maxNsu: 999n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 22,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        dataEmissao: '2026-01-11'
      }
    ]);
    prisma.nfeDocumento.findUnique.mockResolvedValueOnce({
      xmlCompletoDisponivel: false,
      resumoDisponivel: true,
      modelo: '57',
      schemaDoc: 'retConsSitCTe_v4.00'
    });

    const result = await service.previewDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(result).toEqual({
      processed: 1,
      pendingDownloads: 0,
      failures: 0,
      rows: []
    });
  });

  it('executa download manual por chave em modo dominio sem trocar a rotina principal', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '300';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 50n,
        ultimoNsuDistribuido: 50n,
        maxNsu: 50n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 11,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29'
      }
    ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procNFe_v4.00',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.executeDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(dominioXmlSource.listCatalog).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 300,
      dataEmissaoInicio: '2026-01-02',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: undefined,
      sortDirection: 'asc'
    });
    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 50n,
          ultimoNsuDistribuido: 50n,
          maxNsu: 50n,
          ultimaMensagem: 'Consulta retroativa manual por chave via catalogo Dominio salvou 1 documento(s)'
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1,
      failures: 0,
      executionDetails: [
        {
          kind: 'documento',
          status: 'persistido',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          serie: '1',
          modelo: '55',
          mensagem: 'NF-e consultada por chave e persistida com sucesso'
        }
      ],
      failureDetails: []
    });
  });

  it('permite retroagir o download manual por chave para 2026-01-01', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '300';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 50n,
        ultimoNsuDistribuido: 50n,
        maxNsu: 50n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 10,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260112345678000199550010000001091000001091',
        dataEmissao: '2026-01-01'
      }
    ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procNFe_v4.00',
          chaveAcesso: '35260112345678000199550010000001091000001091',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260112345678000199550010000001091000001091">
      <ide><mod>55</mod><serie>1</serie><nNF>109</nNF><dhEmi>2026-01-01T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-01-01T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.executeDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao,
      dataEmissaoInicio: '2026-01-01'
    });

    expect(dominioXmlSource.listCatalog).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 300,
      dataEmissaoInicio: '2026-01-01',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: undefined,
      sortDirection: 'asc'
    });
    expect(result.documentsSaved).toBe(1);
  });

  it('continua processando NF-e apos falha individual de CT-e no download manual por chave', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '300';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 50n,
        ultimoNsuDistribuido: 50n,
        maxNsu: 50n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 11,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        dataEmissao: '2026-06-29'
      },
      {
        catalogoId: 12,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29'
      }
    ]);
    cteService.consultarChaveInternal.mockRejectedValueOnce(
      new BadRequestException('Nao foi possivel localizar chave de acesso no retorno da consulta de CT-e')
    );
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procNFe_v4.00',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.executeDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(cteService.consultarChaveInternal).toHaveBeenCalledWith({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao,
      persistir: true,
      tentarEventos: true,
      fallbackDataEmissao: '2026-06-29'
    });
    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1,
      failures: 1,
      executionDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          mensagem: 'Nao foi possivel localizar chave de acesso no retorno da consulta de CT-e'
        },
        {
          kind: 'documento',
          status: 'persistido',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 12,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          serie: '1',
          modelo: '55',
          mensagem: 'NF-e consultada por chave e persistida com sucesso'
        }
      ],
      failureDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          mensagem: 'Nao foi possivel localizar chave de acesso no retorno da consulta de CT-e'
        }
      ]
    });
  });

  it('trata rejeicao da consulta de CT-e como falha e nao como download persistido', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN = '300';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 50n,
        ultimoNsuDistribuido: 50n,
        maxNsu: 50n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([
      {
        catalogoId: 11,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        dataEmissao: '2026-06-29'
      }
    ]);
    cteService.consultarChaveInternal.mockResolvedValueOnce({
      statusCode: 200,
      cStat: '215',
      xMotivo: 'Rejeicao: XML Mal Formado',
      requestedChave: '42260795849600000135570010000319691243772228',
      persistido: true,
      consultaValida: false,
      documentosEncontrados: 1,
      documentosPersistidos: 0,
      eventosEncontrados: 0,
      eventosPersistidos: 0,
      documentos: [{ schema: 'retConsSitCTe_v4.00', chaveAcesso: '42260795849600000135570010000319691243772228' }]
    });

    const result = await service.executeDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 0,
      failures: 1,
      executionDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          mensagem: 'Consulta por chave retornou cStat 215: Rejeicao: XML Mal Formado'
        }
      ],
      failureDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          mensagem: 'Consulta por chave retornou cStat 215: Rejeicao: XML Mal Formado'
        }
      ]
    });
  });

  it('mantem consulta automatica de CPF na SEFAZ no modo dominio_chave', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio_chave';
    const runNowGlobalSpy = jest.spyOn(service, 'runNowGlobal');
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-cpf',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '01861020970',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 0n,
        ultimoNsuDistribuido: 0n,
        maxNsu: 1n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 0n,
      maxNsu: 1n,
      documents: [],
      rawResponse: { mock: true }
    });

    await (service as unknown as { runAutomaticSyncCycle(): Promise<void> }).runAutomaticSyncCycle();
    await (service as unknown as { runNightlySweepCycle(): Promise<void> }).runNightlySweepCycle();

    expect(runNowGlobalSpy).not.toHaveBeenCalled();
    expect(prisma.nfeSyncControle.findMany).toHaveBeenCalledTimes(2);
    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(
      expect.objectContaining({ cnpjConsulta: '01861020970' })
    );
    expect(dominioXmlSource.listCatalog).not.toHaveBeenCalled();
  });

  it('continua importacao de NF-e quando a tabela nfe_eventos nao existe', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    prisma.nfeDocumento.findUnique
      .mockRejectedValueOnce(new Error('The table `public.nfe_eventos` does not exist in the current database.'))
      .mockResolvedValueOnce(null);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documentos localizados',
      ultNsu: 11n,
      maxNsu: 99n,
      documents: [
        {
          nsu: 11n,
          schema: 'procNFe_v4.00',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.runNow({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(prisma.nfeDocumento.upsert).toHaveBeenCalled();
    expect(result.documentsSaved).toBe(1);
  });

  it('roda execucao global com controles ativos e em erro_api para permitir retentativa', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '137',
      xMotivo: 'Sem novos documentos',
      ultNsu: 10n,
      maxNsu: 10n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.runNowGlobal();

    expect(prisma.nfeSyncControle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cliente: {
            ativo: true,
            nfeHabilitado: true
          },
          status: {
            in: [NfeSyncStatus.ativo, NfeSyncStatus.erro_api]
          }
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 0,
      failures: 0,
      executionDetails: [expect.objectContaining({
        status: 'persistido',
        cnpjConsulta: '12345678000199',
        mensagem: expect.stringContaining('pausada ate')
      })],
      failureDetails: [],
      sefazDiagnostics: [expect.objectContaining({
        method: 'distNSU',
        clientMode: 'mock',
        actorType: 'CNPJ',
        cStat: '137',
        documentsReceived: 0,
        documentsProcessed: 0
      })]
    });
  });

  it('retorna detalhes das falhas de importacao via Dominio para o painel', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        maxNsu: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    storage.putObject.mockRejectedValueOnce(new Error('Falha ao salvar XML no storage'));
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 11,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.runNowGlobal();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 0,
      failures: 1,
      executionDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          serie: '1',
          modelo: '55',
          mensagem: 'Falha ao salvar XML no storage'
        }
      ],
      failureDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 11,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          serie: '1',
          modelo: '55',
          mensagem: 'Falha ao salvar XML no storage'
        }
      ]
    });
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          status: NfeSyncStatus.erro_api
        })
      })
    );
  });

  it('retorna numero da NF-e no detalhe da falha quando o XML nao possui chave de acesso', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio';
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        maxNsu: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 22,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: undefined,
        dataEmissao: '2026-06-29',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe>
      <ide><mod>55</mod><serie>3</serie><nNF>987</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
    </infNFe>
  </NFe>
</nfeProc>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.runNowGlobal();

    expect(result).toEqual({
      processed: 1,
      documentsSaved: 0,
      failures: 1,
      executionDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 22,
          chaveAcesso: undefined,
          numeroNfe: '987',
          serie: '3',
          modelo: '55',
          mensagem: 'Nao foi possivel localizar chave de acesso no XML da NF-e'
        }
      ],
      failureDetails: [
        {
          kind: 'documento',
          status: 'falha',
          clientId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          cnpjConsulta: '12345678000199',
          catalogoId: 22,
          chaveAcesso: undefined,
          numeroNfe: '987',
          serie: '3',
          modelo: '55',
          mensagem: 'Nao foi possivel localizar chave de acesso no XML da NF-e'
        }
      ]
    });
  });

  it('busca XML bruto da Dominio por ID de catalogo', async () => {
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([
      {
        catalogoId: 77,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: undefined,
        dataEmissao: '2026-06-29',
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe>
      <ide><mod>55</mod><serie>9</serie><nNF>321</nNF></ide>
    </infNFe>
  </NFe>
</nfeProc>`,
          'utf8'
        ).toString('base64')
      }
    ]);

    const result = await service.getDominioXml({
      clienteId: 'cliente-1',
      catalogoId: 77
    });

    expect(dominioXmlSource.listDocuments).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      codigosEmpresaDominio: [57],
      limit: 10,
      dataEmissaoInicio: undefined,
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [77],
      catalogoIdMinExclusive: undefined,
      sortDirection: undefined
    });
    expect(result).toMatchObject({
      catalogoId: 77,
      numeroNfe: '321',
      serie: '9',
      modelo: '55',
      fileName: 'DOMINIO-NFE-77.xml',
      contentType: 'application/xml'
    });
    expect(result.xml).toContain('<nNF>321</nNF>');
  });

  it('lista NF-e recebidas por cnpjConsulta', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([]);

    await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '12345678000199',
      tipoRelacao: 'recebidas'
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ clienteId: 'cliente-1' }, { cnpjDestinatario: '12345678000199' }])
        })
      })
    );
  });

  it('rejeita importacao manual de CT-e no modulo de NF-e', async () => {
    await expect(
      service.importXml({
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        xmlBase64: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe42260795849600000135570010000319691243772228">
      <ide>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>31969</nCT>
      </ide>
    </infCte>
  </CTe>
  <protCTe><infProt><chCTe>42260795849600000135570010000319691243772228</chCTe></infProt></protCTe>
</cteProc>`,
          'utf8'
        ).toString('base64')
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
  });

  it('consulta um NSU especifico e persiste documento retornado', async () => {
    (distribuicaoClient.consultarPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 15n,
      maxNsu: 99n,
      documents: [
        {
          nsu: 15n,
          schema: 'procNFe_v4.00',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.consultarNsu({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nsu: '15',
      ambiente: NfeAmbiente.producao
    });

    expect(distribuicaoClient.consultarPorNsu).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      nsu: 15n,
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      requestedNsu: '15',
      persistido: true,
      documentosEncontrados: 1,
      documentosPersistidos: 1
    });
  });

  it('consulta por chave sem persistir quando persistir=false', async () => {
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'resNFe_v1.01.xsd',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>35260612345678000199550010000001231000001231</chNFe>
  <CNPJ>12345678000199</CNPJ>
  <xNome>Fornecedor Teste</xNome>
  <IE>123456789</IE>
  <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
  <tpNF>0</tpNF>
  <vNF>88.15</vNF>
  <dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto>
  <nProt>135260000000001</nProt>
  <cSitNFe>1</cSitNFe>
</resNFe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.consultarChave({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      ambiente: NfeAmbiente.producao,
      persistir: false
    });

    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requestedChave: '35260612345678000199550010000001231000001231',
      persistido: false,
      documentosEncontrados: 1,
      documentosPersistidos: 0
    });
  });

  it('sincroniza eventos de cancelamento para NF-e ja armazenada', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValueOnce({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procEventoNFe_v1.00.xsd',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00">
    <infEvento Id="ID1101113526061234567800019955001000000123100000123101">
      <CNPJ>12345678000199</CNPJ>
      <chNFe>35260612345678000199550010000001231000001231</chNFe>
      <dhEvento>2026-07-13T14:10:00-03:00</dhEvento>
      <tpEvento>110111</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento versao="1.00">
        <descEvento>Cancelamento</descEvento>
      </detEvento>
    </infEvento>
  </evento>
</procEventoNFe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledWith({
      cnpjConsulta: '12345678000199',
      cUfAutor: '42',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '35260612345678000199550010000001231000001231',
          modelo: '55',
          status: 'Cancelada'
        })
      })
    );
    expect(prisma.nfeEvento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nfeDocumentoId_tipoEvento_dataEvento_hashXml: expect.objectContaining({
            nfeDocumentoId: 'doc-1',
            tipoEvento: '110111'
          })
        })
      })
    );
    expect(result).toMatchObject({
      documentosProcessados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 1,
      eventosImportados: 1,
      falhas: 0
    });
  });

  it('classifica evento com tpAmb=2 como homologacao', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValueOnce({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procEventoNFe_v1.00.xsd',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00">
    <infEvento Id="ID1101113526061234567800019955001000000123100000123101">
      <tpAmb>2</tpAmb>
      <CNPJ>12345678000199</CNPJ>
      <chNFe>35260612345678000199550010000001231000001231</chNFe>
      <dhEvento>2026-07-13T14:10:00-03:00</dhEvento>
      <tpEvento>110111</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento versao="1.00">
        <descEvento>Cancelamento</descEvento>
      </detEvento>
    </infEvento>
  </evento>
</procEventoNFe>`
        }
      ],
      rawResponse: { mock: true }
    });

    await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining(
        'nfe/homologacao/12345678000199/2026/07/eventos/35260612345678000199550010000001231000001231_110111_1.xml'
      ),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ambiente_chaveAcesso: {
            ambiente: NfeAmbiente.homologacao,
            chaveAcesso: '35260612345678000199550010000001231000001231'
          }
        },
        create: expect.objectContaining({
          ambiente: NfeAmbiente.homologacao
        })
      })
    );
  });

  it('sincroniza eventos de CT-e usando o filtro compartilhado', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-cte-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: '31969',
        modelo: '57',
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValueOnce({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procEventoCTe_v4.00.xsd',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento Id="ID1101114226079584960000013557001000031969124377222801">
      <CNPJ>12345678000199</CNPJ>
      <chCTe>42260795849600000135570010000319691243772228</chCTe>
      <dhEvento>2026-07-13T14:15:00-03:00</dhEvento>
      <tpEvento>110111</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento versaoEvento="4.00">
        <descEvento>Cancelamento</descEvento>
      </detEvento>
    </infEvento>
  </eventoCTe>
</procEventoCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventosDocumentos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-cte-1'],
      somenteSemEventos: false,
      limit: 1,
      filtro: 'cte'
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([expect.objectContaining({ modelo: '57' })])
            }),
            { clienteId: 'cliente-1' },
            { id: { in: ['doc-cte-1'] } }
          ])
        })
      })
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          status: 'Cancelada'
        })
      })
    );
    expect(result).toMatchObject({
      documentosProcessados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 1,
      eventosImportados: 1,
      falhas: 0
    });
  });

  it('continua sincronizacao manual de eventos quando a tabela nfe_eventos nao existe', async () => {
    prisma.nfeDocumento.findMany
      .mockRejectedValueOnce(new Error('The table `public.nfe_eventos` does not exist in the current database.'))
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          origem: 'distribuicao_nsu'
        }
      ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValueOnce({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: true,
      limit: 1
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledTimes(2);
    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0
    });
  });

  it('continua sincronizacao manual de eventos quando o erro cita o model NfeEvento', async () => {
    prisma.nfeDocumento.findMany
      .mockRejectedValueOnce(new Error('The table `public.NfeEvento` does not exist in the current database.'))
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          origem: 'distribuicao_nsu'
        }
      ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValueOnce({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: true,
      limit: 1
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      documentosProcessados: 1,
      falhas: 0
    });
  });

  it('infere clienteId a partir do documento quando a sincronizacao manual nao recebe o cliente no body', async () => {
    prisma.nfeDocumento.findMany
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1'
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123',
          origem: 'distribuicao_nsu',
          eventos: []
        }
      ]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValueOnce({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventos({
      clienteId: '' as string,
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(prisma.cliente.findUnique).toHaveBeenCalledWith({
      where: { id: 'cliente-1' }
    });
    expect(result).toMatchObject({
      documentosProcessados: 1,
      falhas: 0
    });
  });

  it('retorna falha de certificado quando o arquivo criptografado nao existe no storage local', async () => {
    storage.hasObject.mockResolvedValue(false);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 1,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroDocumento: '123',
          status: 'falha_certificado',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem:
            'Arquivo do certificado selecionado (Certificado Principal) nao encontrado no storage local para o CNPJ 12345678000199. Caminho esperado: certificados/cliente-1/cert-1.bin. Recadastre ou restaure esse certificado.'
        }
      ]
    });
  });

  it('retorna falha estruturada quando a preparacao da sincronizacao manual quebra antes do loop', async () => {
    prisma.nfeDocumento.findMany
      .mockRejectedValueOnce(new Error('boom na consulta inicial'))
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroNfe: '123'
        }
      ]);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 1,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroDocumento: '123',
          status: 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: 'boom na consulta inicial'
        }
      ]
    });
  });

  it('executa diagnostico consChNFe para CPF e nao expoe chave ou CPF no log', async () => {
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'real';
    storage.getObject.mockResolvedValue(Buffer.from('{}'));
    const control = {
      id: 'ctrl-cpf',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '01861020970',
      ambiente: NfeAmbiente.producao,
      status: 'ativo',
      ultimoNsuConsultado: 10n,
      ultimoNsuDistribuido: 10n,
      maxNsu: 10n,
      ultimaExecucao: null,
      ultimaMensagem: null
    };
    prisma.nfeSyncControle.findFirst.mockResolvedValue(control);
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-1', clienteId: 'cliente-1', cnpj: '01861020970', municipioCodigoIbge: '4204202'
    });
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cnpjTitular: '01861020970',
      ativo: true, arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
    }]);
    const chaveAcesso = '4'.repeat(44);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [],
      rawResponse: { mock: true }
    });
    const logger = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.startSefazDiagnosticMode({ controleId: control.id, certificadoId: 'cert-1' });
    const response = await service.executeSefazDiagnosticQuery({ method: 'consChNFe', chaveAcesso });

    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledWith(expect.objectContaining({
      cnpjConsulta: '01861020970',
      chaveAcesso,
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    }));
    expect(response.diagnostic).toMatchObject({ method: 'consChNFe', actorType: 'CPF', cStat: '138', documentsReceived: 0, processingResult: 'concluido' });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('01861020970');
    expect(JSON.stringify(logger.mock.calls)).not.toContain(chaveAcesso);
  });

  it('executa diagnostico distNSU para CNPJ, persiste os documentos e avanca somente o cursor salvo', async () => {
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'real';
    storage.getObject.mockResolvedValue(Buffer.from('{}'));
    const control = {
      id: 'ctrl-cnpj',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '12345678000199',
      ambiente: NfeAmbiente.producao,
      status: 'ativo',
      ultimoNsuConsultado: 5n,
      ultimoNsuDistribuido: 5n,
      maxNsu: 10n,
      ultimaExecucao: null,
      ultimaMensagem: null
    };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe35260612345678000199550010000001231000001231" versao="4.00">
    <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
    <dest><CNPJ>99888777000166</CNPJ><xNome>Destinatario Teste</xNome></dest>
    <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
  </infNFe></NFe>
  <protNFe><infProt><cStat>100</cStat><xMotivo>Autorizado</xMotivo><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`;
    prisma.nfeSyncControle.findFirst.mockResolvedValue(control);
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cnpjTitular: control.cnpjConsulta,
      ativo: true, arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
    }]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado',
      ultNsu: 6n,
      maxNsu: 10n,
      documents: [{ nsu: 6n, schema: 'procNFe_v4.00', xml }],
      documentExtraction: { docZipCount: 1, discardedCount: 0, schemaCounts: { procNFe_v4_00: 1 } },
      rawResponse: { mock: true }
    });

    await service.startSefazDiagnosticMode({ controleId: control.id, certificadoId: 'cert-1' });
    const response = await service.executeSefazDiagnosticQuery({ method: 'distNSU' });

    expect(distribuicaoClient.distribuirPorNsu).toHaveBeenCalledWith(expect.objectContaining({
      cnpjConsulta: '12345678000199', ultNsu: 5n, certificateId: 'cert-1'
    }));
    expect(response).toMatchObject({ cursorAdvanced: true, documentsPersisted: 1 });
    expect(response.diagnostic).toMatchObject({ method: 'distNSU', actorType: 'CNPJ', documentsReceived: 1, documentsProcessed: 1, processingResult: 'concluido' });
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ctrl-cnpj' },
      data: expect.objectContaining({ ultimoNsuConsultado: 6n, ultimoNsuDistribuido: 6n, maxNsu: 10n })
    }));
  });

  it('nao permite ao modo de diagnostico contornar cStat 137 no distNSU, e diferencia consulta pontual por chave', async () => {
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'real';
    storage.getObject.mockResolvedValue(Buffer.from('{}'));
    const control = {
      id: 'ctrl-137',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cnpjConsulta: '12345678000199',
      ambiente: NfeAmbiente.producao,
      status: 'ativo',
      ultimoNsuConsultado: 5n,
      ultimoNsuDistribuido: 5n,
      maxNsu: 10n,
      ultimaExecucao: new Date(),
      ultimaMensagem: 'cStat 137 - Sem novos documentos'
    };
    prisma.nfeSyncControle.findFirst.mockResolvedValue(control);
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cnpjTitular: control.cnpjConsulta,
      ativo: true, arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
    }]);
    (distribuicaoClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200, cStat: '137', xMotivo: 'Nenhum documento localizado', ultNsu: 0n, maxNsu: 0n, documents: []
    });
    await service.startSefazDiagnosticMode({ controleId: control.id, certificadoId: 'cert-1' });

    await expect(service.executeSefazDiagnosticQuery({ method: 'distNSU' })).rejects.toBeInstanceOf(BadRequestException);
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    const keyResult = await service.executeSefazDiagnosticQuery({ method: 'consChNFe', chaveAcesso: '4'.repeat(44) });
    expect(distribuicaoClient.consultarPorChave).toHaveBeenCalledTimes(1);
    expect(keyResult.diagnostic.processingResult).toBe('sem_documentos');
  });

  it('nao permite ao modo de diagnostico contornar cStat 656 em nenhum metodo', async () => {
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'real';
    const control = {
      id: 'ctrl-656', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cnpjConsulta: '12345678000199',
      ambiente: NfeAmbiente.producao, status: 'ativo', ultimoNsuConsultado: 5n, ultimoNsuDistribuido: 5n,
      maxNsu: 10n, ultimaExecucao: new Date(), ultimaMensagem: 'cStat 656 - Consumo indevido'
    };
    prisma.nfeSyncControle.findFirst.mockResolvedValue(control);
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cnpjTitular: control.cnpjConsulta,
      ativo: true, arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
    }]);
    await service.startSefazDiagnosticMode({ controleId: control.id, certificadoId: 'cert-1' });

    await expect(service.executeSefazDiagnosticQuery({ method: 'distNSU' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.executeSefazDiagnosticQuery({ method: 'consChNFe', chaveAcesso: '4'.repeat(44) }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(distribuicaoClient.distribuirPorNsu).not.toHaveBeenCalled();
    expect(distribuicaoClient.consultarPorChave).not.toHaveBeenCalled();
  });

  it('permite consChNFe durante um cooldown interno de cursor incremental', () => {
    const control = { ultimaExecucao: new Date(), ultimaMensagem: 'Consulta SEFAZ sem avancar o NSU 10: ultNSU retornado 10.' };
    expect((service as any).getSefazDfeCooldownUntil(control, 'distNSU')).toBeInstanceOf(Date);
    expect((service as any).getSefazDfeCooldownUntil(control, 'consChNFe')).toBeNull();
  });

  it('limita consChNFe/consNSU a 20 chamadas por ator por hora', async () => {
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'real';
    let quotaFile = Buffer.from('{}');
    storage.getObject.mockImplementation(async () => quotaFile);
    storage.putObject.mockImplementation(async (_key: string, content: Buffer | string) => {
      quotaFile = (Buffer.isBuffer(content) ? content : Buffer.from(content)) as typeof quotaFile;
      return 'settings/nfe-sefaz-point-query-quota.json';
    });

    for (let index = 0; index < 20; index += 1) {
      await (service as any).reserveOfficialPointQuery('01861020970', NfeAmbiente.producao);
    }
    await expect((service as any).reserveOfficialPointQuery('01861020970', NfeAmbiente.producao))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
