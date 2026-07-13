import { NfeXmlParserService } from '../nfe-xml-parser.service';

describe('NfeXmlParserService', () => {
  const service = new NfeXmlParserService();

  it('parseia XML completo de NF-e', () => {
    const parsed = service.parse(`<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>123</nNF>
        <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
      </ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Destinatario Teste</xNome></dest>
      <total><ICMSTot><vNF>199.90</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`);

    expect(parsed).toMatchObject({
      chaveAcesso: '35260612345678000199550010000001231000001231',
      numeroNfe: '123',
      serie: '1',
      modelo: '55',
      cnpjEmitente: '12345678000199',
      razaoSocialEmitente: 'Emitente Teste',
      cnpjDestinatario: '99888777000166',
      razaoSocialDestinatario: 'Destinatario Teste',
      valorTotal: '199.90',
      schemaDoc: 'procNFe_v4.00',
      contentType: 'completo'
    });
  });

  it('parseia resumo resNFe', () => {
    const parsed = service.parse(`<?xml version="1.0" encoding="UTF-8"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>35260612345678000199550010000001231000001231</chNFe>
  <CNPJ>12345678000199</CNPJ>
  <xNome>Fornecedor Resumo</xNome>
  <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
  <vNF>88.15</vNF>
  <cSitNFe>1</cSitNFe>
</resNFe>`);

    expect(parsed).toMatchObject({
      chaveAcesso: '35260612345678000199550010000001231000001231',
      cnpjEmitente: '12345678000199',
      razaoSocialEmitente: 'Fornecedor Resumo',
      valorTotal: '88.15',
      schemaDoc: 'resNFe_v1.01',
      contentType: 'resumo'
    });
  });

  it('inspeciona numero da NF-e mesmo sem chave de acesso valida', () => {
    const inspected = service.inspect(`<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe>
      <ide>
        <mod>55</mod>
        <serie>7</serie>
        <nNF>456</nNF>
      </ide>
    </infNFe>
  </NFe>
</nfeProc>`);

    expect(inspected).toEqual({
      chaveAcesso: undefined,
      numeroNfe: '456',
      serie: '7',
      modelo: '55'
    });
  });

  it('classifica CT-e e rejeita parse no fluxo de NF-e', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe42260795849600000135570010000319691243772228">
      <ide>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>31969</nCT>
        <dhEmi>2026-07-04T08:45:12-03:00</dhEmi>
      </ide>
    </infCte>
  </CTe>
  <protCTe><infProt><chCTe>42260795849600000135570010000319691243772228</chCTe></infProt></protCTe>
</cteProc>`;

    expect(service.classify(xml)).toEqual({
      documentType: 'cte',
      schemaDoc: 'cteProc_v4.00',
      contentType: 'completo'
    });
    expect(() => service.parse(xml)).toThrow('XML de CT-e informado no fluxo de NF-e');
  });

  it('classifica e parseia evento de cancelamento de NF-e', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento versao="1.00">
    <infEvento Id="ID1101113526061234567800019955001000000123100000123101">
      <cOrgao>35</cOrgao>
      <tpAmb>1</tpAmb>
      <CNPJ>12345678000199</CNPJ>
      <chNFe>35260612345678000199550010000001231000001231</chNFe>
      <dhEvento>2026-07-13T14:10:00-03:00</dhEvento>
      <tpEvento>110111</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento versao="1.00">
        <descEvento>Cancelamento</descEvento>
        <xJust>Cancelamento homologado</xJust>
      </detEvento>
    </infEvento>
  </evento>
</procEventoNFe>`;

    expect(service.classify(xml)).toEqual({
      documentType: 'nfe',
      schemaDoc: 'procEventoNFe_v1.00',
      contentType: 'evento'
    });
    expect(service.parseEvento(xml)).toMatchObject({
      documentType: 'nfe',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      tipoEvento: '110111',
      descricao: 'Cancelamento',
      numeroSequencial: '1',
      schemaDoc: 'procEventoNFe_v1.00',
      isCancelamento: true
    });
    expect(() => service.parse(xml)).toThrow('XML de evento informado no fluxo de NF-e');
  });

  it('classifica e parseia evento de CT-e', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento Id="ID1101114226079584960000013557001000031969124377222801">
      <cOrgao>42</cOrgao>
      <tpAmb>1</tpAmb>
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
</procEventoCTe>`;

    expect(service.classify(xml)).toEqual({
      documentType: 'cte',
      schemaDoc: 'procEventoCTe_v4.00',
      contentType: 'evento'
    });
    expect(service.parseEvento(xml)).toMatchObject({
      documentType: 'cte',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      tipoEvento: '110111',
      descricao: 'Cancelamento',
      numeroSequencial: '1',
      schemaDoc: 'procEventoCTe_v4.00',
      isCancelamento: true
    });
  });
});
