import { gunzipSync, gzipSync } from 'node:zlib';
import { RealNfeDistribuicaoClient } from '../real-nfe-distribuicao.client';

describe('RealNfeDistribuicaoClient', () => {
  it('extrai retDistDFeInt com docZip compactado em SOAP', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      parseSoapResponse(body: string): {
        cStat?: string;
        xMotivo?: string;
        ultNsu: bigint;
        maxNsu: bigint;
        documents: Array<{
          nsu?: bigint;
          schema: string;
          xml: string;
          chaveAcesso?: string;
        }>;
      };
    };

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>35260612345678000199550010000001231000001231</chNFe>
  <CNPJ>12345678000199</CNPJ>
  <xNome>Fornecedor Teste</xNome>
  <IE>123456789</IE>
  <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
  <tpNF>0</tpNF>
  <vNF>88.15</vNF>
  <dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto>
  <nProt>135260000000001</nProt>
  <cSitNFe>1</cSitNFe>
</resNFe>`;
    const docZip = gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
    const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDistDFeInteresseResult>&lt;retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"&gt;&lt;tpAmb&gt;1&lt;/tpAmb&gt;&lt;verAplic&gt;1.7.1&lt;/verAplic&gt;&lt;cStat&gt;138&lt;/cStat&gt;&lt;xMotivo&gt;Documentos localizados&lt;/xMotivo&gt;&lt;dhResp&gt;2026-06-29T10:00:02-03:00&lt;/dhResp&gt;&lt;ultNSU&gt;000000000000011&lt;/ultNSU&gt;&lt;maxNSU&gt;000000000000099&lt;/maxNSU&gt;&lt;loteDistDFeInt&gt;&lt;docZip NSU="000000000000011" schema="resNFe_v1.01.xsd"&gt;${docZip}&lt;/docZip&gt;&lt;/loteDistDFeInt&gt;&lt;/retDistDFeInt&gt;</nfeDistDFeInteresseResult>
    </nfeDistDFeInteresseResponse>
  </soap:Body>
</soap:Envelope>`;

    const result = client.parseSoapResponse(soap);

    expect(result.cStat).toBe('138');
    expect(result.xMotivo).toBe('Documentos localizados');
    expect(result.ultNsu).toBe(11n);
    expect(result.maxNsu).toBe(99n);
    expect(result.documents).toEqual([
      {
        nsu: 11n,
        schema: 'resNFe_v1.01.xsd',
        xml,
        chaveAcesso: '35260612345678000199550010000001231000001231'
      }
    ]);
    expect(gunzipSync(Buffer.from(docZip, 'base64')).toString('utf8')).toBe(xml);
  });

  it('monta envelope SOAP com header da AN e payload distNSU', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      buildRequestXml(params: {
        cnpjConsulta: string;
        ambiente: 'producao' | 'homologacao';
        consulta:
          | {
              kind: 'distNSU';
              ultNsu: bigint;
            }
          | {
              kind: 'consNSU';
              nsu: bigint;
            }
          | {
              kind: 'consChNFe';
              chaveAcesso: string;
            };
      }): string;
      buildSoapEnvelope(xml: string): string;
    };

    const request = client.buildRequestXml({
      cnpjConsulta: '12.345.678/0001-99',
      ambiente: 'producao',
      consulta: {
        kind: 'distNSU',
        ultNsu: 7n
      }
    });
    const envelope = client.buildSoapEnvelope(request);

    expect(request).toContain('<tpAmb>1</tpAmb>');
    expect(request).toContain('<CNPJ>12345678000199</CNPJ>');
    expect(request).toContain('<ultNSU>000000000000007</ultNSU>');
    expect(envelope).toContain('<cUF>91</cUF>');
    expect(envelope).toContain('<versaoDados>1.01</versaoDados>');
    expect(envelope).toContain('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">');
  });

  it('monta payload para consNSU e consChNFe', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      buildRequestXml(params: {
        cnpjConsulta: string;
        ambiente: 'producao' | 'homologacao';
        consulta:
          | {
              kind: 'distNSU';
              ultNsu: bigint;
            }
          | {
              kind: 'consNSU';
              nsu: bigint;
            }
          | {
              kind: 'consChNFe';
              chaveAcesso: string;
            };
      }): string;
    };

    const byNsu = client.buildRequestXml({
      cnpjConsulta: '12345678000199',
      ambiente: 'homologacao',
      consulta: {
        kind: 'consNSU',
        nsu: 15n
      }
    });
    const byChave = client.buildRequestXml({
      cnpjConsulta: '12345678000199',
      ambiente: 'producao',
      consulta: {
        kind: 'consChNFe',
        chaveAcesso: '35260612345678000199550010000001231000001231'
      }
    });

    expect(byNsu).toContain('<tpAmb>2</tpAmb>');
    expect(byNsu).toContain('<consNSU><NSU>000000000000015</NSU></consNSU>');
    expect(byChave).toContain(
      '<consChNFe><chNFe>35260612345678000199550010000001231000001231</chNFe></consChNFe>'
    );
  });
});
