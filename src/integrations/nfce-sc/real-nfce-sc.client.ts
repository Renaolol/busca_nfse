import { Injectable } from '@nestjs/common';
import { Certificado } from '@prisma/client';
import { request as httpsRequest } from 'node:https';
import { gunzipSync } from 'node:zlib';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalStorageService } from '../../modules/storage/storage.service';
import { CryptoService } from '../../modules/shared/crypto.service';
import { NfceScClient, NfceScDownloadResult, NfceScDfe } from './nfce-sc.types';

const NS = 'http://www.satnfce.sef.sc.gov.br/ws/distribuicao-v1';
const URL = 'https://dfe.sat.sef.sc.gov.br/nfce/ws/distribuicao/DistribuicaoNfceDownload.asmx';
const ACTION = `${NS}/nfceDownloadContab`;

@Injectable()
export class RealNfceScClient implements NfceScClient {
  constructor(private readonly prisma: PrismaService, private readonly storage: LocalStorageService, private readonly crypto: CryptoService) {}

  async download(params: Parameters<NfceScClient['download']>[0]): Promise<NfceScDownloadResult> {
    const certificate = await this.loadCertificate(params.certificadoId);
    const pfxPayload = await this.storage.getObject(certificate.arquivoCriptografadoPath);
    const pfx = this.crypto.decrypt(pfxPayload.toString('utf8').trim());
    const passphrase = this.crypto.decrypt(certificate.senhaCriptografada).toString('utf8');
    const xml = this.buildRequest(params.cnpjConsulta, params.ultimoNsu, params.indAtor);
    const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><nfceDownloadContab xmlns="${NS}">${xml}</nfceDownloadContab></soap:Body></soap:Envelope>`;
    const response = await this.request(envelope, pfx, passphrase);
    if (response.status < 200 || response.status >= 300) throw new Error(`SEF/SC HTTP ${response.status}: ${response.body.slice(0, 300)}`);
    const resultXml = this.extractSoapResult(response.body);
    const cStat = this.tag(resultXml, 'cStat') || '9999';
    const xMotivo = this.tag(resultXml, 'xMotivo') || 'Resposta sem descricao de status';
    const ultimoNsu = BigInt(this.tag(resultXml, 'ultNuNSURet') || params.ultimoNsu.toString());
    const documentos = cStat === '118' ? this.extractDocuments(resultXml) : [];
    return { cStat, xMotivo, ultimoNsu, documentos, httpStatus: response.status };
  }

  private async loadCertificate(id: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id } });
    if (!certificate || !certificate.ativo) throw new Error('Certificado contabilista ativo nao encontrado');
    if (certificate.validadeFim && certificate.validadeFim < new Date()) throw new Error('Certificado contabilista vencido');
    return certificate;
  }

  private buildRequest(cnpj: string, nsu: bigint, indAtor: number): string {
    const cleanCnpj = String(cnpj || '').replace(/[^\dA-Za-z]/g, '');
    const identity = cleanCnpj.length <= 11 ? `<CPF>${cleanCnpj}</CPF>` : `<CNPJ>${cleanCnpj}</CNPJ>`;
    return `<distNfceSC versao="1.00" xmlns="${NS}"><tpAmb>1</tpAmb><verAplic>NotaSync/0.1</verAplic><cUF>42</cUF>${identity}<solRel><indXML>1</indXML><indAtor>${indAtor}</indAtor><ultNuNSU>${nsu}</ultNuNSU></solRel></distNfceSC>`;
  }

  private request(envelope: string, pfx: Buffer, passphrase: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(URL, {
        method: 'POST',
        pfx,
        passphrase,
        rejectUnauthorized: process.env.NFCE_SC_REJECT_UNAUTHORIZED !== 'false',
        timeout: Number(process.env.NFCE_SC_TIMEOUT_MS || 30000),
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${ACTION}"`,
          Accept: 'text/xml, application/xml',
          'Content-Length': Buffer.byteLength(envelope, 'utf8')
        }
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('Timeout consultando a distribuicao NFC-e SEF/SC')));
      req.on('error', reject);
      req.end(envelope, 'utf8');
    });
  }

  private extractSoapResult(body: string): string {
    const decoded = this.decodeEntities(body);
    const result = decoded.match(/<(?:\w+:)?nfceDownloadContabResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?nfceDownloadContabResult>/i)?.[1];
    if (!result) throw new Error('Resposta SOAP sem nfceDownloadContabResult');
    return result;
  }

  private extractDocuments(xml: string): NfceScDfe[] {
    const compressed = this.tag(xml, 'loteDistComp');
    if (compressed) {
      const batch = gunzipSync(Buffer.from(compressed.replace(/\s/g, ''), 'base64')).toString('utf8');
      return this.extractBatchEntries(batch);
    }
    return this.extractBatchEntries(xml);
  }

  private extractBatchEntries(xml: string): NfceScDfe[] {
    const rows: NfceScDfe[] = [];
    const re = /<(?:\w+:)?distNFCeSC\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?distNFCeSC>)/gi;
    for (const match of xml.matchAll(re)) {
      const attrs = match[1] || '';
      const body = match[2] || '';
      const nsu = attrs.match(/\bNSU\s*=\s*["'](\d+)["']/i)?.[1] || this.tag(body, 'NSU');
      const chaveAcesso = attrs.match(/\bchAcesso\s*=\s*["']([^"']+)["']/i)?.[1] || this.tag(body, 'chAcesso') || null;
      const document = body.match(/<(?:\w+:)?(?:nfeProc|procEventoNFe)\b[\s\S]*?<\/(?:\w+:)?(?:nfeProc|procEventoNFe)>/i)?.[0];
      if (nsu && document) rows.push({ nsu: BigInt(nsu), chaveAcesso, xml: document });
    }
    return rows.sort((a, b) => a.nsu < b.nsu ? -1 : a.nsu > b.nsu ? 1 : 0);
  }

  private tag(xml: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<(?:\\w+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escaped}>`, 'i'));
    return match?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
  }

  private decodeEntities(value: string): string {
    return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
}
