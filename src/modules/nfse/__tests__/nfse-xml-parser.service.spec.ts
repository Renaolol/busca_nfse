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

  it('parseia evento nacional de cancelamento e vincula pela chave da NFS-e', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
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

    const parsed = parser.parseAny(xml);

    expect(parsed.kind).toBe('evento');
    if (parsed.kind !== 'evento') {
      throw new Error('Evento esperado');
    }
    expect(parsed.evento.chaveAcesso).toBe('42110092206960810000176000000000033326062205552016');
    expect(parsed.evento.tipoEvento).toBe('e101101');
    expect(parsed.evento.cnpjAutor).toBe('06960810000176');
    expect(parsed.evento.isCancelamento).toBe(true);
    expect(parsed.evento.descricao).toContain('Cancelamento de NFS-e');
    expect(parsed.evento.dataEvento?.toISOString()).toBe('2026-06-03T18:43:08.000Z');
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
    expect(parsed.tpAmb).toBeUndefined();
    expect(parsed.numeroNfse).toBe('29');
    expect(parsed.serie).toBe('900');
    expect(parsed.dpsId).toBeUndefined();
    expect(parsed.numeroDps).toBeUndefined();
    expect(parsed.status).toBe('100');
    expect(parsed.cnpjPrestador).toBe('44454248000106');
    expect(parsed.razaoSocialPrestador).toContain('TASSIANI');
    expect(parsed.cnpjTomador).toBe('06960810000176');
    expect(parsed.razaoSocialTomador).toContain('GCONT');
    expect(parsed.localPrestacao).toBe('Mondai');
    expect(parsed.municipioPrestacaoCodigo).toBe('4211009');
    expect(parsed.municipioPrestacaoNome).toBe('Mondai');
    expect(parsed.codigoServicoNacional).toBe('170101');
    expect(parsed.valorServico).toBe('1720.00');
    expect(parsed.descricaoServico).toContain('consultoria');
    expect(parsed.competencia?.toISOString()).toBe('2024-08-01T00:00:00.000Z');
  });

  it('prioriza o Local da Prestacao em locPrest/xLocPrestacao quando houver conflito com outros campos', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42110092244454248000106000000000002924081114719252">
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <DPS>
      <infDPS>
        <serv>
          <locPrest>
            <xLocPrestacao>Caibi</xLocPrestacao>
            <cLocPrestacao>4203500</cLocPrestacao>
          </locPrest>
        </serv>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

    const parsed = parser.parse(xml);

    expect(parsed.localPrestacao).toBe('Caibi');
    expect(parsed.municipioPrestacaoNome).toBe('Mondai');
    expect(parsed.municipioPrestacaoCodigo).toBe('4203500');
  });

  it('parseia tpAmb do XML nacional para classificar o ambiente fiscal', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42110092227260384000138000000000005726070184044075">
    <nNFSe>57</nNFSe>
    <cStat>100</cStat>
    <DPS>
      <infDPS>
        <tpAmb>1</tpAmb>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

    const parsed = parser.parse(xml);

    expect(parsed.chaveAcesso).toBe('42110092227260384000138000000000005726070184044075');
    expect(parsed.tpAmb).toBe('1');
  });

  it('extrai o Id e o numero da DPS quando presentes no XML', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42110092210652054000195000000000008426070112345678">
    <nNFSe>84</nNFSe>
    <DPS>
      <infDPS Id="DPS421100921065205400019500900000000000001084">
        <serie>900</serie>
        <nDPS>1084</nDPS>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

    const parsed = parser.parse(xml);

    expect(parsed.dpsId).toBe('DPS421100921065205400019500900000000000001084');
    expect(parsed.numeroDps).toBe('1084');
    expect(parsed.serieDps).toBe('900');
  });

  it('parseia aliquota ISS do layout nacional em pAliqAplic', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS23044001241109394000106000000000010926070838769673">
    <nNFSe>109</nNFSe>
    <valores>
      <vBC>890.00</vBC>
      <pAliqAplic>2.40</pAliqAplic>
      <vISSQN>21.36</vISSQN>
    </valores>
  </infNFSe>
</NFSe>`;

    const parsed = parser.parse(xml);

    expect(parsed.chaveAcesso).toBe('23044001241109394000106000000000010926070838769673');
    expect(parsed.valorIss).toBe('21.36');
    expect(parsed.aliquotaIss).toBe('2.40');
  });

  it('parseia XML ABRASF classico com prestador e tomador em tags capitalizadas', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>64</Numero>
      <CodigoVerificacao>42042022228415329000132000000000006426071542411790</CodigoVerificacao>
      <DataEmissao>2026-07-08T21:01:32-03:00</DataEmissao>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <CpfCnpj><Cnpj>28415329000132</Cnpj></CpfCnpj>
        </IdentificacaoPrestador>
        <RazaoSocial>FRIEDRICH PREPARACAO DE DOCUMENTOS LTDA</RazaoSocial>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Servico>
            <Valores><ValorServicos>170.27</ValorServicos></Valores>
            <IssRetido>2</IssRetido>
            <ItemListaServico>1703</ItemListaServico>
            <Discriminacao>Servico de emissao de documentos</Discriminacao>
          </Servico>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj><Cnpj>39857367000161</Cnpj></CpfCnpj>
            </IdentificacaoTomador>
            <RazaoSocial>TRANSPORTES BARBIAN LTDA</RazaoSocial>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    const parsed = parser.parse(xml);

    expect(parsed.chaveAcesso).toBe('42042022228415329000132000000000006426071542411790');
    expect(parsed.cnpjPrestador).toBe('28415329000132');
    expect(parsed.razaoSocialPrestador).toBe('FRIEDRICH PREPARACAO DE DOCUMENTOS LTDA');
    expect(parsed.cnpjTomador).toBe('39857367000161');
    expect(parsed.razaoSocialTomador).toBe('TRANSPORTES BARBIAN LTDA');
    expect(parsed.retencaoIss).toBe('2');
  });
});
