import { Injectable } from '@nestjs/common';
import { NFE_GerarDanfe } from '@nfewizard/danfe';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DanfePdfGenerator } from './danfe.types';

@Injectable()
export class RealDanfePdfGenerator implements DanfePdfGenerator {
  async generateNfePdf(params: { xml: string; chaveAcesso?: string }): Promise<Buffer> {
    const tempDir = await mkdtemp(join(tmpdir(), 'notasync-danfe-'));
    const outputPath = join(tempDir, `${params.chaveAcesso ?? randomUUID()}.pdf`);

    try {
      await NFE_GerarDanfe({
        data: params.xml,
        chave: params.chaveAcesso,
        outputPath
      });

      return await readFile(outputPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
