import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

@Injectable()
export class LocalStorageService {
  private readonly rootPath = process.env.STORAGE_ROOT_PATH
    ? resolve(process.env.STORAGE_ROOT_PATH)
    : resolve(process.cwd(), 'storage');

  async putObject(key: string, content: Buffer | string): Promise<string> {
    const absolutePath = resolve(this.rootPath, key);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    return absolutePath;
  }

  async getObject(key: string): Promise<Buffer> {
    const absolutePath = resolve(this.rootPath, key);
    return readFile(absolutePath);
  }

  async deleteObject(key: string): Promise<void> {
    const absolutePath = resolve(this.rootPath, key);
    await rm(absolutePath, { force: true });
  }

  resolveKeyPath(key: string): string {
    return resolve(this.rootPath, key);
  }
}
