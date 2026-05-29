import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';

  encrypt(input: Buffer | string): string {
    const iv = randomBytes(12);
    const key = this.getKey();
    const cipher = createCipheriv(this.algorithm, key, iv);
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
  }

  decrypt(payload: string): Buffer {
    const [ivB64, tagB64, encryptedB64] = payload.split('.');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');

    const decipher = createDecipheriv(this.algorithm, this.getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private getKey(): Buffer {
    const secret = process.env.CERT_MASTER_KEY?.trim();
    if (!secret || /^change[-_ ]?me/i.test(secret)) {
      throw new Error('CERT_MASTER_KEY nao configurada com valor seguro');
    }

    return createHash('sha256').update(secret).digest();
  }
}
