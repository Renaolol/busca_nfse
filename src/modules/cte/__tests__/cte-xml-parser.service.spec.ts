import { CteXmlParserService } from '../cte-xml-parser.service';

describe('CteXmlParserService', () => {
  it('prioriza a chave do infCte sobre a chave referenciada em infCteSub', () => {
    const chaveSubcontratado = '42260836017714000150570030000006071234567890';
    const chavePrincipal = '42260836017714000150570030000019651265948215';
    const service = new CteXmlParserService();

    const parsed = service.parse(`
      <cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
        <CTe>
          <infCte Id="CTe${chaveSubcontratado}">
            <ide><mod>57</mod><serie>3</serie><nCT>607</nCT></ide>
            <infCTeNorm><infCteSub><chCTe>${chavePrincipal}</chCTe></infCteSub></infCTeNorm>
          </infCte>
        </CTe>
      </cteProc>
    `);

    expect(parsed).toMatchObject({
      chaveAcesso: chaveSubcontratado,
      numeroCte: '607',
      serie: '3'
    });
  });
});
