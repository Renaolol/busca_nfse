import { Injectable } from '@nestjs/common';
import { Certificado, NfeAmbiente } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import type * as libxmljs from 'libxmljs2';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalStorageService } from '../../modules/storage/storage.service';
import { CryptoService } from '../../modules/shared/crypto.service';
import { NfeDistribuicaoClient, NfeDistribuicaoDocument, NfeDistribuicaoResult } from './nfe-distribuicao.types';
import {
  NFE_MANIFESTACAO_EVENT_CODES,
  NfeManifestacaoClient,
  NfeManifestacaoClientError,
  NfeManifestacaoResult,
  NfeManifestacaoTipo
} from './nfe-manifestacao.types';

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
type SoapVersion = '1.1' | '1.2';
type SoapEnvelopeProfile = {
  id: string;
  includeSoapHeader: boolean;
  includeOperationWrapper: boolean;
  namespacedBody: boolean;
};

@Injectable()
export class RealNfeDistribuicaoClient implements NfeDistribuicaoClient, NfeManifestacaoClient {
  private static readonly SOAP_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
  private static readonly MANIFESTACAO_SOAP_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
  private static readonly XML_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';
  private static readonly AN_CUF = '91';
  private static manifestationSchema: libxmljs.Document | null = null;
  private static readonly LAYOUT_VERSION = process.env.NFE_DISTRIBUICAO_LAYOUT_VERSION?.trim() || '1.01';
  private static readonly ENVELOPE_PROFILES: SoapEnvelopeProfile[] = [
    {
      id: 'header-operation-body-namespaced',
      includeSoapHeader: true,
      includeOperationWrapper: true,
      namespacedBody: true
    },
    {
      id: 'operation-body-namespaced',
      includeSoapHeader: false,
      includeOperationWrapper: true,
      namespacedBody: true
    },
    {
      id: 'operation-body-plain',
      includeSoapHeader: false,
      includeOperationWrapper: true,
      namespacedBody: false
    },
    {
      id: 'header-operation-body-plain',
      includeSoapHeader: true,
      includeOperationWrapper: true,
      namespacedBody: false
    },
    {
      id: 'body-only-namespaced',
      includeSoapHeader: false,
      includeOperationWrapper: false,
      namespacedBody: true
    }
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly crypto: CryptoService
  ) {}

  async distribuirPorNsu(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    ultNsu: bigint;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    return this.executeConsulta({
      cnpjConsulta: params.cnpjConsulta,
      ambiente: params.ambiente,
      certificateId: params.certificateId,
      requestXml: this.buildRequestXml({
        cnpjConsulta: params.cnpjConsulta,
        cUfAutor: params.cUfAutor,
        ambiente: params.ambiente,
        consulta: {
          kind: 'distNSU',
          ultNsu: params.ultNsu
        }
      }),
      fallbackNsu: params.ultNsu
    });
  }

  async consultarPorNsu(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    nsu: bigint;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    return this.executeConsulta({
      cnpjConsulta: params.cnpjConsulta,
      ambiente: params.ambiente,
      certificateId: params.certificateId,
      requestXml: this.buildRequestXml({
        cnpjConsulta: params.cnpjConsulta,
        cUfAutor: params.cUfAutor,
        ambiente: params.ambiente,
        consulta: {
          kind: 'consNSU',
          nsu: params.nsu
        }
      }),
      fallbackNsu: params.nsu
    });
  }

  async consultarPorChave(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    chaveAcesso: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    return this.executeConsulta({
      cnpjConsulta: params.cnpjConsulta,
      ambiente: params.ambiente,
      certificateId: params.certificateId,
      requestXml: this.buildRequestXml({
        cnpjConsulta: params.cnpjConsulta,
        cUfAutor: params.cUfAutor,
        ambiente: params.ambiente,
        consulta: {
          kind: 'consChNFe',
          chaveAcesso: params.chaveAcesso
        }
      }),
      fallbackNsu: 0n
    });
  }

  async sendManifestacao(params: {
    cnpjConsulta: string;
    chaveAcesso: string;
    tipo: NfeManifestacaoTipo;
    sequencia: number;
    justificativa?: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeManifestacaoResult> {
    let pem: PemCredentials;
    let eventXml: string | undefined;
    let url: URL;
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const pfx = await this.getPfxCredentials(certificate);
      pem = await this.convertPfxToPemCredentials(pfx.pfx, pfx.passphrase);
    } catch (error) {
      throw new NfeManifestacaoClientError(this.toErrorMessage(error), false, 'certificate');
    }
    try {
      const unsignedEvent = this.buildManifestacaoEventXml(params);
      eventXml = this.signManifestacaoEvent(unsignedEvent, pem.key, pem.cert);
      await this.validateManifestacaoEventXml(eventXml);
      url = this.buildManifestacaoUrl(params.ambiente);
    } catch (error) {
      throw new NfeManifestacaoClientError(this.toErrorMessage(error), false, 'event_signing', eventXml);
    }
    const operation = 'nfeRecepcaoEvento';
    let response: { statusCode: number; headers: IncomingHttpHeaders; body: string };
    try {
      response = await this.doSoapRequest(
        url,
        pem,
        eventXml,
        '1.2',
        { id: 'manifestacao-evento', includeSoapHeader: false, includeOperationWrapper: true, namespacedBody: true },
        operation,
        RealNfeDistribuicaoClient.MANIFESTACAO_SOAP_NAMESPACE
      );
    } catch (error) {
      throw new NfeManifestacaoClientError(this.toErrorMessage(error), true, 'communication', eventXml);
    }
    let parsed: Omit<NfeManifestacaoResult, 'statusCode'>;
    try {
      parsed = this.parseManifestacaoResponse(response.body);
    } catch (error) {
      throw new NfeManifestacaoClientError(this.toErrorMessage(error), true, 'response', eventXml, response.body);
    }

    if (!parsed.cStat) {
      throw new NfeManifestacaoClientError(
        `Resposta SOAP de manifestacao sem cStat (HTTP ${response.statusCode}).`,
        true,
        'response',
        eventXml,
        response.body
      );
    }

    return {
      statusCode: response.statusCode,
      ...parsed,
      signedEventXml: eventXml,
      responseXml: response.body
    };
  }

  private async executeConsulta(params: {
    cnpjConsulta: string;
    ambiente: NfeAmbiente;
    certificateId: string;
    requestXml: string;
    fallbackNsu: bigint;
  }): Promise<NfeDistribuicaoResult> {
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const url = this.buildDistribuicaoUrl(params.ambiente);
      const response = await this.doSoapRequestWithFallback(url, certificate, params.requestXml);
      let parsed;

      try {
        parsed = this.parseSoapResponse(response.body);
      } catch (error) {
        const parseMessage = this.toErrorMessage(error);
        const responseDetails = this.describeHttpResponse(response.statusCode, response.headers, response.body);
        return {
          statusCode: response.statusCode,
          cStat: '000',
          xMotivo: this.normalizeQueryErrorMessage(`${parseMessage}. ${responseDetails}`),
          ultNsu: params.fallbackNsu,
          maxNsu: params.fallbackNsu,
          documents: [],
          rawResponse: response.body
        };
      }

      return {
        statusCode: response.statusCode,
        cStat: parsed.cStat,
        xMotivo: parsed.xMotivo,
        ultNsu: parsed.ultNsu,
        maxNsu: parsed.maxNsu,
        documents: parsed.documents,
        documentExtraction: parsed.documentExtraction,
        rawResponse: parsed.rawXml
      };
    } catch (error) {
      return {
        statusCode: 0,
        cStat: '000',
        xMotivo: this.normalizeQueryErrorMessage(error),
        ultNsu: params.fallbackNsu,
        maxNsu: params.fallbackNsu,
        documents: [],
        rawResponse: { error: this.normalizeQueryErrorMessage(error) }
      };
    }
  }

  private async loadCertificate(certificateId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id: certificateId } });
    if (!certificate) {
      throw new Error('Certificado nao encontrado para distribuicao NF-e');
    }

    return certificate;
  }

  private async getPfxCredentials(certificate: Certificado): Promise<PfxCredentials> {
    let encryptedPfxPayload: Buffer;
    try {
      encryptedPfxPayload = await this.storage.getObject(certificate.arquivoCriptografadoPath);
    } catch (error) {
      const message = this.toErrorMessage(error);
      if (message.includes('ENOENT')) {
        throw new Error(
          'Arquivo do certificado nao encontrado no storage local. Recadastre o certificado para este estabelecimento.'
        );
      }
      throw error;
    }

    const encryptedPfx = encryptedPfxPayload.toString('utf8').trim();
    const pfx = this.crypto.decrypt(encryptedPfx);
    const passphrase = this.crypto.decrypt(certificate.senhaCriptografada).toString('utf8');

    return { mode: 'pfx', pfx, passphrase };
  }

  private buildDistribuicaoUrl(ambiente: NfeAmbiente): URL {
    const configured =
      ambiente === NfeAmbiente.producao
        ? process.env.NFE_DISTRIBUICAO_URL_PRODUCAO?.trim()
        : process.env.NFE_DISTRIBUICAO_URL_HOMOLOGACAO?.trim();

    const url =
      configured ||
      (ambiente === NfeAmbiente.producao
        ? 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
        : 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');

    return new URL(url);
  }

  private buildManifestacaoUrl(ambiente: NfeAmbiente): URL {
    const configured = ambiente === NfeAmbiente.producao
      ? process.env.NFE_MANIFESTACAO_URL_PRODUCAO?.trim()
      : process.env.NFE_MANIFESTACAO_URL_HOMOLOGACAO?.trim();
    const url = configured || (ambiente === NfeAmbiente.producao
      ? 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
      : 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
    return new URL(url);
  }

  private buildManifestacaoEventXml(params: {
    cnpjConsulta: string;
    chaveAcesso: string;
    tipo: NfeManifestacaoTipo;
    sequencia: number;
    justificativa?: string;
    ambiente: NfeAmbiente;
  }): string {
    const tipoEvento = NFE_MANIFESTACAO_EVENT_CODES[params.tipo];
    const descEvento = this.getManifestacaoDescricao(params.tipo);
    const digits = String(params.cnpjConsulta || '').replace(/\D/g, '');
    const actorTag = digits.length === 11 ? 'CPF' : 'CNPJ';
    const tpAmb = params.ambiente === NfeAmbiente.producao ? '1' : '2';
    const id = `ID${tipoEvento}${params.chaveAcesso}${String(params.sequencia).padStart(2, '0')}`;
    const dhEvento = this.formatEventDateWithOffset(new Date());
    const justificativa = params.tipo === 'operacao_nao_realizada' && params.justificativa
      ? `<xJust>${this.escapeXml(params.justificativa)}</xJust>`
      : '';

    return [
      `<envEvento xmlns="${RealNfeDistribuicaoClient.XML_NAMESPACE}" versao="1.00">`,
      `<idLote>${Date.now()}</idLote>`,
      '<evento versao="1.00">',
      `<infEvento Id="${id}">`,
      '<cOrgao>91</cOrgao>',
      `<tpAmb>${tpAmb}</tpAmb>`,
      `<${actorTag}>${digits}</${actorTag}>`,
      `<chNFe>${params.chaveAcesso}</chNFe>`,
      `<dhEvento>${dhEvento}</dhEvento>`,
      `<tpEvento>${tipoEvento}</tpEvento>`,
      `<nSeqEvento>${params.sequencia}</nSeqEvento>`,
      '<verEvento>1.00</verEvento>',
      '<detEvento versao="1.00">',
      `<descEvento>${descEvento}</descEvento>`,
      justificativa,
      '</detEvento>',
      '</infEvento>',
      '</evento>',
      '</envEvento>'
    ].join('');
  }

  private signManifestacaoEvent(xml: string, privateKey: string, certificatePem: string): string {
    const id = xml.match(/<infEvento\b[^>]*\bId="([^"]+)"/i)?.[1];
    if (!id) {
      throw new Error('Evento de manifestacao sem identificador para assinatura.');
    }
    const certificate = certificatePem
      .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
    const canonicalization = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
    const signature = new SignedXml({
      privateKey,
      publicCert: certificatePem,
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      canonicalizationAlgorithm: canonicalization,
      getKeyInfoContent: () => `<X509Data><X509Certificate>${certificate}</X509Certificate></X509Data>`
    });
    signature.addReference({
      xpath: "//*[local-name(.)='infEvento']",
      uri: `#${id}`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        canonicalization
      ],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
    });
    signature.computeSignature(xml, {
      location: { reference: "//*[local-name(.)='infEvento']", action: 'after' }
    });
    return signature.getSignedXml();
  }

  private async validateManifestacaoEventXml(xml: string): Promise<void> {
    const validator = await this.loadManifestacaoValidator();
    const eventDocument = validator.parseXml(xml, { nonet: true, noent: false, dtdload: false });
    const schema = this.getManifestacaoSchema(validator);
    if (eventDocument.validate(schema)) return;

    const details = eventDocument.validationErrors
      .slice(0, 3)
      .map((validationError) => validationError.message)
      .join(' ');
    throw new Error(`XML de manifestacao invalido no schema oficial envConfRecebto_v1.00.xsd. ${details}`.trim());
  }

  private async loadManifestacaoValidator(): Promise<typeof import('libxmljs2')> {
    try {
      return await import('libxmljs2');
    } catch {
      throw new Error('Validador XSD NF-e indisponivel. Recompile libxmljs2 para a versao e arquitetura do Node deste servico; nenhum evento foi transmitido.');
    }
  }

  private getManifestacaoSchema(validator: typeof import('libxmljs2')): libxmljs.Document {
    if (RealNfeDistribuicaoClient.manifestationSchema) {
      return RealNfeDistribuicaoClient.manifestationSchema;
    }

    const schemaPath = join(__dirname, 'schemas', 'envConfRecebto_v1.00.xsd');
    const schemaXml = readFileSync(schemaPath, 'utf8');
    RealNfeDistribuicaoClient.manifestationSchema = validator.parseXml(schemaXml, {
      baseUrl: schemaPath,
      nonet: true,
      noent: false,
      dtdload: false
    });
    return RealNfeDistribuicaoClient.manifestationSchema;
  }

  private formatEventDateWithOffset(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      timeZoneName: 'longOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    const offset = value('timeZoneName').replace(/^GMT/, '') || '-03:00';
    return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}${offset}`;
  }

  private getManifestacaoDescricao(tipo: NfeManifestacaoTipo): string {
    const descriptions: Record<NfeManifestacaoTipo, string> = {
      ciencia_operacao: 'Ciencia da Operacao',
      confirmacao_operacao: 'Confirmacao da Operacao',
      desconhecimento_operacao: 'Desconhecimento da Operacao',
      operacao_nao_realizada: 'Operacao nao Realizada'
    };
    return descriptions[tipo];
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private parseManifestacaoResponse(response: string): Omit<NfeManifestacaoResult, 'statusCode'> {
    let decoded = response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wrapper = decoded.match(/<(?:\w+:)?nfeRecepcaoEventoResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?nfeRecepcaoEventoResult>/i)?.[1];
      decoded = this.decodeXmlEntities(wrapper ?? decoded);
    }
    const retEnv = decoded.match(/<(?:\w+:)?retEnvEvento\b[^>]*>[\s\S]*?<\/(?:\w+:)?retEnvEvento>/i)?.[0] ?? decoded;
    const eventBlock = retEnv.match(/<(?:\w+:)?retEvento\b[^>]*>[\s\S]*?<\/(?:\w+:)?retEvento>/i)?.[0] ?? '';
    const eventInfo = eventBlock.match(/<(?:\w+:)?infEvento\b[^>]*>[\s\S]*?<\/(?:\w+:)?infEvento>/i)?.[0] ?? eventBlock;

    return {
      cStat: this.extractFirstTagText(retEnv, 'cStat') ?? null,
      xMotivo: this.extractFirstTagText(retEnv, 'xMotivo') ?? null,
      eventCStat: this.extractFirstTagText(eventInfo, 'cStat') ?? null,
      eventXMotivo: this.extractFirstTagText(eventInfo, 'xMotivo') ?? null,
      nProt: this.extractFirstTagText(eventInfo, 'nProt') ?? null
    };
  }

  private buildRequestXml(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    ambiente: NfeAmbiente;
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
  }): string {
    const tpAmb = params.ambiente === NfeAmbiente.producao ? '1' : '2';
    const documentoConsulta = this.onlyDigits(params.cnpjConsulta);
    if (documentoConsulta.length !== 11 && documentoConsulta.length !== 14) {
      throw new Error('O identificador da consulta NF-e deve ser um CPF com 11 digitos ou um CNPJ com 14 digitos');
    }
    const tagDocumento = documentoConsulta.length === 11 ? 'CPF' : 'CNPJ';
    const cUfAutor = this.resolveCUfAutor(params.cUfAutor);
    const consultaXml =
      params.consulta.kind === 'distNSU'
        ? `<distNSU><ultNSU>${params.consulta.ultNsu.toString().padStart(15, '0')}</ultNSU></distNSU>`
        : params.consulta.kind === 'consNSU'
          ? `<consNSU><NSU>${params.consulta.nsu.toString().padStart(15, '0')}</NSU></consNSU>`
          : `<consChNFe><chNFe>${this.onlyDigits(params.consulta.chaveAcesso)}</chNFe></consChNFe>`;

    return [
      `<distDFeInt xmlns="${RealNfeDistribuicaoClient.XML_NAMESPACE}" versao="${RealNfeDistribuicaoClient.LAYOUT_VERSION}">`,
      `<tpAmb>${tpAmb}</tpAmb>`,
      `<cUFAutor>${cUfAutor}</cUFAutor>`,
      `<${tagDocumento}>${documentoConsulta}</${tagDocumento}>`,
      consultaXml,
      `</distDFeInt>`
    ].join('');
  }

  private buildSoapEnvelope(
    requestXml: string,
    soapVersion: SoapVersion = '1.2',
    profile: SoapEnvelopeProfile = RealNfeDistribuicaoClient.ENVELOPE_PROFILES[0],
    operation = 'nfeDistDFeInteresse',
    serviceNamespace = RealNfeDistribuicaoClient.SOAP_NAMESPACE
  ): string {
    const envelopeNamespace =
      soapVersion === '1.2'
        ? 'http://www.w3.org/2003/05/soap-envelope'
        : 'http://schemas.xmlsoap.org/soap/envelope/';
    const prefix = soapVersion === '1.2' ? 'soap12' : 'soap';
    const bodyTagOpen = profile.namespacedBody
      ? `<nfeDadosMsg xmlns="${serviceNamespace}">`
      : '<nfeDadosMsg>';
    const bodyContent = profile.includeOperationWrapper
      ? [`<${operation} xmlns="${serviceNamespace}">`, bodyTagOpen, requestXml, `</nfeDadosMsg>`, `</${operation}>`]
      : [bodyTagOpen, requestXml, `</nfeDadosMsg>`];

    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<${prefix}:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
      ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"`,
      ` xmlns:${prefix}="${envelopeNamespace}">`,
      ...(profile.includeSoapHeader
        ? [
            `<${prefix}:Header>`,
            `<nfeCabecMsg xmlns="${serviceNamespace}">`,
            `<cUF>${RealNfeDistribuicaoClient.AN_CUF}</cUF>`,
            `<indComp>0</indComp>`,
            `<versaoDados>${RealNfeDistribuicaoClient.LAYOUT_VERSION}</versaoDados>`,
            `</nfeCabecMsg>`,
            `</${prefix}:Header>`
          ]
        : []),
      `<${prefix}:Body>`,
      ...bodyContent,
      `</${prefix}:Body>`,
      `</${prefix}:Envelope>`
    ].join('');
  }

  private async doSoapRequestWithFallback(
    url: URL,
    certificate: Certificado,
    requestXml: string
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    const pfxCredentials = await this.getPfxCredentials(certificate);

    try {
      return await this.doSoapRequestSequence(url, pfxCredentials, requestXml);
    } catch (error) {
      const message = this.toErrorMessage(error);
      if (!this.isUnsupportedPkcs12Error(message)) {
        throw error;
      }

      const pemCredentials = await this.convertPfxToPemCredentials(pfxCredentials.pfx, pfxCredentials.passphrase);
      return this.doSoapRequestSequence(url, pemCredentials, requestXml);
    }
  }

  private async doSoapRequestSequence(
    url: URL,
    mtls: MutualTlsCredentials,
    requestXml: string
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    const attempts: Array<{
      version: SoapVersion;
      profileId: string;
      statusCode: number;
      headers: IncomingHttpHeaders;
      bodyPreview: string;
    }> = [];
    let lastResponse: { statusCode: number; headers: IncomingHttpHeaders; body: string } | null = null;

    for (const version of ['1.2', '1.1'] as const) {
      for (const profile of RealNfeDistribuicaoClient.ENVELOPE_PROFILES) {
        const response = await this.doSoapRequest(url, mtls, requestXml, version, profile);
        attempts.push({
          version,
          profileId: profile.id,
          statusCode: response.statusCode,
          headers: response.headers,
          bodyPreview: this.previewBody(response.body)
        });
        lastResponse = response;

        if (!this.shouldRetryWithAlternativeRequest(response.statusCode, response.body)) {
          await this.persistDebugPayload(url, version, profile, requestXml, response, attempts);
          return response;
        }
      }
    }

    if (lastResponse) {
      await this.persistDebugPayload(
        url,
        '1.1',
        RealNfeDistribuicaoClient.ENVELOPE_PROFILES[RealNfeDistribuicaoClient.ENVELOPE_PROFILES.length - 1],
        requestXml,
        lastResponse,
        attempts
      );
      return lastResponse;
    }

    throw new Error('Nao foi possivel executar tentativas SOAP para distribuicao NF-e');
  }

  private doSoapRequest(
    url: URL,
    mtls: MutualTlsCredentials,
    requestXml: string,
    soapVersion: SoapVersion,
    profile: SoapEnvelopeProfile,
    operation = 'nfeDistDFeInteresse',
    serviceNamespace = RealNfeDistribuicaoClient.SOAP_NAMESPACE
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const envelope = this.buildSoapEnvelope(requestXml, soapVersion, profile, operation, serviceNamespace);
      const tlsOptions =
        mtls.mode === 'pfx'
          ? { pfx: mtls.pfx, passphrase: mtls.passphrase }
          : { cert: mtls.cert, key: mtls.key };
      const soapAction = `${serviceNamespace}/${operation}`;
      const contentType =
        soapVersion === '1.2'
          ? `application/soap+xml; charset=utf-8; action="${soapAction}"`
          : 'text/xml; charset=utf-8';
      const soapActionHeader = soapVersion === '1.2' ? soapAction : `"${soapAction}"`;

      const req = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : undefined,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            SOAPAction: soapActionHeader,
            Accept: 'application/soap+xml, text/xml, application/xml',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-Length': Buffer.byteLength(envelope, 'utf8')
          },
          ...tlsOptions,
          rejectUnauthorized: process.env.NFE_DISTRIBUICAO_REJECT_UNAUTHORIZED !== 'false',
          timeout: Number(process.env.NFE_DISTRIBUICAO_TIMEOUT_MS ?? 30000)
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on('end', () => {
            const payload = Buffer.concat(chunks);
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: this.decodeHttpResponseBody(res.headers, payload)
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Timeout ao consultar distribuicao NF-e'));
      });

      req.on('error', reject);
      req.write(envelope, 'utf8');
      req.end();
    });
  }

  private shouldRetryWithAlternativeRequest(statusCode: number, body: string): boolean {
    return statusCode === 400 && !String(body || '').trim();
  }

  private async persistDebugPayload(
    url: URL,
    soapVersion: SoapVersion,
    profile: SoapEnvelopeProfile,
    requestXml: string,
    response: { statusCode: number; headers: IncomingHttpHeaders; body: string },
    attempts: Array<{
      version: SoapVersion;
      profileId: string;
      statusCode: number;
      headers: IncomingHttpHeaders;
      bodyPreview: string;
    }>
  ): Promise<void> {
    const envelope = this.buildSoapEnvelope(requestXml, soapVersion, profile);
    const debugBase = 'nfe/debug';
    await this.storage.putObject(`${debugBase}/last-distribuicao-request.xml`, envelope);
    await this.storage.putObject(`${debugBase}/last-distribuicao-request-body.xml`, requestXml);
    await this.storage.putObject(`${debugBase}/last-distribuicao-response.txt`, response.body || '');
    await this.storage.putObject(
      `${debugBase}/last-distribuicao-meta.json`,
      JSON.stringify(
        {
          url: url.toString(),
          soapVersion,
          profile: profile.id,
          statusCode: response.statusCode,
          headers: response.headers,
          attempts
        },
        null,
        2
      )
    );
  }

  private parseSoapResponse(body: string): {
    cStat?: string;
    xMotivo?: string;
    ultNsu: bigint;
    maxNsu: bigint;
    documents: NfeDistribuicaoDocument[];
    documentExtraction: {
      docZipCount: number;
      discardedCount: number;
      schemaCounts: Record<string, number>;
    };
    rawXml: string;
  } {
    const fault = this.extractSoapFault(body);
    if (fault) {
      throw new Error(fault);
    }

    const innerXml = this.extractSoapResultXml(body);
    if (!innerXml) {
      throw new Error(`Resposta SOAP da distribuicao NF-e sem retDistDFeInt reconhecivel. Preview: ${this.previewBody(body)}`);
    }

    const cStat = this.extractFirstTagText(innerXml, 'cStat');
    const xMotivo = this.extractFirstTagText(innerXml, 'xMotivo');
    const ultNsu = this.parseOptionalBigInt(this.extractFirstTagText(innerXml, 'ultNSU')) ?? 0n;
    const maxNsu = this.parseOptionalBigInt(this.extractFirstTagText(innerXml, 'maxNSU')) ?? 0n;

    const extraction = this.extractDocuments(innerXml);

    return {
      cStat,
      xMotivo,
      ultNsu,
      maxNsu,
      documents: extraction.documents,
      documentExtraction: {
        docZipCount: extraction.docZipCount,
        discardedCount: extraction.discardedCount,
        schemaCounts: extraction.schemaCounts
      },
      rawXml: innerXml
    };
  }

  private extractSoapResultXml(soapXml: string): string | null {
    const normalizedSoapXml = this.decodeXmlEntities(soapXml);
    const direct = normalizedSoapXml.match(/<(?:\w+:)?retDistDFeInt\b[\s\S]*?<\/(?:\w+:)?retDistDFeInt>/i)?.[0];
    if (direct) {
      return direct;
    }

    const wrapped = normalizedSoapXml.match(
      /<(?:\w+:)?nfeDistDFeInteresseResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?nfeDistDFeInteresseResult>/i
    )?.[1];
    if (!wrapped) {
      return null;
    }

    const decoded = this.decodeXmlEntities(wrapped);
    return decoded.match(/<(?:\w+:)?retDistDFeInt\b[\s\S]*?<\/(?:\w+:)?retDistDFeInt>/i)?.[0] ?? null;
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

  private previewBody(body: string): string {
    const compact = String(body || '').replace(/\s+/g, ' ').trim();
    return compact ? compact.slice(0, 240) : '(vazio)';
  }

  private describeHttpResponse(statusCode: number, headers: IncomingHttpHeaders, body: string): string {
    const interestingHeaders = [
      'content-type',
      'content-length',
      'content-encoding',
      'transfer-encoding',
      'location',
      'server'
    ]
      .map((key) => {
        const rawValue = headers[key];
        if (!rawValue) {
          return null;
        }

        const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
        return `${key}=${value}`;
      })
      .filter(Boolean)
      .join(', ');

    return `HTTP ${statusCode}${interestingHeaders ? ` [${interestingHeaders}]` : ''}. Preview: ${this.previewBody(body)}`;
  }

  private extractDocuments(retXml: string): {
    documents: NfeDistribuicaoDocument[];
    docZipCount: number;
    discardedCount: number;
    schemaCounts: Record<string, number>;
  } {
    const matches = [...retXml.matchAll(/<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/gi)];
    const documents: NfeDistribuicaoDocument[] = [];
    const schemaCounts: Record<string, number> = {};
    let discardedCount = 0;

    for (const match of matches) {
      const attributes = match[1] ?? '';
      const payload = this.cleanTextContent(match[2] ?? '');
      const schema = this.extractAttribute(attributes, 'schema');
      const xml = this.extractXml(payload);
      const schemaName = schema || 'sem_schema';
      schemaCounts[schemaName] = (schemaCounts[schemaName] ?? 0) + 1;

      if (!schema || !xml) {
        discardedCount += 1;
        continue;
      }

      documents.push({
        nsu: this.parseOptionalBigInt(this.extractAttribute(attributes, 'NSU')),
        schema,
        xml,
        chaveAcesso: this.extractChaveAcesso(xml)
      });
    }

    return {
      documents,
      docZipCount: matches.length,
      discardedCount,
      schemaCounts
    };
  }

  private extractXml(payload: string): string | null {
    if (!payload) {
      return null;
    }

    try {
      return gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
    } catch {
      try {
        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        return decoded.includes('<') ? decoded : null;
      } catch {
        return null;
      }
    }
  }

  private extractChaveAcesso(xml: string): string | undefined {
    const explicit = this.extractFirstTagText(xml, 'chNFe');
    if (explicit) {
      return explicit.replace(/\D/g, '').slice(-44);
    }

    const id = xml.match(/\bId\s*=\s*["']NFe(\d{44})["']/i)?.[1];
    if (id) {
      return id;
    }

    const generic = xml.match(/\b\d{44}\b/)?.[0];
    return generic;
  }

  private extractFirstTagText(xml: string, tagName: string): string | undefined {
    const regex = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, 'i');
    const match = regex.exec(xml);
    return match?.[1] ? this.cleanTextContent(match[1]) : undefined;
  }

  private extractAttribute(source: string, attributeName: string): string | undefined {
    const regex = new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, 'i');
    return regex.exec(source)?.[1]?.trim();
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

  private parseOptionalBigInt(value?: string): bigint | undefined {
    if (!value) {
      return undefined;
    }

    try {
      return BigInt(value.replace(/\D/g, '') || value);
    } catch {
      return undefined;
    }
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private resolveCUfAutor(cUfAutor?: string): string {
    const explicit = this.onlyDigits(String(cUfAutor || ''));
    if (explicit.length === 2) {
      return explicit;
    }

    const configured = this.onlyDigits(String(process.env.NFE_DISTRIBUICAO_CUF_AUTOR || ''));
    if (configured.length === 2) {
      return configured;
    }

    return RealNfeDistribuicaoClient.AN_CUF;
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

  private async convertPfxToPemCredentials(pfx: Buffer, passphrase: string): Promise<PemCredentials> {
    const tempDir = await mkdtemp(join(tmpdir(), 'nfe-mtls-'));
    const pfxPath = join(tempDir, 'certificado.pfx');
    let lastError = '';

    try {
      await writeFile(pfxPath, pfx);

      for (const legacy of [false, true]) {
        const certExtract = this.runOpenSslPkcs12Extract(pfxPath, passphrase, ['-clcerts', '-nokeys'], legacy);
        if (!certExtract.ok) {
          if (certExtract.commandMissing) {
            throw new Error(
              'OpenSSL nao encontrado no servidor. Instale OpenSSL ou use certificado PFX compativel com Node.'
            );
          }
          lastError = certExtract.stderr ?? lastError;
          continue;
        }

        const keyExtract = this.runOpenSslPkcs12Extract(pfxPath, passphrase, ['-nocerts', '-nodes'], legacy);
        if (!keyExtract.ok) {
          if (keyExtract.commandMissing) {
            throw new Error(
              'OpenSSL nao encontrado no servidor. Instale OpenSSL ou use certificado PFX compativel com Node.'
            );
          }
          lastError = keyExtract.stderr ?? lastError;
          continue;
        }

        const cert = this.extractPemBlock(certExtract.stdout ?? '', 'CERTIFICATE');
        const key = this.extractPrivateKeyPem(keyExtract.stdout ?? '');

        if (cert && key) {
          return { mode: 'pem', cert, key };
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    throw new Error(
      `Nao foi possivel converter certificado PFX para PEM. Detalhe: ${lastError || 'erro desconhecido'}.`
    );
  }

  private runOpenSslPkcs12Extract(
    pfxPath: string,
    passphrase: string,
    extraArgs: string[],
    legacy: boolean
  ): { ok: boolean; stdout?: string; stderr?: string; commandMissing?: boolean } {
    const args = ['pkcs12', '-in', pfxPath, '-passin', 'env:OPENSSL_CERT_PASSWORD', ...extraArgs];
    if (legacy) {
      args.push('-legacy');
    }

    const result = spawnSync('openssl', args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENSSL_CERT_PASSWORD: passphrase
      },
      maxBuffer: 1024 * 1024 * 5
    });

    if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
      return { ok: false, commandMissing: true, stderr: result.error.message };
    }

    if (result.error || result.status !== 0) {
      return { ok: false, stderr: result.stderr };
    }

    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  }

  private extractPemBlock(content: string, blockType: string): string | null {
    const regex = new RegExp(`-----BEGIN ${blockType}-----[\\s\\S]+?-----END ${blockType}-----`, 'm');
    return content.match(regex)?.[0] ?? null;
  }

  private extractPrivateKeyPem(content: string): string | null {
    const match =
      content.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/m) ??
      content.match(/-----BEGIN ENCRYPTED PRIVATE KEY-----[\s\S]+?-----END ENCRYPTED PRIVATE KEY-----/m) ??
      content.match(/-----BEGIN RSA PRIVATE KEY-----[\s\S]+?-----END RSA PRIVATE KEY-----/m) ??
      content.match(/-----BEGIN EC PRIVATE KEY-----[\s\S]+?-----END EC PRIVATE KEY-----/m);

    return match?.[0] ?? null;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error);
  }

  private normalizeQueryErrorMessage(error: unknown): string {
    const message = this.toErrorMessage(error);
    const normalized = message.toLowerCase();

    if (
      normalized.includes('unsupported state or unable to authenticate data') ||
      normalized.includes('unable to authenticate data')
    ) {
      return 'Falha ao descriptografar certificado/senha. Verifique CERT_MASTER_KEY e recadastre o certificado.';
    }

    if (normalized.includes('self-signed certificate in certificate chain')) {
      return (
        'Falha na validacao TLS da distribuicao NF-e: certificado autoassinado na cadeia apresentada pelo servidor/proxy. ' +
        'Verifique a cadeia CA do ambiente, inspecao HTTPS/proxy corporativo e a configuracao de truststore do servidor.'
      );
    }

    return message;
  }
}
