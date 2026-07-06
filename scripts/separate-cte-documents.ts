import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NfeXmlParserService } from '../src/modules/nfe/nfe-xml-parser.service';

type ReportItem = {
  id: string;
  clienteId: string;
  ambiente: string;
  chaveAcesso: string;
  schemaDocAtual: string | null;
  schemaDocDetectado?: string;
  detectionSource?: 'xml' | 'chave_acesso';
  storageKey: string | null;
  motivo?: string;
};

type ClassifiedStoredDocument = {
  documentType: 'nfe' | 'cte' | 'unknown';
  schemaDoc?: string;
  source?: 'xml' | 'chave_acesso';
};

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has('--apply'),
    batchSize: 200
  };
}

function normalizeText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim();
}

function tryDecodeBase64Text(value: string): string | null {
  const compact = value.replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    return null;
  }

  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    return normalizeText(decoded);
  } catch {
    return null;
  }
}

function classifyByChaveAcesso(chaveAcesso: string): ClassifiedStoredDocument {
  const digits = String(chaveAcesso || '').replace(/\D/g, '');
  if (digits.length !== 44) {
    return { documentType: 'unknown' };
  }

  const modelo = digits.slice(20, 22);
  if (modelo === '55') {
    return {
      documentType: 'nfe',
      schemaDoc: 'NFe_v4.00',
      source: 'chave_acesso'
    };
  }

  if (modelo === '57') {
    return {
      documentType: 'cte',
      schemaDoc: 'CTe_v4.00',
      source: 'chave_acesso'
    };
  }

  return { documentType: 'unknown' };
}

function classifyStoredXml(buffer: Buffer, chaveAcesso: string, parser: NfeXmlParserService): ClassifiedStoredDocument {
  const candidates = [
    normalizeText(buffer.toString('utf8')),
    normalizeText(buffer.toString('utf16le')),
    normalizeText(buffer.toString('latin1'))
  ].filter(Boolean);

  for (const candidate of candidates) {
    const classified = parser.classify(candidate);
    if (classified.documentType !== 'unknown') {
      return {
        documentType: classified.documentType,
        schemaDoc: classified.schemaDoc,
        source: 'xml'
      };
    }

    const decodedBase64 = tryDecodeBase64Text(candidate);
    if (!decodedBase64) {
      continue;
    }

    const classifiedDecoded = parser.classify(decodedBase64);
    if (classifiedDecoded.documentType !== 'unknown') {
      return {
        documentType: classifiedDecoded.documentType,
        schemaDoc: classifiedDecoded.schemaDoc,
        source: 'xml'
      };
    }
  }

  return classifyByChaveAcesso(chaveAcesso);
}

async function main() {
  const { apply, batchSize } = parseArgs();
  loadEnvFile();

  const prisma = new PrismaClient();
  const parser = new NfeXmlParserService();
  const storageRootPath = process.env.STORAGE_ROOT_PATH
    ? resolve(process.env.STORAGE_ROOT_PATH)
    : resolve(process.cwd(), 'storage');
  const reportDir = resolve(process.cwd(), '.tmp', 'nfe-cte-separation');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(reportDir, `report-${timestamp}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    summary: {
      processed: 0,
      nfe: 0,
      cte: 0,
      unknown: 0,
      missingXml: 0,
      updated: 0
    },
    nfe: [] as ReportItem[],
    cte: [] as ReportItem[],
    unknown: [] as ReportItem[],
    missingXml: [] as ReportItem[]
  };

  let cursorId: string | undefined;

  try {
    while (true) {
      const documents = await prisma.nfeDocumento.findMany({
        take: batchSize,
        ...(cursorId
          ? {
              skip: 1,
              cursor: { id: cursorId }
            }
          : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          clienteId: true,
          ambiente: true,
          chaveAcesso: true,
          schemaDoc: true,
          xmlCompletoPath: true,
          xmlResumoPath: true
        }
      });

      if (!documents.length) {
        break;
      }

      for (const document of documents) {
        report.summary.processed += 1;
        const storageKey = document.xmlCompletoPath ?? document.xmlResumoPath;
        const baseItem: ReportItem = {
          id: document.id,
          clienteId: document.clienteId,
          ambiente: document.ambiente,
          chaveAcesso: document.chaveAcesso,
          schemaDocAtual: document.schemaDoc,
          storageKey
        };

        if (!storageKey) {
          report.summary.missingXml += 1;
          report.missingXml.push({
            ...baseItem,
            motivo: 'Documento sem xmlCompletoPath e sem xmlResumoPath'
          });
          continue;
        }

        try {
          const xmlBuffer = await readFile(resolve(storageRootPath, storageKey));
          const classified = classifyStoredXml(xmlBuffer, document.chaveAcesso, parser);

          if (classified.documentType === 'cte') {
            report.summary.cte += 1;
            report.cte.push({
              ...baseItem,
              schemaDocDetectado: classified.schemaDoc,
              detectionSource: classified.source
            });

            if (apply && classified.schemaDoc && document.schemaDoc !== classified.schemaDoc) {
              await prisma.nfeDocumento.update({
                where: { id: document.id },
                data: { schemaDoc: classified.schemaDoc }
              });
              report.summary.updated += 1;
            }
            continue;
          }

          if (classified.documentType === 'nfe') {
            report.summary.nfe += 1;
            report.nfe.push({
              ...baseItem,
              schemaDocDetectado: classified.schemaDoc,
              detectionSource: classified.source
            });
            continue;
          }

          report.summary.unknown += 1;
          report.unknown.push({
            ...baseItem,
            motivo: 'Nao foi possivel classificar o XML como NF-e ou CT-e'
          });
        } catch (error) {
          report.summary.unknown += 1;
          report.unknown.push({
            ...baseItem,
            motivo: error instanceof Error ? error.message : String(error)
          });
        }
      }

      cursorId = documents[documents.length - 1].id;
    }

    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      [
        'Classificacao de documentos NF-e/CT-e concluida.',
        `Processados: ${report.summary.processed}.`,
        `NF-e: ${report.summary.nfe}.`,
        `CT-e: ${report.summary.cte}.`,
        `Nao classificados: ${report.summary.unknown}.`,
        `Sem XML: ${report.summary.missingXml}.`,
        apply ? `Registros atualizados: ${report.summary.updated}.` : 'Nenhuma alteracao aplicada (dry-run).',
        `Relatorio: ${reportPath}.`
      ].join(' ')
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha ao separar NF-e e CT-e salvos:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
