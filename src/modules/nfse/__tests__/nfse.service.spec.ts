import { Ambiente } from '@prisma/client';
import JSZip from 'jszip';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/storage.service';
import { NfseDanfseService } from '../nfse-danfse.service';
import { NfseService } from '../nfse.service';
import { NfseXmlParserService } from '../nfse-xml-parser.service';

describe('NfseService', () => {
  const prisma = {
    clienteEstabelecimento: {
      findFirst: jest.fn()
    },
    nfseDocumento: {
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn()
    },
    nfseEvento: {
      upsert: jest.fn()
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

  const parser = new NfseXmlParserService();
  const danfse = new NfseDanfseService();

  const service = new NfseService(
    prisma as unknown as PrismaService,
    parser,
    storage as unknown as LocalStorageService,
    danfse,
    adnClient
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.clienteEstabelecimento.findFirst.mockResolvedValue(undefined);
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
        AND: expect.arrayContaining([{ clienteId: 'cliente-1' }])
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
      totalPages: 3
    });
  });

  it('ignora page/pageSize e usa o limite de seguranca quando all=true', async () => {
    prisma.nfseDocumento.count.mockResolvedValueOnce(245);
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
    expect(result).toEqual({
      items: [],
      total: 245,
      page: 1,
      pageSize: 10000,
      totalPages: 1
    });
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
    prisma.nfseDocumento.groupBy
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

    const result = await service.getDashboardStats({});

    expect(prisma.nfseDocumento.count).toHaveBeenNthCalledWith(1, { where: {} });
    expect(prisma.nfseDocumento.count).toHaveBeenNthCalledWith(2, {
      where: {
        xmlPath: {
          not: null
        }
      }
    });
    expect(prisma.nfseDocumento.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['clienteId'],
      where: {},
      _count: {
        _all: true
      }
    });
    expect(prisma.nfseDocumento.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['clienteId'],
      where: {
        xmlPath: {
          not: null
        }
      },
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

    storage.getObject.mockResolvedValueOnce(Buffer.from('<NFSe><nNFSe>2</nNFSe></NFSe>', 'utf8'));
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

    storage.getObject.mockResolvedValueOnce(
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

    storage.getObject.mockResolvedValueOnce(Buffer.from('<NFSe><nNFSe>333</nNFSe></NFSe>', 'utf8'));
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
    prisma.nfseDocumento.upsert.mockResolvedValue({
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

    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          nsu: null
        }),
        create: expect.objectContaining({
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
    prisma.nfseDocumento.upsert.mockResolvedValue({
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
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ambiente_chaveAcesso: {
            ambiente: Ambiente.producao_restrita,
            chaveAcesso: '42110092206960810000176000000000033326062205552016'
          }
        },
        update: expect.objectContaining({
          nsu: null,
          status: 'cancelada',
          dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
          danfsePath: null
        }),
        create: expect.objectContaining({
          nsu: null
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
    prisma.nfseDocumento.upsert.mockResolvedValue({
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
    expect(prisma.nfseDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
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
});
