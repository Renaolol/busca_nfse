import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DanfePdfGenerator } from './danfe.types';

type NfeWizardDanfeModule = {
  NFE_GerarDanfe(params: {
    data: DanfeJsonData;
    chave?: string;
    outputPath: string;
  }): Promise<{ success: boolean; message: string }>;
};

type DanfeDetItem = {
  imposto?: Record<string, unknown> & {
    ICMS?: Record<string, unknown> | null;
  };
} & Record<string, unknown>;

type DanfeNfeData = {
  infNFe?: {
    det?: DanfeDetItem | DanfeDetItem[];
  } & Record<string, unknown>;
} & Record<string, unknown>;

type DanfeJsonData = {
  NFe: DanfeNfeData | DanfeNfeData[];
  protNFe?: Record<string, unknown>;
};

type NfeWizardSharedModule = {
  XmlParser: new () => {
    convertXmlNfeProcToJson(xml: string): {
      data: DanfeJsonData;
      chave: string;
    };
  };
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
    const generatorParams = this.buildGeneratorParams(params, outputPath);

    try {
      await NFE_GerarDanfe(generatorParams);

      await this.waitForGeneratedPdf(outputPath);
      return await readFile(outputPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private loadDanfeModule(): NfeWizardDanfeModule {
    return this.loadModule('@nfewizard/danfe');
  }

  private loadSharedModule(): NfeWizardSharedModule {
    return this.loadModule('@nfewizard/shared');
  }

  private loadModule<T>(request: string): T {
    try {
      return localRequire(request) as T;
    } catch (error) {
      if (!this.isMissingLibxmlBindingError(error)) {
        throw error;
      }

      return this.loadModuleWithStubbedLibxml(request);
    }
  }

  private loadModuleWithStubbedLibxml<T>(request: string): T {
    const moduleLoader = localRequire('node:module') as NodeModuleLoader;
    const originalLoad = moduleLoader._load;

    moduleLoader._load = ((request: string, parent?: NodeJS.Module, isMain?: boolean) => {
      if (request === 'libxmljs2') {
        return {};
      }

      return originalLoad.call(moduleLoader, request, parent, isMain);
    }) as NodeModuleLoader['_load'];

    try {
      return localRequire(request) as T;
    } finally {
      moduleLoader._load = originalLoad;
    }
  }

  private buildGeneratorParams(params: {
    xml: string;
    chaveAcesso?: string;
  }, outputPath: string): {
    data: DanfeJsonData;
    chave?: string;
    outputPath: string;
  } {
    const { data, chave } = this.convertXmlToDanfeData(params.xml);

    return {
      data: this.normalizeDanfeData(data),
      chave: params.chaveAcesso ?? chave ?? undefined,
      outputPath
    };
  }

  private convertXmlToDanfeData(xml: string): { data: DanfeJsonData; chave: string } {
    const { XmlParser } = this.loadSharedModule();
    return new XmlParser().convertXmlNfeProcToJson(xml);
  }

  private normalizeDanfeData(data: DanfeJsonData): DanfeJsonData {
    const nfes = Array.isArray(data.NFe) ? data.NFe : [data.NFe];

    for (const nfe of nfes) {
      const det = nfe?.infNFe?.det;
      if (!det) {
        continue;
      }

      const items = Array.isArray(det) ? det : [det];
      if (nfe.infNFe) {
        nfe.infNFe.det = items;
      }

      for (const item of items) {
        if (!item || typeof item !== 'object') {
          continue;
        }

        const imposto =
          item.imposto && typeof item.imposto === 'object'
            ? item.imposto
            : {};
        item.imposto = imposto;

        if (!imposto.ICMS || typeof imposto.ICMS !== 'object') {
          imposto.ICMS = {};
        }
      }
    }

    return data;
  }

  private isMissingLibxmlBindingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return normalized.includes('could not locate the bindings file') && normalized.includes('libxmljs2');
  }

  private async waitForGeneratedPdf(outputPath: string): Promise<void> {
    const timeoutMs = 5000;
    const intervalMs = 100;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const fileStats = await stat(outputPath);
        if (fileStats.isFile() && fileStats.size > 0) {
          return;
        }
      } catch {
        // O pacote cria o write stream de forma assincrona; aguardar a proxima tentativa.
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`O DANFE nao foi gravado no arquivo temporario esperado: ${outputPath}`);
  }
}
