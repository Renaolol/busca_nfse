import { Injectable } from '@nestjs/common';
import { Certificado } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { gunzipSync } from 'node:zlib';
import { CryptoService } from '../../modules/shared/crypto.service';
import { LocalStorageService } from '../../modules/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NfeScClient, NfeScDfe, NfeScDownloadResult } from './nfe-sc.types';

const NS = 'http://www.satnfe.sef.sc.gov.br/ws/distribuicao-v2';
const URL = 'https://satnfe.sef.sc.gov.br/ws/distribuicao/nfedownloadV2.asmx';
const ACTION = `${NS}/nfeDownloadContab`;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

type PfxCredentials = { mode: 'pfx'; pfx: Buffer; passphrase: string };
type PemCredentials = { mode: 'pem'; cert: string; key: string };
type MutualTlsCredentials = PfxCredentials | PemCredentials;

@Injectable()
export class RealNfeScClient implements NfeScClient {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly crypto: CryptoService
  ) {}

  async download(params: Parameters<NfeScClient['download']>[0]): Promise<NfeScDownloadResult> {
    if (params.ambiente !== 'producao') throw new Error('O servico SEF/SC de NF-e esta publicado somente para producao');
    if (!/^\d{11}$/.test(params.cpfConsulta)) throw new Error('O servico SEF/SC de NF-e requer CPF com 11 digitos');

    const certificate = await this.loadCertificate(params.certificadoId, params.clienteId, params.estabelecimentoId);
    const pfxPayload = await this.storage.getObject(certificate.arquivoCriptografadoPath);
    const pfx = this.crypto.decrypt(pfxPayload.toString('utf8').trim());
    const passphrase = this.crypto.decrypt(certificate.senhaCriptografada).toString('utf8');
    const requestXml = this.buildRequest(params.cpfConsulta, params.ultimoNsu, params.indAtor);
    const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><nfeDownloadContab xmlns="${NS}">${requestXml}</nfeDownloadContab></soap:Body></soap:Envelope>`;

    let response: { status: number; body: string };
    try {
      response = await this.request(envelope, { mode: 'pfx', pfx, passphrase });
    } catch (error) {
      if (!this.isUnsupportedPkcs12Error(this.toErrorMessage(error))) throw new Error('Falha de transporte TLS ao consultar a distribuicao NF-e SEF/SC');
      const credentials = await this.convertPfxToPemCredentials(pfx, passphrase);
      try {
        response = await this.request(envelope, credentials);
      } catch {
        throw new Error('Falha de transporte TLS ao consultar a distribuicao NF-e SEF/SC');
      }
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Falha HTTP ${response.status} ao consultar a distribuicao NF-e SEF/SC`);
    }

    const resultXml = this.extractSoapResult(response.body);
    const cStat = this.tag(resultXml, 'cStat') || '9999';
    const xMotivo = this.tag(resultXml, 'xMotivo') || 'Resposta sem descricao de status';
    const ultimoNsu = BigInt(this.tag(resultXml, 'ultNuNSURet') || params.ultimoNsu.toString());
    const documentos = cStat === '118' ? this.extractDocuments(resultXml) : [];
    const declaredCount = Number(this.tag(resultXml, 'qtDfeRet') || documentos.length);
    if (!Number.isSafeInteger(declaredCount) || declaredCount !== documentos.length || documentos.length > 50) {
      throw new Error('Resposta SEF/SC com quantidade de documentos inconsistente');
    }

    return { cStat, xMotivo, ultimoNsu, documentos, httpStatus: response.status };
  }

  private async loadCertificate(id: string, clienteId: string, estabelecimentoId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id } });
    if (!certificate || !certificate.ativo || certificate.tipo.toUpperCase() !== 'A1') {
      throw new Error('Certificado A1 ativo nao encontrado');
    }
    if (certificate.validadeFim && certificate.validadeFim < new Date()) throw new Error('Certificado A1 vencido');
    if (certificate.clienteId && certificate.clienteId !== clienteId) throw new Error('Certificado fora do escopo do cliente');
    if (certificate.estabelecimentoId && certificate.estabelecimentoId !== estabelecimentoId) {
      throw new Error('Certificado fora do escopo do estabelecimento');
    }
    return certificate;
  }

  private buildRequest(cpf: string, nsu: bigint, indAtor: number): string {
    return `<distNFeSC versao="2.02" xmlns="${NS}"><tpAmb>1</tpAmb><verAplic>NotaSync/0.1</verAplic><cUF>42</cUF><CPF>${cpf}</CPF><solRel><indXML>1</indXML><indAtor>${indAtor}</indAtor><ultNuNSU>${nsu}</ultNuNSU></solRel></distNFeSC>`;
  }

  private request(envelope: string, credentials: MutualTlsCredentials): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const tlsOptions = credentials.mode === 'pfx'
        ? { pfx: credentials.pfx, passphrase: credentials.passphrase }
        : { cert: credentials.cert, key: credentials.key };
      const req = httpsRequest(URL, {
        method: 'POST',
        ...tlsOptions,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        timeout: Number(process.env.NFE_SC_TIMEOUT_MS || 30000),
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${ACTION}"`,
          Accept: 'text/xml, application/xml',
          'Content-Length': Buffer.byteLength(envelope, 'utf8')
        }
      }, (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('SEF/SC response too large'));
            return;
          }
          chunks.push(buffer);
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('SEF/SC request timeout')));
      req.on('error', reject);
      req.end(envelope, 'utf8');
    });
  }

  private isUnsupportedPkcs12Error(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('unsupported pkcs12 pfx data') ||
      (normalized.includes('pkcs12') && normalized.includes('unsupported')) ||
      normalized.includes('err_ossl_evp_unsupported') ||
      (normalized.includes('digital envelope routines') && normalized.includes('unsupported'));
  }

  private async convertPfxToPemCredentials(pfx: Buffer, passphrase: string): Promise<PemCredentials> {
    let lastError = '';
    for (const legacy of [false, true]) {
      const certResult = this.runOpenSslPkcs12Extract(pfx, passphrase, ['-clcerts', '-nokeys'], legacy);
      if (!certResult.ok) {
        if (certResult.commandMissing) throw new Error('OpenSSL nao encontrado para carregar o certificado A1');
        lastError = certResult.stderr || lastError;
        continue;
      }
      const keyResult = this.runOpenSslPkcs12Extract(pfx, passphrase, ['-nocerts', '-nodes'], legacy);
      if (!keyResult.ok) {
        if (keyResult.commandMissing) throw new Error('OpenSSL nao encontrado para carregar o certificado A1');
        lastError = keyResult.stderr || lastError;
        continue;
      }
      const cert = this.extractPemBlock(certResult.stdout, 'CERTIFICATE');
      const key = this.extractPrivateKeyPem(keyResult.stdout);
      if (cert && key) return { mode: 'pem', cert, key };
    }
    throw new Error(`Nao foi possivel carregar o certificado A1. ${lastError.slice(0, 120) || 'Sem detalhes.'}`);
  }

  private runOpenSslPkcs12Extract(
    pfx: Buffer,
    passphrase: string,
    extraArgs: string[],
    legacy: boolean
  ): { ok: boolean; stdout: string; stderr: string; commandMissing: boolean } {
    const args = ['pkcs12', '-passin', 'env:NFE_SC_CERT_PASSWORD', ...extraArgs];
    if (legacy) args.push('-legacy');
    const result = spawnSync('openssl', args, {
      encoding: 'utf8',
      input: pfx,
      env: { ...process.env, NFE_SC_CERT_PASSWORD: passphrase },
      maxBuffer: 1024 * 1024 * 5
    });
    if (result.error) {
      return {
        ok: false,
        stdout: result.stdout || '',
        stderr: '',
        commandMissing: (result.error as NodeJS.ErrnoException).code === 'ENOENT'
      };
    }
    return { ok: result.status === 0, stdout: result.stdout || '', stderr: result.status === 0 ? '' : 'Certificado A1 invalido', commandMissing: false };
  }

  private extractPemBlock(content: string, blockType: string): string | null {
    const regex = new RegExp(`-----BEGIN ${blockType}-----[\\s\\S]+?-----END ${blockType}-----`, 'm');
    return content.match(regex)?.[0] ?? null;
  }

  private extractPrivateKeyPem(content: string): string | null {
    const match = content.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/m) ??
      content.match(/-----BEGIN ENCRYPTED PRIVATE KEY-----[\s\S]+?-----END ENCRYPTED PRIVATE KEY-----/m) ??
      content.match(/-----BEGIN RSA PRIVATE KEY-----[\s\S]+?-----END RSA PRIVATE KEY-----/m) ??
      content.match(/-----BEGIN EC PRIVATE KEY-----[\s\S]+?-----END EC PRIVATE KEY-----/m);
    return match?.[0] ?? null;
  }

  private extractSoapResult(body: string): string {
    const decoded = this.decodeEntities(body);
    const result = decoded.match(/<(?:\w+:)?nfeDownloadContabResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?nfeDownloadContabResult>/i)?.[1];
    if (!result) throw new Error('Resposta SOAP SEF/SC sem resultado de distribuicao');
    return result;
  }

  private extractDocuments(xml: string): NfeScDfe[] {
    const compressed = this.tag(xml, 'loteDistComp');
    if (!compressed) throw new Error('Resposta SEF/SC sem lote compactado');
    let batch: string;
    try {
      batch = gunzipSync(Buffer.from(compressed.replace(/\s/g, ''), 'base64')).toString('utf8');
    } catch {
      throw new Error('Lote compactado da SEF/SC invalido');
    }
    return this.extractBatchEntries(batch);
  }

  private extractBatchEntries(xml: string): NfeScDfe[] {
    const rows: NfeScDfe[] = [];
    const entryRegex = /<(?:\w+:)?distNFeSC\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?distNFeSC\s*>)/gi;
    for (const match of xml.matchAll(entryRegex)) {
      const attrs = match[1] || '';
      const body = match[2] || '';
      const nsu = attrs.match(/\bNSU\s*=\s*["'](\d+)["']/i)?.[1] || this.tag(body, 'NSU');
      const chaveAcesso = attrs.match(/\bchAcesso\s*=\s*["']([^"']+)["']/i)?.[1] || null;
      const documentMatch = body.match(/<(?:\w+:)?(nfeProc|procEventoNFe)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1\s*>/i);
      if (!nsu || !documentMatch) throw new Error('Documento SEF/SC sem NSU ou XML fiscal processado');
      const rootName = documentMatch[1];
      rows.push({
        nsu: BigInt(nsu),
        chaveAcesso,
        schema: rootName === 'nfeProc' ? 'nfeProc_v4.00' : 'procEventoNFe_v1.00',
        xml: documentMatch[0]
      });
    }
    return rows.sort((left, right) => left.nsu < right.nsu ? -1 : left.nsu > right.nsu ? 1 : 0);
  }

  private tag(xml: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<(?:\\w+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escaped}>`, 'i'));
    return match?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
  }

  private decodeEntities(value: string): string {
    return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
