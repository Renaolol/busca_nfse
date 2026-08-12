import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

@Injectable()
export class PasswordHashService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, saltBase64, hashBase64] = String(storedHash || '').split('$');
    if (algorithm !== 'scrypt' || !saltBase64 || !hashBase64) {
      return false;
    }

    try {
      const salt = Buffer.from(saltBase64, 'base64');
      const expectedHash = Buffer.from(hashBase64, 'base64');
      const actualHash = (await scrypt(password, salt, expectedHash.length)) as Buffer;

      if (expectedHash.length !== actualHash.length) {
        return false;
      }

      return timingSafeEqual(expectedHash, actualHash);
    } catch {
      return false;
    }
  }
}
