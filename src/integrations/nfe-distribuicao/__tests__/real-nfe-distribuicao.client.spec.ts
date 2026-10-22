import { gunzipSync, gzipSync } from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { NfeAmbiente } from '@prisma/client';
import { SignedXml } from 'xml-crypto';
import { RealNfeDistribuicaoClient } from '../real-nfe-distribuicao.client';
import { NFE_MANIFESTACAO_EVENT_CODES } from '../nfe-manifestacao.types';

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
        documentExtraction: {
          docZipCount: number;
          discardedCount: number;
          schemaCounts: Record<string, number>;
        };
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
    expect(result.documentExtraction).toEqual({
      docZipCount: 1,
      discardedCount: 0,
      schemaCounts: { 'resNFe_v1.01.xsd': 1 }
    });
    expect(gunzipSync(Buffer.from(docZip, 'base64')).toString('utf8')).toBe(xml);
  });

  it('conta docZip recebidos e descartados sem persistir ou registrar seus conteudos', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      parseSoapResponse(body: string): {
        documents: Array<{ schema: string; xml: string }>;
        documentExtraction: {
          docZipCount: number;
          discardedCount: number;
          schemaCounts: Record<string, number>;
        };
      };
    };
    const soap = `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <cStat>138</cStat><xMotivo>Documentos localizados</xMotivo><ultNSU>1</ultNSU><maxNSU>2</maxNSU>
  <loteDistDFeInt>
    <docZip NSU="1" schema="resNFe_v1.01.xsd">nao-e-gzip</docZip>
    <docZip NSU="2">YWJj</docZip>
  </loteDistDFeInt>
</retDistDFeInt>`;

    const result = client.parseSoapResponse(soap);

    expect(result.documents).toEqual([]);
    expect(result.documentExtraction).toEqual({
      docZipCount: 2,
      discardedCount: 2,
      schemaCounts: { 'resNFe_v1.01.xsd': 1, sem_schema: 1 }
    });
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
      buildSoapEnvelope(xml: string, soapVersion?: '1.1' | '1.2', profile?: Record<string, unknown>): string;
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
    expect(request).toContain('versao="1.01"');
    expect(request).not.toContain('<?xml');
    expect(envelope).toContain('<soap12:Header>');
    expect(envelope).toContain('<versaoDados>1.01</versaoDados>');
    expect(envelope).toContain('<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">');
    expect(envelope).toContain('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">');
    expect(envelope).toContain(request);
  });

  it('consulta produtor rural por CPF usando o elemento CPF do DF-e', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      buildRequestXml(params: {
        cnpjConsulta: string;
        ambiente: 'producao' | 'homologacao';
        consulta: { kind: 'distNSU'; ultNsu: bigint };
      }): string;
    };

    const request = client.buildRequestXml({
      cnpjConsulta: '018.610.209-70',
      ambiente: 'producao',
      consulta: { kind: 'distNSU', ultNsu: 0n }
    });

    expect(request).toContain('<CPF>01861020970</CPF>');
    expect(request).not.toContain('<CNPJ>');
  });

  it('monta e assina um evento de manifestação CPF referenciando infEvento, sem chamar rede', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      buildManifestacaoEventXml(params: {
        cnpjConsulta: string;
        chaveAcesso: string;
        tipo: 'ciencia_operacao' | 'confirmacao_operacao' | 'desconhecimento_operacao' | 'operacao_nao_realizada';
        sequencia: number;
        ambiente: NfeAmbiente;
      }): string;
      signManifestacaoEvent(xml: string, privateKey: string, certificatePem: string): string;
    };
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const params = {
      cnpjConsulta: '018.610.209-70',
      chaveAcesso: '4'.repeat(44),
      tipo: 'ciencia_operacao' as const,
      sequencia: 1,
      ambiente: NfeAmbiente.producao
    };
    const unsigned = client.buildManifestacaoEventXml(params);
    const signed = client.signManifestacaoEvent(unsigned, privatePem, publicPem);
    const verifier = new SignedXml({ publicCert: publicPem });
    const signatureXml = signed.match(/<(?:\w+:)?Signature\b[\s\S]*?<\/(?:\w+:)?Signature>/)?.[0];
    expect(signatureXml).toBeDefined();
    verifier.loadSignature(signatureXml!);
    expect(verifier.checkSignature(signed)).toBe(true);
    expect(signed).toContain(`<CPF>01861020970</CPF>`);
    expect(signed).toContain(`<tpEvento>${NFE_MANIFESTACAO_EVENT_CODES.ciencia_operacao}</tpEvento>`);
    expect(signed).toContain(`Id="ID${NFE_MANIFESTACAO_EVENT_CODES.ciencia_operacao}${params.chaveAcesso}1"`);
    expect(signed).toContain('<Signature');
  });

  it('serializa justificativa somente para Operação não Realizada e escapa conteúdo XML', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      buildManifestacaoEventXml(params: {
        cnpjConsulta: string;
        chaveAcesso: string;
        tipo: 'operacao_nao_realizada' | 'ciencia_operacao';
        sequencia: number;
        justificativa?: string;
        ambiente: NfeAmbiente;
      }): string;
    };
    const base = {
      cnpjConsulta: '12345678000199',
      chaveAcesso: '4'.repeat(44),
      sequencia: 1,
      ambiente: NfeAmbiente.producao
    };
    const withReason = client.buildManifestacaoEventXml({
      ...base,
      tipo: 'operacao_nao_realizada',
      justificativa: 'Entrega & produto <divergentes>'
    });
    const withoutReason = client.buildManifestacaoEventXml({ ...base, tipo: 'ciencia_operacao', justificativa: 'nao usar' });

    expect(withReason).toContain('<CNPJ>12345678000199</CNPJ>');
    expect(withReason).toContain('<xJust>Entrega &amp; produto &lt;divergentes&gt;</xJust>');
    expect(withoutReason).not.toContain('<xJust>');
  });

  it('monta envelope SOAP 1.1 para fallback em endpoints .asmx', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      buildSoapEnvelope(xml: string, soapVersion: '1.1' | '1.2', profile?: Record<string, unknown>): string;
    };

    const envelope = client.buildSoapEnvelope('<teste />', '1.1');

    expect(envelope).toContain('xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"');
    expect(envelope).toContain('<soap:Body>');
    expect(envelope).toContain('<teste />');
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
    const byCpf = client.buildRequestXml({
      cnpjConsulta: '00186102097',
      ambiente: 'producao',
      consulta: { kind: 'distNSU', ultNsu: 0n }
    });

    expect(byNsu).toContain('<tpAmb>2</tpAmb>');
    expect(byNsu).toContain('<consNSU><NSU>000000000000015</NSU></consNSU>');
    expect(byChave).toContain(
      '<consChNFe><chNFe>35260612345678000199550010000001231000001231</chNFe></consChNFe>'
    );
    expect(byCpf).toContain('<CPF>00186102097</CPF>');
    expect(byCpf).not.toContain('<CNPJ>');
  });

  it('extrai retDistDFeInt com namespace no payload SOAP escapado', () => {
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

    const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <ns2:nfeDistDFeInteresseResponse xmlns:ns2="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <ns2:nfeDistDFeInteresseResult>&lt;ns3:retDistDFeInt xmlns:ns3="http://www.portalfiscal.inf.br/nfe" versao="1.01"&gt;&lt;ns3:cStat&gt;137&lt;/ns3:cStat&gt;&lt;ns3:xMotivo&gt;Nenhum documento localizado&lt;/ns3:xMotivo&gt;&lt;ns3:ultNSU&gt;000000000000051&lt;/ns3:ultNSU&gt;&lt;ns3:maxNSU&gt;000000000000051&lt;/ns3:maxNSU&gt;&lt;/ns3:retDistDFeInt&gt;</ns2:nfeDistDFeInteresseResult>
    </ns2:nfeDistDFeInteresseResponse>
  </soap:Body>
</soap:Envelope>`;

    const result = client.parseSoapResponse(soap);

    expect(result.cStat).toBe('137');
    expect(result.xMotivo).toBe('Nenhum documento localizado');
    expect(result.ultNsu).toBe(51n);
    expect(result.maxNsu).toBe(51n);
    expect(result.documents).toEqual([]);
  });

  it('descompacta resposta HTTP gzip antes de parsear o SOAP', () => {
    const client = new RealNfeDistribuicaoClient({} as never, {} as never, {} as never) as unknown as {
      decodeHttpResponseBody(
        headers: Record<string, string>,
        payload: Buffer
      ): string;
    };

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDistDFeInteresseResult>&lt;retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"&gt;&lt;cStat&gt;137&lt;/cStat&gt;&lt;xMotivo&gt;Nenhum documento localizado&lt;/xMotivo&gt;&lt;ultNSU&gt;000000000000051&lt;/ultNSU&gt;&lt;maxNSU&gt;000000000000051&lt;/maxNSU&gt;&lt;/retDistDFeInt&gt;</nfeDistDFeInteresseResult>
    </nfeDistDFeInteresseResponse>
  </soap:Body>
</soap:Envelope>`;

    const body = client.decodeHttpResponseBody({ 'content-encoding': 'gzip' }, gzipSync(Buffer.from(xml, 'utf8')));

    expect(body).toBe(xml);
  });
});
