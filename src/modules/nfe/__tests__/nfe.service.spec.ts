import { NfeAmbiente, NfeSyncStatus, NfeTipoRelacao, Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
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
    hasObject: jest.fn()
  };

  const nfseService = {
    importXml: jest.fn()
  };

  const cteService = {
    consultarChaveInternal: jest.fn()
  };

  const distribuicaoClient: NfeDistribuicaoClient = {
    distribuirPorNsu: jest.fn(),
    consultarPorNsu: jest.fn(),
    consultarPorChave: jest.fn()
  };

  const dominioXmlSource: DominioNfeXmlSource = {
    listDocuments: jest.fn(),
    listCatalog: jest.fn()
  };

  const service = new NfeService(
    prisma as unknown as PrismaService,
    new NfeXmlParserService(),
    nfseService as unknown as NfseModuleService,
    storage as unknown as LocalStorageService,
    cteService as unknown as CteService,
    distribuicaoClient,
    dominioXmlSource
  );

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NFE_SYNC_SOURCE_MODE;
    delete process.env.NFE_DOMINIO_IMPORT_LIMIT_PER_RUN;
    prisma.cliente.findUnique.mockResolvedValue({ id: 'cliente-1', nfeHabilitado: true });
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
    cteService.consultarChaveInternal.mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'Autorizado o uso do CT-e',
      requestedChave: '42260795849600000135570010000319691243772228',
      persistido: true,
      documentosEncontrados: 1,
      documentosPersistidos: 1,
      eventosEncontrados: 0,
      eventosPersistidos: 0,
      documentos: [{ schema: 'cteProc_v4.00', chaveAcesso: '42260795849600000135570010000319691243772228' }]
    });
    storage.putObject.mockResolvedValue(undefined);
    storage.hasObject.mockResolvedValue(true);
    (dominioXmlSource.listDocuments as jest.Mock).mockResolvedValue([]);
    (dominioXmlSource.listCatalog as jest.Mock).mockResolvedValue([]);
  });

  it('pagina a listagem de NF-e armazenadas', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(275);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      page: 2,
      pageSize: 100
    });

    expect(prisma.nfeDocumento.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ clienteId: 'cliente-1' }])
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
      limit: undefined,
      dataEmissaoInicio: undefined,
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: undefined,
      sortDirection: undefined
    });
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledTimes(1);
    expect(result.xmlsEncontrados).toBe(1);
    expect(result.xmlsPersistidos).toBe(1);
    expect(result.falhas).toBe(0);
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
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 528449,
          status: 'persistido',
          mensagem: 'XML da Dominio identificado como NFS-e e importado com sucesso no armazenamento de servicos'
        })
      ])
    );
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
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 525833,
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

  it('ignora XML de CT-e retornado pela Dominio sem tentar persistir como NF-e', async () => {
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

    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(nfseService.importXml).not.toHaveBeenCalled();
    expect(result.xmlsPersistidos).toBe(0);
    expect(result.falhas).toBe(0);
    expect(result.detalhes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogoId: 600001,
          status: 'ignorado_xml_cte',
          mensagem: 'XML da Dominio ignorado por se tratar de CT-e; use um fluxo dedicado para documentos de transporte'
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
      failureDetails: []
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
      tentarEventos: true
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
        catalogoId: 21,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        dataEmissao: '2026-06-29'
      },
      {
        catalogoId: 22,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '35260612345678000199550010000004561000004561',
        dataEmissao: '2026-06-30'
      },
      {
        catalogoId: 23,
        codigoEmpresa: 20,
        cnpjEmpresa: '12345678000199',
        chaveAcesso: '',
        dataEmissao: '2026-06-30'
      }
    ]);
    prisma.nfeDocumento.findUnique
      .mockResolvedValueOnce({ xmlCompletoDisponivel: true })
      .mockResolvedValueOnce(null);

    const result = await service.previewDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
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
          catalogoId: 22,
          chaveAcesso: '35260612345678000199550010000004561000004561',
          modelo: '55',
          mensagem: 'Chave localizada no catalogo Dominio e pronta para download oficial'
        }
      ]
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

    const result = await service.executeDownloadByKey({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(dominioXmlSource.listCatalog).toHaveBeenCalledWith({
      cnpjs: ['12345678000199'],
      limit: 300,
      dataEmissaoInicio: '2026-01-02',
      dataEmissaoFim: undefined,
      chavesAcesso: undefined,
      catalogoIds: [],
      catalogoIdMinExclusive: 10,
      sortDirection: 'asc'
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

  it('nao executa dominio_chave nos ciclos automaticos e noturnos', async () => {
    process.env.NFE_SYNC_SOURCE_MODE = 'dominio_chave';
    const runNowGlobalSpy = jest.spyOn(service, 'runNowGlobal');

    await (service as unknown as { runAutomaticSyncCycle(): Promise<void> }).runAutomaticSyncCycle();
    await (service as unknown as { runNightlySweepCycle(): Promise<void> }).runNightlySweepCycle();

    expect(runNowGlobalSpy).not.toHaveBeenCalled();
    expect(prisma.nfeSyncControle.findMany).not.toHaveBeenCalled();
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
      executionDetails: [],
      failureDetails: []
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
});
