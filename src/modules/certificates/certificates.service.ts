import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Certificado } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { randomUUID, X509Certificate } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageService } from '../storage/storage.service';
import { CryptoService } from '../shared/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: LocalStorageService
  ) {}

  async create(clienteId: string, dto: CreateCertificateDto): Promise<Record<string, unknown>> {
    await this.ensureClientExists(clienteId);

    if (dto.estabelecimentoId) {
      await this.ensureEstablishmentBelongsToClient(dto.estabelecimentoId, clienteId);
    }

    const certificateId = randomUUID();
    const certificateBuffer = this.decodeBase64(dto.arquivoBase64);
    const extractedMetadata = await this.extractCertificateMetadata(certificateBuffer, dto.senha);

    const encryptedCertificate = this.crypto.encrypt(certificateBuffer);
    const encryptedPassword = this.crypto.encrypt(dto.senha);

    const key = `certificados/${clienteId}/${certificateId}.bin`;
    await this.storage.putObject(key, encryptedCertificate);

    if (dto.substituirCertificadoId) {
      await this.prisma.certificado.update({
        where: { id: dto.substituirCertificadoId },
        data: {
          ativo: false,
          substituidoPorCertificadoId: certificateId
        }
      });
    }

    const created = await this.prisma.certificado.create({
      data: {
        id: certificateId,
        clienteId,
        estabelecimentoId: dto.estabelecimentoId,
        nome: dto.nome,
        cnpjTitular: dto.cnpjTitular,
        tipo: 'A1',
        arquivoCriptografadoPath: key,
        senhaCriptografada: encryptedPassword,
        validadeInicio: extractedMetadata.validadeInicio,
        validadeFim: extractedMetadata.validadeFim,
        thumbprint: extractedMetadata.thumbprint ?? dto.thumbprint,
        serialNumber: extractedMetadata.serialNumber ?? dto.serialNumber,
        emissor: extractedMetadata.emissor ?? dto.emissor,
        subject: extractedMetadata.subject ?? dto.subject,
        ativo: true
      }
    });

    return this.toPublic(created);
  }

  async listByClient(clienteId: string): Promise<Array<Record<string, unknown>>> {
    const certificates = await this.prisma.certificado.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' }
    });

    return certificates.map((certificate) => this.toPublic(certificate));
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id } });
    if (!certificate) {
      throw new NotFoundException('Certificado nao encontrado');
    }

    return this.toPublic(certificate);
  }

  async setActive(id: string, ativo: boolean): Promise<Record<string, unknown>> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id } });
    if (!certificate) {
      throw new NotFoundException('Certificado nao encontrado');
    }

    const updated = await this.prisma.certificado.update({
      where: { id },
      data: { ativo }
    });

    return this.toPublic(updated);
  }

  async remove(id: string): Promise<{ id: string; removido: true }> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id } });
    if (!certificate) {
      throw new NotFoundException('Certificado nao encontrado');
    }

    if (certificate.ativo) {
      throw new BadRequestException('Certificado ativo nao pode ser excluido. Desative antes de excluir.');
    }

    await this.prisma.certificado.delete({ where: { id } });
    await this.storage.deleteObject(certificate.arquivoCriptografadoPath);

    return { id, removido: true };
  }

  async validate(id: string): Promise<{
    valido: boolean;
    motivos: string[];
    validadeFim?: Date | null;
  }> {
    const certificate = await this.prisma.certificado.findUnique({ where: { id } });

    if (!certificate) {
      throw new NotFoundException('Certificado nao encontrado');
    }

    const motivos: string[] = [];

    if (!certificate.ativo) {
      motivos.push('Certificado inativo');
    }

    if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
      motivos.push('Certificado vencido');
    }

    if (!certificate.cnpjTitular || certificate.cnpjTitular.length !== 14) {
      motivos.push('CNPJ titular invalido');
    }

    return {
      valido: motivos.length === 0,
      motivos,
      validadeFim: certificate.validadeFim
    };
  }

  private toPublic(certificate: Certificado): Record<string, unknown> {
    return {
      id: certificate.id,
      clienteId: certificate.clienteId,
      estabelecimentoId: certificate.estabelecimentoId,
      nome: certificate.nome,
      cnpjTitular: certificate.cnpjTitular,
      tipo: certificate.tipo,
      validadeInicio: certificate.validadeInicio,
      validadeFim: certificate.validadeFim,
      thumbprint: certificate.thumbprint,
      serialNumber: certificate.serialNumber,
      emissor: certificate.emissor,
      subject: certificate.subject,
      ativo: certificate.ativo,
      substituidoPorCertificadoId: certificate.substituidoPorCertificadoId,
      createdAt: certificate.createdAt,
      updatedAt: certificate.updatedAt,
      arquivoCriptografadoPath: certificate.arquivoCriptografadoPath
    };
  }

  private async ensureClientExists(clienteId: string): Promise<void> {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!client) {
      throw new NotFoundException('Cliente nao encontrado');
    }
  }

  private async ensureEstablishmentBelongsToClient(estabelecimentoId: string, clienteId: string): Promise<void> {
    const establishment = await this.prisma.clienteEstabelecimento.findUnique({
      where: { id: estabelecimentoId }
    });

    if (!establishment || establishment.clienteId !== clienteId) {
      throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
    }
  }

  private decodeBase64(input: string): Buffer {
    const normalized = input.trim().replace(/\s+/g, '');
    if (!normalized || /[^A-Za-z0-9+/=]/.test(normalized)) {
      throw new BadRequestException('Arquivo do certificado em Base64 invalido');
    }

    const buffer = Buffer.from(normalized, 'base64');
    const reencoded = buffer.toString('base64').replace(/=+$/g, '');
    const incoming = normalized.replace(/=+$/g, '');

    if (!buffer.length || reencoded !== incoming) {
      throw new BadRequestException('Arquivo do certificado em Base64 invalido');
    }

    return buffer;
  }

  private async extractCertificateMetadata(
    pfxBuffer: Buffer,
    password: string
  ): Promise<{
    validadeInicio: Date;
    validadeFim: Date;
    thumbprint?: string;
    serialNumber?: string;
    emissor?: string;
    subject?: string;
  }> {
    const tempDir = await mkdtemp(join(tmpdir(), 'nfse-cert-'));
    const pfxPath = join(tempDir, 'certificado.pfx');

    try {
      await writeFile(pfxPath, pfxBuffer);
      const attempts = [
        { legacy: false, clientOnly: true },
        { legacy: true, clientOnly: true },
        { legacy: false, clientOnly: false },
        { legacy: true, clientOnly: false }
      ];

      let lastOpenSslError = '';

      for (const attempt of attempts) {
        const output = this.runOpenSslExtract(pfxPath, password, attempt.legacy, attempt.clientOnly);
        if (!output.ok && output.commandMissing) {
          throw new InternalServerErrorException(
            'OpenSSL nao encontrado no servidor. Instale o OpenSSL para habilitar leitura automatica de certificados.'
          );
        }

        if (!output.ok || !output.stdout) {
          if (output.stderr) {
            lastOpenSslError = output.stderr;
          }
          continue;
        }

        const certificates = this.extractPemCertificates(output.stdout);
        if (certificates.length === 0) {
          continue;
        }

        const parsed = certificates.find((certificate) => !certificate.ca) ?? certificates[0];
        const validadeInicio = new Date(parsed.validFrom);
        const validadeFim = new Date(parsed.validTo);

        if (Number.isNaN(validadeInicio.getTime()) || Number.isNaN(validadeFim.getTime())) {
          throw new BadRequestException('Nao foi possivel identificar a validade do certificado.');
        }

        return {
          validadeInicio,
          validadeFim,
          thumbprint: (parsed.fingerprint256 ?? parsed.fingerprint)?.replaceAll(':', ''),
          serialNumber: parsed.serialNumber,
          emissor: parsed.issuer,
          subject: parsed.subject
        };
      }

      throw new BadRequestException(this.getCertificateReadErrorMessage(lastOpenSslError));
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new BadRequestException('Nao foi possivel ler o certificado. Verifique arquivo e senha.');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private runOpenSslExtract(
    pfxPath: string,
    password: string,
    legacy: boolean,
    clientOnly: boolean
  ): { ok: boolean; stdout?: string; stderr?: string; commandMissing?: boolean } {
    const args = ['pkcs12', '-in', pfxPath, '-nokeys', '-passin', 'env:OPENSSL_CERT_PASSWORD'];
    if (clientOnly) {
      args.push('-clcerts');
    }
    if (legacy) {
      args.push('-legacy');
    }

    const result = spawnSync('openssl', args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENSSL_CERT_PASSWORD: password
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

  private extractPemCertificates(output: string): X509Certificate[] {
    const matches = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    return matches.map((pem) => new X509Certificate(pem));
  }

  private getCertificateReadErrorMessage(openSslError: string): string {
    const normalized = (openSslError || '').toLowerCase();

    if (
      normalized.includes('invalid password') ||
      normalized.includes('mac verify error') ||
      normalized.includes('mac verify failure')
    ) {
      return 'Senha do certificado invalida.';
    }

    if (normalized.includes('asn1') || normalized.includes('decode') || normalized.includes('unsupported')) {
      return 'Arquivo de certificado invalido ou formato nao suportado.';
    }

    return 'Nao foi possivel ler o certificado. Verifique arquivo e senha.';
  }
}
