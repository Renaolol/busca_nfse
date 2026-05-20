import { Ambiente } from '@prisma/client';
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
      chaveAcesso: '42110092206960810000176000000000000126019687178145',
      xmlPath: 'nfse/producao/123/2026/05/xml/a.xml'
    });
    storage.getObject.mockResolvedValue(Buffer.from('<xml>conteudo</xml>', 'utf8'));

    const result = await service.getXml('doc-1');

    expect(result.fileName).toBe('NFSE-42110092206960810000176000000000000126019687178145.xml');
    expect(result.contentType).toBe('application/xml');
    expect(result.contentBase64).toBe(Buffer.from('<xml>conteudo</xml>', 'utf8').toString('base64'));
    expect(result.xml).toBe('<xml>conteudo</xml>');
  });

  it('gera DANFSE quando nao existir caminho salvo', async () => {
    prisma.nfseDocumento.findUnique.mockResolvedValue({
      id: 'doc-2',
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

    const result = await service.getDanfse('doc-2');

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

    const result = await service.getDanfse('doc-4');

    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/danfse/42110092206960810000176000000000000426016992784181.pdf'),
      expect.any(Buffer)
    );
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentBase64.length).toBeGreaterThan(20);
  });
});
