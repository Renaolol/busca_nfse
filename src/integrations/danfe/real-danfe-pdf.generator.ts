import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DanfePdfGenerator } from './danfe.types';

type NfeWizardDanfeModule = {
  NFE_GerarDanfe(params: {
    data: string;
    chave?: string;
    outputPath: string;
  }): Promise<{ success: boolean; message: string }>;
};

@Injectable()
export class RealDanfePdfGenerator implements DanfePdfGenerator {
  async generateNfePdf(params: { xml: string; chaveAcesso?: string }): Promise<Buffer> {
    const tempDir = await mkdtemp(join(tmpdir(), 'notasync-danfe-'));
    const outputPath = join(tempDir, `${params.chaveAcesso ?? randomUUID()}.pdf`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NFE_GerarDanfe } = require('@nfewizard/danfe') as NfeWizardDanfeModule;

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
