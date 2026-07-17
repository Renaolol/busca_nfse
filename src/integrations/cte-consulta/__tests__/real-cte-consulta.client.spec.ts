import { RealCteConsultaClient } from '../real-cte-consulta.client';

describe('RealCteConsultaClient', () => {
  afterEach(() => {
    delete process.env.CTE_CONSULTA_URL_PRODUCAO;
    delete process.env.CTE_CONSULTA_URL_HOMOLOGACAO;
  });

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

  it('resolve endpoint de producao por cUF quando nao ha URL fixa configurada', () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      buildConsultaUrl(ambiente: 'producao' | 'homologacao', cUf: string): URL;
    };

    expect(client.buildConsultaUrl('producao', '41').toString()).toBe('https://cte.fazenda.pr.gov.br/cte4/CTeConsultaV4');
    expect(client.buildConsultaUrl('producao', '42').toString()).toBe(
      'https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx'
    );
    expect(client.buildConsultaUrl('producao', '50').toString()).toBe('https://producao.cte.ms.gov.br/ws/CTeConsultaV4');
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

  it('repete a consulta em SOAP 1.2 sem SOAPAction quando o endpoint rejeita a action original', async () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      doSoapRequestSequence(
        url: URL,
        mtls: Record<string, unknown>,
        requestXml: string,
        cUf: string,
        rejectUnauthorized?: boolean
      ): Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>;
      doSoapRequest: jest.Mock;
    };

    client.doSoapRequest = jest
      .fn()
      .mockResolvedValueOnce({
        statusCode: 500,
        headers: {},
        body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Reason><soap:Text xml:lang="en">Unable to handle request. The action 'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4/cteConsultaCT' was not recognized.</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>`
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<ok />'
      });

    const result = await client.doSoapRequestSequence(
      new URL('https://cte.example.test/ws'),
      { mode: 'pfx', pfx: Buffer.from('fake'), passphrase: 'senha' },
      '<xml />',
      '42',
      true
    );

    expect(client.doSoapRequest).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      '1.2',
      true,
      'default',
      'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4',
      true
    );
    expect(client.doSoapRequest).toHaveBeenNthCalledWith(
      2,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      '1.2',
      true,
      'omit',
      'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4',
      true
    );
    expect(result).toEqual({
      statusCode: 200,
      headers: {},
      body: '<ok />'
    });
  });

  it('repete a consulta em SOAP 1.1 apenas quando o SOAP 1.2 volta com 400 vazio', async () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      doSoapRequestSequence(
        url: URL,
        mtls: Record<string, unknown>,
        requestXml: string,
        cUf: string,
        rejectUnauthorized?: boolean
      ): Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>;
      doSoapRequest: jest.Mock;
    };

    client.doSoapRequest = jest
      .fn()
      .mockResolvedValueOnce({
        statusCode: 400,
        headers: {},
        body: ''
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<ok />'
      });

    const result = await client.doSoapRequestSequence(
      new URL('https://cte.example.test/ws'),
      { mode: 'pfx', pfx: Buffer.from('fake'), passphrase: 'senha' },
      '<xml />',
      '42',
      true
    );

    expect(client.doSoapRequest).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      '1.2',
      true,
      'default',
      'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4',
      true
    );
    expect(client.doSoapRequest).toHaveBeenNthCalledWith(
      2,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      '1.1',
      true,
      'quoted',
      'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4',
      false
    );
    expect(result).toEqual({
      statusCode: 200,
      headers: {},
      body: '<ok />'
    });
  });

  it('testa variante sem action no content-type antes de desistir do SOAP 1.2', async () => {
    const client = new RealCteConsultaClient({} as never, {} as never, {} as never) as unknown as {
      doSoapRequestSequence(
        url: URL,
        mtls: Record<string, unknown>,
        requestXml: string,
        cUf: string,
        rejectUnauthorized?: boolean
      ): Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>;
      doSoapRequest: jest.Mock;
    };

    client.doSoapRequest = jest
      .fn()
      .mockResolvedValueOnce({
        statusCode: 500,
        headers: {},
        body: `Unable to handle request. The action 'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4/cteConsultaCT' was not recognized.`
      })
      .mockResolvedValueOnce({
        statusCode: 500,
        headers: {},
        body: `Unable to handle request. The action 'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4/cteConsultaCT' was not recognized.`
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: '<ok />'
      });

    const result = await client.doSoapRequestSequence(
      new URL('https://cte.example.test/ws'),
      { mode: 'pfx', pfx: Buffer.from('fake'), passphrase: 'senha' },
      '<xml />',
      '42',
      true
    );

    expect(client.doSoapRequest).toHaveBeenNthCalledWith(
      3,
      expect.any(URL),
      expect.objectContaining({ mode: 'pfx' }),
      '<xml />',
      '42',
      '1.2',
      true,
      'omit',
      'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4',
      false
    );
    expect(result).toEqual({
      statusCode: 200,
      headers: {},
      body: '<ok />'
    });
  });
});
