import { Ambiente } from '@prisma/client';
import JSZip from 'jszip';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/storage.service';
import { NfseDanfseService } from '../nfse-danfse.service';
import { NfseService } from '../nfse.service';
import { NfseXmlParserService } from '../nfse-xml-parser.service';

describe('NfseService', () => {
  const prisma = {
    nfseDocumento: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn()
    },
    nfseEvento: {
      upsert: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn(),
    putObject: jest.fn()
  };

  const parser = new NfseXmlParserService();
  const danfse = new NfseDanfseService();

  const service = new NfseService(
    prisma as unknown as PrismaService,
    parser,
    storage as unknown as LocalStorageService,
    danfse
  );

  beforeEach(() => {
    jest.clearAllMocks();
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

    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-cancelada',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      ambiente: Ambiente.producao,
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      cnpjPrestador: '06960810000176',
      cnpjTomador: null
    });
    prisma.nfseDocumento.upsert.mockResolvedValue({
      id: 'doc-cancelada',
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      origem: 'importacao_xml',
      status: 'cancelada',
      dataCancelamento: new Date('2026-06-03T18:43:08.000Z'),
      xmlPath: 'nfse/producao/06960810000176/2026/06/xml/42110092206960810000176000000000033326062205552016.xml',
      danfsePath: null
    });
    prisma.nfseEvento.upsert.mockResolvedValue({
      id: 'evento-1',
      tipoEvento: 'e101101',
      xmlPath: 'nfse/producao/06960810000176/2026/06/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'
    });

    const result = await service.importXml({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      xml: eventXml,
      ambiente: 'producao'
    });

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/eventos/42110092206960810000176000000000033326062205552016_e101101.xml'),
      eventXml
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
    expect(prisma.nfseEvento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          nfseDocumentoId: 'doc-cancelada',
          chaveAcesso: '42110092206960810000176000000000033326062205552016',
          tipoEvento: 'e101101'
        })
      })
    );
    expect(result).toMatchObject({
      id: 'doc-cancelada',
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      tipo: 'evento',
      eventoId: 'evento-1',
      tipoEvento: 'e101101',
      status: 'cancelada'
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
        updatedAt: new Date('2026-01-10T00:00:00.000Z')
      }
    ]);

    storage.getObject.mockResolvedValue(Buffer.from('<xml>doc-10</xml>', 'utf8'));

    const result = await service.downloadLote({
      ids: ['550e8400-e29b-41d4-a716-446655440010'],
      tipoArquivo: 'xml',
      clienteId: '550e8400-e29b-41d4-a716-446655440001'
    });

    expect(result.contentType).toBe('application/zip');
    expect(result.totalArquivosIncluidos).toBe(1);
    expect(result.idsNaoEncontrados).toEqual([]);
    expect(result.erros).toEqual([]);

    const zipBuffer = Buffer.from(result.contentBase64, 'base64');
    const zip = await JSZip.loadAsync(zipBuffer);
    const xmlEntry = zip.file('xml/NFSE-42110092206960810000176000000000001026016992784180.xml');
    const manifestEntry = zip.file('manifest.json');

    expect(xmlEntry).toBeTruthy();
    expect(manifestEntry).toBeTruthy();

    const xmlContent = await xmlEntry!.async('string');
    expect(xmlContent).toBe('<xml>doc-10</xml>');
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
