import { Injectable } from '@nestjs/common';
import { Certificado } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PrismaService } from '../../prisma/prisma.service';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import { LocalStorageService } from '../../modules/storage/storage.service';
import { CryptoService } from '../../modules/shared/crypto.service';
import { AdnDFeDocument, AdnDFeResult, NfseAdnClient } from './nfse-adn.types';

type DfeItem = {
  NSU?: string | number;
  Nsu?: string | number;
  nsu?: string | number;
  NsuRecepcao?: string | number;
  nsuRecepcao?: string | number;
  ChaveAcesso?: string;
  chaveAcesso?: string;
  ArquivoXml?: string;
  arquivoXml?: string;
  xml?: string;
  Mensagem?: string;
  mensagem?: string;
};

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

@Injectable()
export class RealNfseAdnClient implements NfseAdnClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly crypto: CryptoService
  ) {}

  async getDFeByNsu(params: {
    cnpjConsulta: string;
    nsu: bigint;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<AdnDFeResult> {
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const url = this.buildDfeUrl(params.ambiente, params.nsu);

      url.searchParams.set('cnpjConsulta', this.onlyDigits(params.cnpjConsulta));
      url.searchParams.set('lote', 'true');

      const response = await this.doGetWithFallback(url, certificate);
      const data = this.tryParseJson(response.body);

      if (response.statusCode === 404) {
        return {
          nsu: params.nsu,
          hasDocument: false,
          rawResponse: data ?? response.body,
          statusCode: response.statusCode,
          message: this.extractMessage(data, 'Sem documento para o NSU informado')
        };
      }

      if (response.statusCode !== 200) {
        return {
          nsu: params.nsu,
          hasDocument: false,
          rawResponse: data ?? response.body,
          statusCode: response.statusCode,
          message: this.extractMessage(data, `Falha na consulta ADN. HTTP ${response.statusCode}.`)
        };
      }

      const documents = this.extractDfeDocuments(data);
      const firstDocument = documents[0];
      if (!firstDocument) {
        return {
          nsu: params.nsu,
          hasDocument: false,
          rawResponse: data,
          statusCode: 200,
          message: 'Sem documento para o NSU informado'
        };
      }

      return {
        nsu: params.nsu,
        hasDocument: true,
        xml: firstDocument.xml,
        chaveAcesso: firstDocument.chaveAcesso,
        documents,
        rawResponse: data,
        statusCode: 200,
        message: firstDocument.message
      };
    } catch (error) {
      const normalizedMessage = this.normalizeAdnQueryErrorMessage(error);
      return {
        nsu: params.nsu,
        hasDocument: false,
        rawResponse: { error: normalizedMessage },
        statusCode: 0,
        message: `Erro ao consultar ADN real: ${normalizedMessage}`
      };
    }
  }

  async getEventosByChave(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<unknown> {
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const url = this.buildEventosUrl(params.ambiente, params.chaveAcesso);
      const response = await this.doGetWithFallback(url, certificate);

      return {
        statusCode: response.statusCode,
        data: this.tryParseJson(response.body) ?? response.body
      };
    } catch (error) {
      return {
        statusCode: 0,
        error: this.toErrorMessage(error)
      };
    }
  }

  private async loadCertificate(certificateId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id: certificateId } });
    if (!certificate) {
      throw new Error('Certificado nao encontrado para consulta ADN');
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

  private buildDfeUrl(ambiente: NfseAmbiente, nsu: bigint): URL {
    const baseUrl = this.getBaseUrl(ambiente);
    const base = this.ensureTrailingSlash(baseUrl);
    const prefix = this.getPathPrefix();

    return new URL(`${prefix}/DFe/${nsu.toString()}`, base);
  }

  private buildEventosUrl(ambiente: NfseAmbiente, chaveAcesso: string): URL {
    const baseUrl = this.getBaseUrl(ambiente);
    const base = this.ensureTrailingSlash(baseUrl);
    const prefix = this.getPathPrefix();

    return new URL(`${prefix}/NFSe/${chaveAcesso}/Eventos`, base);
  }

  private getBaseUrl(ambiente: NfseAmbiente): string {
    const isProducao = ambiente === NfseAmbiente.PRODUCAO;
    const baseUrl = isProducao
      ? process.env.NFSE_API_BASE_URL_PRODUCAO
      : process.env.NFSE_API_BASE_URL_RESTRITA;

    if (!baseUrl) {
      throw new Error(
        isProducao
          ? 'NFSE_API_BASE_URL_PRODUCAO nao configurada'
          : 'NFSE_API_BASE_URL_RESTRITA nao configurada'
      );
    }

    return baseUrl;
  }

  private getPathPrefix(): string {
    const configured = process.env.NFSE_ADN_PATH_PREFIX?.trim() || 'contribuintes';
    return configured.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private async doGetWithFallback(
    url: URL,
    certificate: Certificado
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    const pfxCredentials = await this.getPfxCredentials(certificate);

    try {
      return await this.doGet(url, pfxCredentials);
    } catch (error) {
      const message = this.toErrorMessage(error);
      if (!this.isUnsupportedPkcs12Error(message)) {
        throw error;
      }

      const pemCredentials = await this.convertPfxToPemCredentials(pfxCredentials.pfx, pfxCredentials.passphrase);
      return this.doGet(url, pemCredentials);
    }
  }

  private doGet(
    url: URL,
    mtls: MutualTlsCredentials
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const tlsOptions =
        mtls.mode === 'pfx'
          ? { pfx: mtls.pfx, passphrase: mtls.passphrase }
          : { cert: mtls.cert, key: mtls.key };

      const req = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            Accept: 'application/json'
          },
          ...tlsOptions,
          rejectUnauthorized: process.env.NFSE_ADN_REJECT_UNAUTHORIZED !== 'false',
          timeout: Number(process.env.NFSE_ADN_TIMEOUT_MS ?? 30000)
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
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Timeout ao consultar API ADN'));
      });

      req.on('error', reject);
      req.end();
    });
  }

  private tryParseJson(value: string): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private extractDfeDocuments(payload: Record<string, unknown> | null): AdnDFeDocument[] {
    const documents: AdnDFeDocument[] = [];

    for (const item of this.extractDfeItems(payload)) {
      const xml = this.extractXml(item.ArquivoXml ?? item.arquivoXml, item.xml);
      if (!xml) {
        continue;
      }

      const document: AdnDFeDocument = { xml };
      const nsu = this.parseNsuFromItem(item);
      const chaveAcesso = item.ChaveAcesso ?? item.chaveAcesso;
      const message = item.Mensagem ?? item.mensagem;

      if (nsu !== undefined) {
        document.nsu = nsu;
      }
      if (chaveAcesso) {
        document.chaveAcesso = chaveAcesso;
      }
      if (message) {
        document.message = message;
      }

      documents.push(document);
    }

    return documents;
  }

  private extractDfeItems(payload: Record<string, unknown> | null): DfeItem[] {
    if (!payload) {
      return [];
    }

    const candidates = [
      payload.LoteDFe,
      payload.loteDFe,
      payload.lotes,
      payload.Lotes,
      payload.documentos,
      payload.Documentos,
      payload.DFe,
      payload.dfe
    ];

    for (const candidate of candidates) {
      const items = this.extractDfeItemsFromCandidate(candidate);
      if (items.length > 0) {
        return items;
      }
    }

    if (
      typeof payload.ChaveAcesso === 'string' ||
      typeof payload.chaveAcesso === 'string' ||
      typeof payload.ArquivoXml === 'string' ||
      typeof payload.arquivoXml === 'string' ||
      typeof payload.xml === 'string'
    ) {
      return [payload as DfeItem];
    }

    return [];
  }

  private extractDfeItemsFromCandidate(candidate: unknown): DfeItem[] {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is DfeItem => typeof item === 'object' && item !== null);
    }

    if (typeof candidate !== 'object' || candidate === null) {
      return [];
    }

    const nestedArrays = Object.values(candidate as Record<string, unknown>).filter(Array.isArray);
    for (const nestedArray of nestedArrays) {
      const items = nestedArray.filter((item): item is DfeItem => typeof item === 'object' && item !== null);
      if (items.length > 0) {
        return items;
      }
    }

    return [];
  }

  private parseNsuFromItem(item: DfeItem): bigint | undefined {
    const raw = item.NSU ?? item.Nsu ?? item.nsu ?? item.NsuRecepcao ?? item.nsuRecepcao;
    if (raw === undefined || raw === null) {
      return undefined;
    }

    try {
      const nsu = BigInt(String(raw));
      return nsu >= 0n ? nsu : undefined;
    } catch {
      return undefined;
    }
  }

  private extractXml(compressedB64?: string, plainXml?: string): string | null {
    if (plainXml && plainXml.trim()) {
      return plainXml;
    }

    if (!compressedB64) {
      return null;
    }

    try {
      const zipped = Buffer.from(compressedB64, 'base64');
      return gunzipSync(zipped).toString('utf8');
    } catch {
      const asText = Buffer.from(compressedB64, 'base64').toString('utf8');
      if (asText.includes('<') && asText.includes('>')) {
        return asText;
      }

      return null;
    }
  }

  private extractMessage(payload: Record<string, unknown> | null, fallback: string): string {
    if (!payload) {
      return fallback;
    }

    const message = payload.message ?? payload.Mensagem ?? payload.erro;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }

    if (Array.isArray(message) && message.length > 0) {
      const asText = message
        .filter((item): item is string => typeof item === 'string')
        .join('; ')
        .trim();
      if (asText) {
        return asText;
      }
    }

    return fallback;
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
    const tempDir = await mkdtemp(join(tmpdir(), 'nfse-mtls-'));
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
    const regex = new RegExp(
      `-----BEGIN ${blockType}-----[\\s\\S]+?-----END ${blockType}-----`,
      'm'
    );
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

  private normalizeAdnQueryErrorMessage(error: unknown): string {
    const message = this.toErrorMessage(error);
    const normalized = message.toLowerCase();

    if (
      normalized.includes('unsupported state or unable to authenticate data') ||
      normalized.includes('unable to authenticate data')
    ) {
      return 'Falha ao descriptografar certificado/senha. Verifique CERT_MASTER_KEY e recadastre o certificado.';
    }

    return message;
  }
}
