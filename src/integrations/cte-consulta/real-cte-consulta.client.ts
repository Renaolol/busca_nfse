import { Injectable } from '@nestjs/common';
import { Certificado, NfeAmbiente } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalStorageService } from '../../modules/storage/storage.service';
import { CryptoService } from '../../modules/shared/crypto.service';
import { CteConsultaClient, CteConsultaDocument, CteConsultaResult } from './cte-consulta.types';

type PfxCredentials = {
  mode: 'pfx';
  pfx: Buffer;
  passphrase: string;
};

type PemCredentials = {
  mode: 'pem';
  cert: string;
  key: string;
};

type MutualTlsCredentials = PfxCredentials | PemCredentials;
type SoapActionMode = 'default' | 'omit' | 'quoted';
type SoapPayloadMode =
  | 'wrapped_raw'
  | 'wrapped_cdata'
  | 'wrapped_escaped'
  | 'direct_raw'
  | 'direct_cdata'
  | 'direct_escaped';

@Injectable()
export class RealCteConsultaClient implements CteConsultaClient {
  private static readonly SOAP_NAMESPACE = 'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaV4';
  private static readonly SOAP_NAMESPACE_ALTERNATES = [
    RealCteConsultaClient.SOAP_NAMESPACE,
    'http://www.portalfiscal.inf.br/cte/wsdl/CTeConsultaV4',
    'http://www.portalfiscal.inf.br/cte/wsdl/CteConsulta'
  ] as const;
  private static readonly XML_NAMESPACE = 'http://www.portalfiscal.inf.br/cte';
  private static readonly LAYOUT_VERSION = process.env.CTE_CONSULTA_LAYOUT_VERSION?.trim() || '4.00';

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly crypto: CryptoService
  ) {}

  async consultarPorChave(params: {
    chaveAcesso: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<CteConsultaResult> {
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const cUf = this.extractCUfFromChave(params.chaveAcesso);
      const url = this.buildConsultaUrl(params.ambiente, cUf);
      const requestXml = this.buildRequestXml(params.chaveAcesso, params.ambiente);
      const fallbackUrl = this.resolveConsultaFallbackUrl(params.ambiente, cUf, url);
      let consulta = await this.executeConsulta(url, certificate, requestXml, cUf);

      if (this.shouldRetryWithAlternateEndpoint(consulta.parsed, fallbackUrl)) {
        consulta = await this.executeConsulta(fallbackUrl as URL, certificate, requestXml, cUf);
      }

      return {
        statusCode: consulta.response.statusCode,
        cStat: consulta.parsed.cStat,
        xMotivo: consulta.parsed.xMotivo,
        documents: consulta.parsed.documents,
        rawResponse: consulta.parsed.rawXml
      };
    } catch (error) {
      return {
        statusCode: 0,
        cStat: '000',
        xMotivo: this.toErrorMessage(error),
        documents: [],
        rawResponse: { error: this.toErrorMessage(error) }
      };
    }
  }

  private async executeConsulta(
    url: URL,
    certificate: Certificado,
    requestXml: string,
    cUf: string
  ): Promise<{
    response: { statusCode: number; headers: IncomingHttpHeaders; body: string };
    parsed: { cStat?: string; xMotivo?: string; documents: CteConsultaDocument[]; rawXml: string };
  }> {
    const payloadModes: SoapPayloadMode[] = [
      'wrapped_raw',
      'wrapped_cdata',
      'wrapped_escaped',
      'direct_raw',
      'direct_cdata',
      'direct_escaped'
    ];
    let lastSuccessfulAttempt:
      | {
          response: { statusCode: number; headers: IncomingHttpHeaders; body: string };
          parsed: { cStat?: string; xMotivo?: string; documents: CteConsultaDocument[]; rawXml: string };
        }
      | undefined;
    let lastError: unknown;

    for (const [index, payloadMode] of payloadModes.entries()) {
      try {
        const response = await this.doSoapRequestWithFallback(url, certificate, requestXml, cUf, payloadMode);
        const parsed = this.parseSoapResponse(response.body);
        lastSuccessfulAttempt = { response, parsed };

        if (!this.shouldRetryWithAlternatePayload(parsed)) {
          return { response, parsed };
        }
      } catch (error) {
        lastError = error;
        if (!this.shouldRetryWithAlternatePayloadError(this.toErrorMessage(error)) || index === payloadModes.length - 1) {
          throw error;
        }
        continue;
      }
    }

    if (lastSuccessfulAttempt) {
      return lastSuccessfulAttempt;
    }

    throw lastError instanceof Error ? lastError : new Error('Falha ao executar consulta CT-e por chave');
  }

  private async loadCertificate(certificateId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id: certificateId } });
    if (!certificate) {
      throw new Error('Certificado nao encontrado para consulta CT-e');
    }

    return certificate;
  }

  private async getPfxCredentials(certificate: Certificado): Promise<PfxCredentials> {
    const encryptedPfxPayload = await this.storage.getObject(certificate.arquivoCriptografadoPath);
    const encryptedPfx = encryptedPfxPayload.toString('utf8').trim();
    const pfx = this.crypto.decrypt(encryptedPfx);
    const passphrase = this.crypto.decrypt(certificate.senhaCriptografada).toString('utf8');
    return { mode: 'pfx', pfx, passphrase };
  }

  private buildConsultaUrl(ambiente: NfeAmbiente, cUf: string): URL {
    const configured =
      ambiente === NfeAmbiente.producao
        ? process.env.CTE_CONSULTA_URL_PRODUCAO?.trim()
        : process.env.CTE_CONSULTA_URL_HOMOLOGACAO?.trim();

    if (configured) {
      return new URL(configured);
    }

    if (ambiente === NfeAmbiente.producao) {
      return new URL(this.resolveConsultaProducaoUrlByCUf(cUf));
    }

    throw new Error('CTE_CONSULTA_URL_HOMOLOGACAO nao configurada');
  }

  private resolveConsultaFallbackUrl(ambiente: NfeAmbiente, cUf: string, currentUrl: URL): URL | undefined {
    if (ambiente !== NfeAmbiente.producao || !process.env.CTE_CONSULTA_URL_PRODUCAO?.trim()) {
      return undefined;
    }

    const resolved = new URL(this.resolveConsultaProducaoUrlByCUf(cUf));
    return this.isSameEndpoint(currentUrl, resolved) ? undefined : resolved;
  }

  private buildRequestXml(chaveAcesso: string, ambiente: NfeAmbiente): string {
    return [
      `<consSitCTe xmlns="${RealCteConsultaClient.XML_NAMESPACE}" versao="${RealCteConsultaClient.LAYOUT_VERSION}">`,
      `<tpAmb>${ambiente === NfeAmbiente.producao ? '1' : '2'}</tpAmb>`,
      `<xServ>CONSULTAR</xServ>`,
      `<chCTe>${this.onlyDigits(chaveAcesso)}</chCTe>`,
      `</consSitCTe>`
    ].join('');
  }

  private buildSoapEnvelope(
    requestXml: string,
    cUf: string,
    soapVersion: '1.1' | '1.2' = '1.2',
    payloadMode: SoapPayloadMode = 'wrapped_raw',
    soapNamespace: string = RealCteConsultaClient.SOAP_NAMESPACE
  ): string {
    const envelopeNamespace =
      soapVersion === '1.2'
        ? 'http://www.w3.org/2003/05/soap-envelope'
        : 'http://schemas.xmlsoap.org/soap/envelope/';
    const prefix = soapVersion === '1.2' ? 'soap12' : 'soap';
    const payload = this.buildSoapPayload(requestXml, payloadMode, soapNamespace);

    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<${prefix}:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
      ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"`,
      ` xmlns:${prefix}="${envelopeNamespace}">`,
      `<${prefix}:Header>`,
      `<cteCabecMsg xmlns="${soapNamespace}">`,
      `<cUF>${cUf}</cUF>`,
      `<versaoDados>${RealCteConsultaClient.LAYOUT_VERSION}</versaoDados>`,
      `</cteCabecMsg>`,
      `</${prefix}:Header>`,
      `<${prefix}:Body>`,
      payload,
      `</${prefix}:Body>`,
      `</${prefix}:Envelope>`
    ].join('');
  }

  private buildSoapPayload(requestXml: string, payloadMode: SoapPayloadMode, soapNamespace: string): string {
    const encodedXml = this.escapeXmlForElementContent(requestXml);
    const cdataXml = `<![CDATA[${requestXml}]]>`;
    const bodyContent =
      payloadMode === 'wrapped_cdata' || payloadMode === 'direct_cdata'
        ? cdataXml
        : payloadMode === 'wrapped_escaped' || payloadMode === 'direct_escaped'
          ? encodedXml
          : requestXml;

    if (payloadMode.startsWith('direct_')) {
      return [`<cteDadosMsg xmlns="${soapNamespace}">`, bodyContent, `</cteDadosMsg>`].join('');
    }

    return [
      `<cteConsultaCT xmlns="${soapNamespace}">`,
      `<cteDadosMsg xmlns="${soapNamespace}">`,
      bodyContent,
      `</cteDadosMsg>`,
      `</cteConsultaCT>`
    ].join('');
  }

  private async doSoapRequestWithFallback(
    url: URL,
    certificate: Certificado,
    requestXml: string,
    cUf: string,
    payloadMode: SoapPayloadMode = 'wrapped_raw'
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    const pfxCredentials = await this.getPfxCredentials(certificate);
    const rejectUnauthorized = process.env.CTE_CONSULTA_REJECT_UNAUTHORIZED !== 'false';

    try {
      return await this.doSoapRequestSequence(url, pfxCredentials, requestXml, cUf, rejectUnauthorized, payloadMode);
    } catch (error) {
      const message = this.toErrorMessage(error);
      if (rejectUnauthorized && this.isLocalIssuerCertificateError(message)) {
        return this.doSoapRequestSequence(url, pfxCredentials, requestXml, cUf, false, payloadMode);
      }
      if (!this.isUnsupportedPkcs12Error(message)) {
        throw error;
      }

      const pemCredentials = await this.convertPfxToPemCredentials(pfxCredentials.pfx, pfxCredentials.passphrase);
      try {
        return await this.doSoapRequestSequence(url, pemCredentials, requestXml, cUf, rejectUnauthorized, payloadMode);
      } catch (pemError) {
        const pemMessage = this.toErrorMessage(pemError);
        if (rejectUnauthorized && this.isLocalIssuerCertificateError(pemMessage)) {
          return this.doSoapRequestSequence(url, pemCredentials, requestXml, cUf, false, payloadMode);
        }
        throw pemError;
      }
    }
  }

  private async doSoapRequestSequence(
    url: URL,
    mtls: MutualTlsCredentials,
    requestXml: string,
    cUf: string,
    rejectUnauthorized = process.env.CTE_CONSULTA_REJECT_UNAUTHORIZED !== 'false',
    payloadMode: SoapPayloadMode = 'wrapped_raw'
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    const soap12Attempts: Array<{ actionMode: SoapActionMode; soapNamespace: string; contentTypeIncludesAction: boolean }> = [
      {
        actionMode: 'default',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[0],
        contentTypeIncludesAction: true
      },
      {
        actionMode: 'omit',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[0],
        contentTypeIncludesAction: true
      },
      {
        actionMode: 'omit',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[0],
        contentTypeIncludesAction: false
      },
      {
        actionMode: 'default',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[1],
        contentTypeIncludesAction: true
      },
      {
        actionMode: 'omit',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[1],
        contentTypeIncludesAction: false
      },
      {
        actionMode: 'default',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[2],
        contentTypeIncludesAction: true
      },
      {
        actionMode: 'omit',
        soapNamespace: RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[2],
        contentTypeIncludesAction: false
      }
    ];

    let attempt12 = await this.doSoapRequest(
      url,
      mtls,
      requestXml,
      cUf,
      '1.2',
      rejectUnauthorized,
      soap12Attempts[0].actionMode,
      soap12Attempts[0].soapNamespace,
      soap12Attempts[0].contentTypeIncludesAction,
      payloadMode
    );

    for (const attempt of soap12Attempts.slice(1)) {
      if (!this.shouldRetryWithAlternateSoap12Action(attempt12)) {
        break;
      }

      attempt12 = await this.doSoapRequest(
        url,
        mtls,
        requestXml,
        cUf,
        '1.2',
        rejectUnauthorized,
        attempt.actionMode,
        attempt.soapNamespace,
        attempt.contentTypeIncludesAction,
        payloadMode
      );
    }

    if (!this.shouldRetryWithSoap11(attempt12)) {
      return attempt12;
    }

    return this.doSoapRequest(
      url,
      mtls,
      requestXml,
      cUf,
      '1.1',
      rejectUnauthorized,
      'quoted',
      RealCteConsultaClient.SOAP_NAMESPACE_ALTERNATES[0],
      false,
      payloadMode
    );
  }

  private doSoapRequest(
    url: URL,
    mtls: MutualTlsCredentials,
    requestXml: string,
    cUf: string,
    soapVersion: '1.1' | '1.2',
    rejectUnauthorized: boolean,
    soapActionMode: SoapActionMode,
    soapNamespace: string,
    contentTypeIncludesAction: boolean,
    payloadMode: SoapPayloadMode = 'wrapped_raw'
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const envelope = this.buildSoapEnvelope(requestXml, cUf, soapVersion, payloadMode, soapNamespace);
      const tlsOptions =
        mtls.mode === 'pfx'
          ? { pfx: mtls.pfx, passphrase: mtls.passphrase }
          : { cert: mtls.cert, key: mtls.key };
      const soapAction = `${soapNamespace}/cteConsultaCT`;
      const contentType =
        soapVersion === '1.2'
          ? contentTypeIncludesAction
            ? `application/soap+xml; charset=utf-8; action="${soapAction}"`
            : 'application/soap+xml; charset=utf-8'
          : 'text/xml; charset=utf-8';
      const soapActionHeader =
        soapActionMode === 'omit' ? undefined : soapActionMode === 'quoted' || soapVersion === '1.1' ? `"${soapAction}"` : soapAction;
      const headers: Record<string, string | number> = {
        'Content-Type': contentType,
        Accept: 'application/soap+xml, text/xml, application/xml',
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Length': Buffer.byteLength(envelope, 'utf8')
      };
      if (soapActionHeader) {
        headers.SOAPAction = soapActionHeader;
      }

      const req = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : undefined,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers,
          ...tlsOptions,
          rejectUnauthorized,
          timeout: Number(process.env.CTE_CONSULTA_TIMEOUT_MS ?? 30000)
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: this.decodeHttpResponseBody(res.headers, Buffer.concat(chunks))
            });
          });
        }
      );

      req.on('timeout', () => req.destroy(new Error('Timeout ao consultar CT-e por chave')));
      req.on('error', reject);
      req.write(envelope, 'utf8');
      req.end();
    });
  }

  private parseSoapResponse(body: string): {
    cStat?: string;
    xMotivo?: string;
    documents: CteConsultaDocument[];
    rawXml: string;
  } {
    const fault = this.extractSoapFault(body);
    if (fault) {
      throw new Error(fault);
    }

    const innerXml = this.extractSoapResultXml(body);
    if (!innerXml) {
      throw new Error(`Resposta SOAP do CT-e sem retConsSitCTe reconhecivel. Preview: ${this.previewBody(body)}`);
    }

    return {
      cStat: this.extractFirstTagText(innerXml, 'cStat'),
      xMotivo: this.extractFirstTagText(innerXml, 'xMotivo'),
      documents: this.extractDocuments(innerXml),
      rawXml: innerXml
    };
  }

  private extractSoapResultXml(soapXml: string): string | null {
    const normalized = this.decodeXmlEntities(soapXml);
    const direct = normalized.match(/<(?:\w+:)?retConsSitCTe\b[\s\S]*?<\/(?:\w+:)?retConsSitCTe>/i)?.[0];
    if (direct) {
      return direct;
    }

    const wrapped = normalized.match(/<(?:\w+:)?cteConsultaCTResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cteConsultaCTResult>/i)?.[1];
    if (!wrapped) {
      return null;
    }

    const decoded = this.decodeXmlEntities(wrapped);
    return decoded.match(/<(?:\w+:)?retConsSitCTe\b[\s\S]*?<\/(?:\w+:)?retConsSitCTe>/i)?.[0] ?? null;
  }

  private extractDocuments(retXml: string): CteConsultaDocument[] {
    const documents: CteConsultaDocument[] = [];
    const seen = new Set<string>();

    const pushMatches = (tagName: string, schema: string) => {
      const regex = new RegExp(`<(?:\\w+:)?${tagName}\\b[\\s\\S]*?<\\/(?:\\w+:)?${tagName}>`, 'gi');
      for (const match of retXml.matchAll(regex)) {
        const xml = match[0];
        const signature = `${schema}:${xml}`;
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        documents.push({
          schema,
          xml,
          chaveAcesso: this.extractChaveAcesso(xml)
        });
      }
    };

    pushMatches('procEventoCTe', 'procEventoCTe_v4.00');
    if (!documents.some((document) => document.schema === 'procEventoCTe_v4.00')) {
      pushMatches('eventoCTe', 'eventoCTe_v4.00');
    }
    pushMatches('cteProc', 'cteProc_v4.00');
    pushMatches('procCTe', 'cteProc_v4.00');
    pushMatches('resCTe', 'resCTe_v1.00');
    pushMatches('CTe', 'CTe_v4.00');

    if (documents.length === 0) {
      documents.push({
        schema: 'retConsSitCTe_v4.00',
        xml: retXml,
        chaveAcesso: this.extractChaveAcesso(retXml)
      });
    } else if (!documents.some((document) => document.schema === 'retConsSitCTe_v4.00')) {
      documents.unshift({
        schema: 'retConsSitCTe_v4.00',
        xml: retXml,
        chaveAcesso: this.extractChaveAcesso(retXml)
      });
    }

    return documents;
  }

  private extractChaveAcesso(xml: string): string | undefined {
    const id = xml.match(/\bId\s*=\s*["']CTe(\d{44})["']/i)?.[1];
    if (id) {
      return id;
    }

    const explicit = this.extractFirstTagText(xml, 'chCTe');
    if (explicit) {
      return explicit.replace(/\D/g, '').slice(-44);
    }

    return xml.match(/\b\d{44}\b/)?.[0];
  }

  private extractFirstTagText(xml: string, tagName: string): string | undefined {
    const regex = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, 'i');
    const match = regex.exec(xml);
    return match?.[1] ? this.cleanTextContent(match[1]) : undefined;
  }

  private extractSoapFault(soapXml: string): string | null {
    const reason =
      soapXml.match(/<(?:\w+:)?Text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/i)?.[1] ??
      soapXml.match(/<(?:\w+:)?faultstring\b[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i)?.[1];
    if (!reason) {
      return null;
    }

    return this.cleanTextContent(this.decodeXmlEntities(reason)) || null;
  }

  private shouldRetryWithAlternatePayload(parsed: { cStat?: string; xMotivo?: string }): boolean {
    return String(parsed.cStat || '').trim() === '243' && /xml mal formado/i.test(String(parsed.xMotivo || ''));
  }

  private shouldRetryWithAlternatePayloadError(message: string): boolean {
    const normalized = String(message || '').trim().toLowerCase();
    return (
      normalized.includes('cteconsultact') &&
      (normalized.includes('cannot find dispatch method') || normalized.includes('does not match an operation'))
    );
  }

  private shouldRetryWithAlternateEndpoint(parsed: { cStat?: string; xMotivo?: string }, fallbackUrl?: URL): boolean {
    return Boolean(fallbackUrl) && String(parsed.cStat || '').trim() === '410';
  }

  private escapeXmlForElementContent(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private decodeHttpResponseBody(headers: IncomingHttpHeaders, payload: Buffer): string {
    const encodingHeader = Array.isArray(headers['content-encoding']) ? headers['content-encoding'][0] : headers['content-encoding'];
    const encoding = String(encodingHeader || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .find(Boolean);

    try {
      if (encoding === 'gzip' || encoding === 'x-gzip') {
        return gunzipSync(payload).toString('utf8');
      }
      if (encoding === 'deflate') {
        return inflateSync(payload).toString('utf8');
      }
      if (encoding === 'br') {
        return brotliDecompressSync(payload).toString('utf8');
      }
    } catch {
      return payload.toString('utf8');
    }

    return payload.toString('utf8');
  }

  private cleanTextContent(value: string): string {
    return this.decodeXmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&');
  }

  private extractCUfFromChave(chaveAcesso: string): string {
    const digits = this.onlyDigits(chaveAcesso);
    if (digits.length < 2) {
      throw new Error('Chave de acesso do CT-e invalida para resolver cUF');
    }

    return digits.slice(0, 2);
  }

  private resolveConsultaProducaoUrlByCUf(cUf: string): string {
    const directByCUf: Record<string, string> = {
      '50': 'https://producao.cte.ms.gov.br/ws/CTeConsultaV4',
      '51': 'https://cte.sefaz.mt.gov.br/ctews2/services/CTeConsultaV4',
      '31': 'https://cte.fazenda.mg.gov.br/cte/services/CTeConsultaV4',
      '41': 'https://cte.fazenda.pr.gov.br/cte4/CTeConsultaV4',
      '43': 'https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx',
      '35': 'https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx'
    };

    if (directByCUf[cUf]) {
      return directByCUf[cUf];
    }

    const svrsStates = new Set(['11', '12', '13', '15', '17', '21', '22', '23', '24', '25', '27', '28', '29', '32', '33', '42', '52', '53']);
    if (svrsStates.has(cUf)) {
      return 'https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx';
    }

    const svspStates = new Set(['14', '16', '26']);
    if (svspStates.has(cUf)) {
      return 'https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx';
    }

    throw new Error(`Nao existe endpoint padrao de producao mapeado para o cUF ${cUf} no CteConsultaV4`);
  }

  private previewBody(body: string): string {
    const compact = String(body || '').replace(/\s+/g, ' ').trim();
    return compact ? compact.slice(0, 240) : '(vazio)';
  }

  private isSameEndpoint(left: URL, right: URL): boolean {
    return left.toString() === right.toString();
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Erro inesperado';
  }

  private isUnsupportedPkcs12Error(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('unsupported pkcs12 pfx data') ||
      (normalized.includes('pkcs12') && normalized.includes('unsupported')) ||
      normalized.includes('err_ossl_evp_unsupported') ||
      (normalized.includes('digital envelope routines') && normalized.includes('unsupported'))
    );
  }

  private isLocalIssuerCertificateError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('unable to get local issuer certificate') ||
      normalized.includes('unable_to_get_issuer_cert_locally') ||
      normalized.includes('self signed certificate in certificate chain') ||
      normalized.includes('self-signed certificate in certificate chain')
    );
  }

  private shouldRetryWithSoap11(response: { statusCode: number; body: string }): boolean {
    const body = String(response.body || '').trim();
    return response.statusCode === 400 && !body;
  }

  private shouldRetryWithAlternateSoap12Action(response: { statusCode: number; body: string }): boolean {
    const normalizedBody = String(response.body || '').trim().toLowerCase();
    return (
      (normalizedBody.includes('action') &&
        normalizedBody.includes('cteconsultact') &&
        (normalizedBody.includes('was not recognized') || normalizedBody.includes('does not match an operation'))) ||
      (normalizedBody.includes('valid action parameter') && normalizedBody.includes('soap action'))
    );
  }

  private async convertPfxToPemCredentials(pfx: Buffer, passphrase: string): Promise<PemCredentials> {
    const tempDir = await mkdtemp(join(tmpdir(), 'cte-mtls-'));
    const pfxPath = join(tempDir, 'certificado.pfx');
    let lastError = '';

    try {
      await writeFile(pfxPath, pfx);

      for (const legacy of [false, true]) {
        const certExtract = this.runOpenSslPkcs12Extract(pfxPath, passphrase, ['-clcerts', '-nokeys'], legacy);
        if (!certExtract.ok) {
          if (certExtract.commandMissing) {
            throw new Error('OpenSSL nao encontrado no servidor. Instale OpenSSL ou use certificado PFX compativel com Node.');
          }
          lastError = certExtract.stderr ?? lastError;
          continue;
        }

        const keyExtract = this.runOpenSslPkcs12Extract(pfxPath, passphrase, ['-nocerts', '-nodes'], legacy);
        if (!keyExtract.ok) {
          lastError = keyExtract.stderr ?? lastError;
          continue;
        }

        return {
          mode: 'pem',
          cert: certExtract.stdout,
          key: keyExtract.stdout
        };
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    throw new Error(`Falha ao converter certificado PFX para PEM com OpenSSL. ${lastError || 'Sem detalhes.'}`);
  }

  private runOpenSslPkcs12Extract(
    pfxPath: string,
    passphrase: string,
    extractArgs: string[],
    legacy: boolean
  ): { ok: boolean; stdout: string; stderr: string; commandMissing: boolean } {
    const args = ['pkcs12', '-in', pfxPath, '-passin', `pass:${passphrase}`, ...extractArgs];
    if (legacy) {
      args.splice(1, 0, '-legacy');
    }

    const result = spawnSync('openssl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (result.error) {
      const commandMissing = (result.error as NodeJS.ErrnoException).code === 'ENOENT';
      return {
        ok: false,
        stdout: result.stdout ?? '',
        stderr: result.error.message || result.stderr || '',
        commandMissing
      };
    }

    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      commandMissing: false
    };
  }
}
