import { RealCteConsultaClient } from '../real-cte-consulta.client';

describe('RealCteConsultaClient', () => {
  it('monta payload consSitCTe e envelope SOAP com cUF da chave', () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      buildRequestXml(chaveAcesso: string, ambiente: 'producao' | 'homologacao'): string;
      buildSoapEnvelope(xml: string, cUf: string, soapVersion?: '1.1' | '1.2'): string;
    };

    const request = client.buildRequestXml('42260795849600000135570010000319691243772228', 'producao');
    const envelope = client.buildSoapEnvelope(request, '42');

    expect(request).toContain('<tpAmb>1</tpAmb>');
    expect(request).toContain('<xServ>CONSULTAR</xServ>');
    expect(request).toContain('<chCTe>42260795849600000135570010000319691243772228</chCTe>');
    expect(envelope).toContain('<cUF>42</cUF>');
    expect(envelope).toContain('<versaoDados>4.00</versaoDados>');
    expect(envelope).toContain('<cteConsultaCT xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4">');
    expect(envelope).toContain(request);
  });

  it('extrai resumo e evento de retConsSitCTe no SOAP', () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      parseSoapResponse(body: string): {
        cStat?: string;
        xMotivo?: string;
        documents: Array<{
          schema: string;
          xml: string;
          chaveAcesso?: string;
        }>;
      };
    };

    const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <cteConsultaCTResponse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4">
      <cteConsultaCTResult>&lt;retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"&gt;
        &lt;cStat&gt;100&lt;/cStat&gt;
        &lt;xMotivo&gt;Autorizado o uso do CT-e&lt;/xMotivo&gt;
        &lt;chCTe&gt;42260795849600000135570010000319691243772228&lt;/chCTe&gt;
        &lt;procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"&gt;
          &lt;eventoCTe versao="4.00"&gt;
            &lt;infEvento&gt;
              &lt;tpEvento&gt;110111&lt;/tpEvento&gt;
              &lt;chCTe&gt;42260795849600000135570010000319691243772228&lt;/chCTe&gt;
            &lt;/infEvento&gt;
          &lt;/eventoCTe&gt;
        &lt;/procEventoCTe&gt;
      &lt;/retConsSitCTe&gt;</cteConsultaCTResult>
    </cteConsultaCTResponse>
  </soap:Body>
</soap:Envelope>`;

    const result = client.parseSoapResponse(soap);

    expect(result.cStat).toBe('100');
    expect(result.xMotivo).toBe('Autorizado o uso do CT-e');
    expect(result.documents.map((document) => document.schema)).toEqual(['retConsSitCTe_v4.00', 'procEventoCTe_v4.00']);
    expect(result.documents[0].chaveAcesso).toBe('42260795849600000135570010000319691243772228');
    expect(result.documents[1].xml).toContain('<procEventoCTe');
  });

  it('refaz a consulta sem validacao da cadeia TLS quando o portal retorna erro de issuer local', async () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      doSoapRequestWithFallback(
        url: URL,
        certificate: Record<string, unknown>,
        requestXml: string,
        cUf: string
      ): Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>;
      getPfxCredentials(certificate: Record<string, unknown>): Promise<{ mode: 'pfx'; pfx: Buffer; passphrase: string }>;
      doSoapRequestSequence: jest.Mock;
    };

    client.getPfxCredentials = jest.fn().mockResolvedValue({
      mode: 'pfx',
      pfx: Buffer.from('fake-pfx'),
      passphrase: 'senha'
    });
    client.doSoapRequestSequence = jest
      .fn()
      .mockRejectedValueOnce(new Error('unable to get local issuer certificate'))
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<ok />'
      });

    const result = await client.doSoapRequestWithFallback(new URL('https://cte.example.test/ws'), { id: 'cert-1' }, '<xml />', '42');

    expect(client.doSoapRequestSequence).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      true
    );
    expect(client.doSoapRequestSequence).toHaveBeenNthCalledWith(
      2,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      false
    );
    expect(result).toEqual({
      statusCode: 200,
      headers: {},
      body: '<ok />'
    });
  });
});
