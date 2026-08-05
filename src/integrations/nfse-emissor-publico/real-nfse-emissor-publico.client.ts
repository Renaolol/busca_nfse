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
import { LocalStorageService } from '../../modules/storage/storage.service';
import { CryptoService } from '../../modules/shared/crypto.service';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import {
  NfseEmissorPublicoClient,
  NfseEmissorPublicoDpsResult,
  NfseEmissorPublicoNfseResult
} from './nfse-emissor-publico.types';

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
export class RealNfseEmissorPublicoClient implements NfseEmissorPublicoClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly crypto: CryptoService
  ) {}

  async getNfseByChave(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoNfseResult> {
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const url = this.buildNfseUrl(params.ambiente, params.chaveAcesso);
      const response = await this.doGetWithFallback(url, certificate);
      const data = this.tryParseJson(response.body);

      if (response.statusCode !== 200) {
        return {
          statusCode: response.statusCode,
          chaveAcesso: params.chaveAcesso,
          rawResponse: data ?? response.body,
          message: this.extractMessage(data, `Falha na consulta ao Emissor Publico. HTTP ${response.statusCode}.`)
        };
      }

      const xml = this.extractNfseXml(data, response.body);
      if (!xml) {
        return {
          statusCode: 200,
          chaveAcesso: params.chaveAcesso,
          rawResponse: data ?? response.body,
          message: 'Resposta do Emissor Publico sem XML da NFS-e.'
        };
      }

      return {
        statusCode: 200,
        chaveAcesso: params.chaveAcesso,
        xml,
        rawResponse: data ?? response.body
      };
    } catch (error) {
      return {
        statusCode: 0,
        chaveAcesso: params.chaveAcesso,
        rawResponse: { error: this.toErrorMessage(error) },
        message: `Erro ao consultar Emissor Publico: ${this.toErrorMessage(error)}`
      };
    }
  }

  async getNfseByDpsId(params: {
    dpsId: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoDpsResult> {
    try {
      const certificate = await this.loadCertificate(params.certificateId);
      const urls = this.buildDpsUrls(params.ambiente, params.dpsId);
      let lastResponse: { statusCode: number; headers: IncomingHttpHeaders; body: string } | null = null;

      for (const url of urls) {
        const response = await this.doGetWithFallback(url, certificate);
        lastResponse = response;
        if (response.statusCode === 200) {
          const data = this.tryParseJson(response.body);
          const xml = this.extractNfseXml(data, response.body);
          if (xml) {
            return {
              statusCode: 200,
              dpsId: params.dpsId,
              xml,
              rawResponse: data ?? response.body
            };
          }
        }

        if (response.statusCode !== 404 && response.statusCode !== 400) {
          const data = this.tryParseJson(response.body);
          return {
            statusCode: response.statusCode,
            dpsId: params.dpsId,
            rawResponse: data ?? response.body,
            message: this.extractMessage(data, `Falha na consulta da DPS no Emissor Publico. HTTP ${response.statusCode}.`)
          };
        }
      }

      const data = this.tryParseJson(lastResponse?.body ?? '');
      return {
        statusCode: lastResponse?.statusCode ?? 0,
        dpsId: params.dpsId,
        rawResponse: data ?? lastResponse?.body ?? null,
        message:
          this.extractMessage(data, '') ||
          'Resposta do Emissor Publico sem XML da NFS-e para a DPS consultada.'
      };
    } catch (error) {
      return {
        statusCode: 0,
        dpsId: params.dpsId,
        rawResponse: { error: this.toErrorMessage(error) },
        message: `Erro ao consultar DPS no Emissor Publico: ${this.toErrorMessage(error)}`
      };
    }
  }

  private async loadCertificate(certificateId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id: certificateId } });
    if (!certificate) {
      throw new Error('Certificado nao encontrado para consulta ao Emissor Publico');
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

  private buildNfseUrl(ambiente: NfseAmbiente, chaveAcesso: string): URL {
    const baseUrl = this.getBaseUrl(ambiente);
    const base = this.ensureTrailingSlash(baseUrl);
    const prefix = this.getPathPrefix();
    return new URL(`${prefix}/nfse/${this.onlyDigits(chaveAcesso)}`, base);
  }

  private buildDpsUrls(ambiente: NfseAmbiente, dpsId: string): URL[] {
    const baseUrl = this.getBaseUrl(ambiente);
    const base = this.ensureTrailingSlash(baseUrl);
    const prefix = this.getPathPrefix();
    const normalizedDpsId = this.normalizeDpsId(dpsId);
    const digitsOnly = normalizedDpsId.replace(/\D/g, '');

    return [
      new URL(`${prefix}/dps/${normalizedDpsId}`, base),
      new URL(`${prefix}/dps/${digitsOnly}`, base)
    ];
  }

  private getBaseUrl(ambiente: NfseAmbiente): string {
    const configured =
      ambiente === NfseAmbiente.PRODUCAO
        ? process.env.NFSE_EMISSOR_PUBLICO_API_BASE_URL_PRODUCAO?.trim()
        : process.env.NFSE_EMISSOR_PUBLICO_API_BASE_URL_RESTRITA?.trim();

    if (configured) {
      return configured;
    }

    return ambiente === NfseAmbiente.PRODUCAO
      ? 'https://sefin.nfse.gov.br'
      : 'https://sefin.producaorestrita.nfse.gov.br';
  }

  private getPathPrefix(): string {
    const configured = process.env.NFSE_EMISSOR_PUBLICO_PATH_PREFIX?.trim() || 'SefinNacional';
    return configured.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private normalizeDpsId(value: string): string {
    const trimmed = String(value || '').trim().toUpperCase();
    return trimmed.startsWith('DPS') ? trimmed : `DPS${trimmed.replace(/\D/g, '')}`;
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
            Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.8'
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
        req.destroy(new Error('Timeout ao consultar Emissor Publico'));
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

  private extractNfseXml(payload: Record<string, unknown> | null, rawBody: string): string | undefined {
    const rawXml = this.extractPlainXml(rawBody);
    if (rawXml) {
      return rawXml;
    }

    if (!payload) {
      return undefined;
    }

    const directCandidates = [
      payload.xml,
      payload.XML,
      payload.arquivoXml,
      payload.ArquivoXml,
      payload.nfseXml,
      payload.NfseXml
    ];

    for (const candidate of directCandidates) {
      const xml = this.extractXmlCandidate(candidate);
      if (xml) {
        return xml;
      }
    }

    for (const value of this.collectValues(payload, 250)) {
      const xml = this.extractXmlCandidate(value);
      if (xml) {
        return xml;
      }
    }

    return undefined;
  }

  private extractXmlCandidate(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const plainXml = this.extractPlainXml(value);
    if (plainXml) {
      return plainXml;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const zipped = Buffer.from(trimmed, 'base64');
      const unzipped = gunzipSync(zipped).toString('utf8');
      return this.extractPlainXml(unzipped);
    } catch {
      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
        return this.extractPlainXml(decoded);
      } catch {
        return undefined;
      }
    }
  }

  private extractPlainXml(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed.startsWith('<')) {
      return undefined;
    }

    if (!/(<NFSe\b|<CompNfse\b|<Nfse\b|<nfs:e\b|<nfseProc\b)/i.test(trimmed)) {
      return undefined;
    }

    return trimmed;
  }

  private collectValues(payload: unknown, limit: number): unknown[] {
    const queue: unknown[] = [payload];
    const values: unknown[] = [];
    let visited = 0;

    while (queue.length > 0 && visited < limit) {
      const current = queue.shift();
      visited += 1;
      values.push(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (current && typeof current === 'object') {
        queue.push(...Object.values(current as Record<string, unknown>));
      }
    }

    return values;
  }

  private extractMessage(payload: Record<string, unknown> | null, fallback: string): string {
    if (!payload) {
      return fallback;
    }

    const values = [payload.message, payload.Mensagem, payload.erro, payload.error];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
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
    const tempDir = await mkdtemp(join(tmpdir(), 'nfse-emissor-mtls-'));
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
}
