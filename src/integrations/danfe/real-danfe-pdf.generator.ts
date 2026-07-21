import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

type NodeModuleLoader = {
  _load(request: string, parent?: NodeJS.Module, isMain?: boolean): unknown;
};

const localRequire = createRequire(__filename);

@Injectable()
export class RealDanfePdfGenerator implements DanfePdfGenerator {
  async generateNfePdf(params: { xml: string; chaveAcesso?: string }): Promise<Buffer> {
    const tempDir = await mkdtemp(join(tmpdir(), 'notasync-danfe-'));
    const outputPath = join(tempDir, `${params.chaveAcesso ?? randomUUID()}.pdf`);
    const { NFE_GerarDanfe } = this.loadDanfeModule();

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

  private loadDanfeModule(): NfeWizardDanfeModule {
    try {
      return localRequire('@nfewizard/danfe') as NfeWizardDanfeModule;
    } catch (error) {
      if (!this.isMissingLibxmlBindingError(error)) {
        throw error;
      }

      return this.loadDanfeModuleWithStubbedLibxml();
    }
  }

  private loadDanfeModuleWithStubbedLibxml(): NfeWizardDanfeModule {
    const moduleLoader = localRequire('node:module') as NodeModuleLoader;
    const originalLoad = moduleLoader._load;

    moduleLoader._load = ((request: string, parent?: NodeJS.Module, isMain?: boolean) => {
      if (request === 'libxmljs2') {
        return {};
      }

      return originalLoad.call(moduleLoader, request, parent, isMain);
    }) as NodeModuleLoader['_load'];

    try {
      return localRequire('@nfewizard/danfe') as NfeWizardDanfeModule;
    } finally {
      moduleLoader._load = originalLoad;
    }
  }

  private isMissingLibxmlBindingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return normalized.includes('could not locate the bindings file') && normalized.includes('libxmljs2');
  }
}
