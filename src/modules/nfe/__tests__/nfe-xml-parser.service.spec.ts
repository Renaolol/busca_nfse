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
});
