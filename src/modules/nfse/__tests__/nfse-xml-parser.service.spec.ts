import { NfseXmlParserService } from '../nfse-xml-parser.service';

describe('NfseXmlParserService', () => {
  const parser = new NfseXmlParserService();

  it('parseia chave de acesso e campos basicos', () => {
    const xml = `<?xml version="1.0"?><NFSe><chaveAcesso>123</chaveAcesso><numeroNFSe>77</numeroNFSe><dataEmissao>2026-05-18T00:00:00Z</dataEmissao></NFSe>`;

    const parsed = parser.parse(xml);

    expect(parsed.chaveAcesso).toBe('123');
    expect(parsed.numeroNfse).toBe('77');
    expect(parsed.dataEmissao?.toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });

  it('gera hash estavel', () => {
    const hash1 = parser.getHash('<a>1</a>');
    const hash2 = parser.getHash('<a>1</a>');
    expect(hash1).toBe(hash2);
  });

  it('falha sem chave de acesso', () => {
    expect(() => parser.parse('<NFSe></NFSe>')).toThrow('Nao foi possivel localizar chave de acesso no XML');
  });

  it('parseia XML nacional com namespace e campos ampliados', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42167012244454248000106000000000002924081114719252">
    <xLocPrestacao>Mondai</xLocPrestacao>
    <nNFSe>29</nNFSe>
    <cStat>100</cStat>
    <dhProc>2024-08-01T11:08:50-03:00</dhProc>
    <emit>
      <CNPJ>44454248000106</CNPJ>
      <xNome>44.454.248 TASSIANI BASEGGIO</xNome>
    </emit>
    <DPS>
      <infDPS>
        <serie>900</serie>
        <dhEmi>2024-08-01T11:08:50-03:00</dhEmi>
        <dCompet>2024-08-01</dCompet>
        <toma>
          <CNPJ>06960810000176</CNPJ>
          <xNome>GCONT GESTAO CONTABIL E EMPRESARIAL LTDA</xNome>
        </toma>
        <serv>
          <locPrest>
            <cLocPrestacao>4211009</cLocPrestacao>
          </locPrest>
          <cServ>
            <cTribNac>170101</cTribNac>
            <xDescServ>servico de consultoria</xDescServ>
          </cServ>
        </serv>
        <valores>
          <vServPrest>
            <vServ>1720.00</vServ>
          </vServPrest>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

    const parsed = parser.parse(xml);

    expect(parsed.chaveAcesso).toBe('42167012244454248000106000000000002924081114719252');
    expect(parsed.numeroNfse).toBe('29');
    expect(parsed.serie).toBe('900');
    expect(parsed.status).toBe('100');
    expect(parsed.cnpjPrestador).toBe('44454248000106');
    expect(parsed.razaoSocialPrestador).toContain('TASSIANI');
    expect(parsed.cnpjTomador).toBe('06960810000176');
    expect(parsed.razaoSocialTomador).toContain('GCONT');
    expect(parsed.municipioPrestacaoCodigo).toBe('4211009');
    expect(parsed.municipioPrestacaoNome).toBe('Mondai');
    expect(parsed.codigoServicoNacional).toBe('170101');
    expect(parsed.valorServico).toBe('1720.00');
    expect(parsed.descricaoServico).toContain('consultoria');
    expect(parsed.competencia?.toISOString()).toBe('2024-08-01T00:00:00.000Z');
  });
});
