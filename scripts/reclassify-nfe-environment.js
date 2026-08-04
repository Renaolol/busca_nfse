const { existsSync, readFileSync } = require('node:fs');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

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
  const args = process.argv.slice(2);
  const clienteIdArg = args.find((arg) => arg.startsWith('--clienteId='));
  return {
    apply: args.includes('--apply'),
    clienteId: clienteIdArg ? clienteIdArg.slice('--clienteId='.length).trim() || undefined : undefined,
    batchSize: 200
  };
}

function normalizeText(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim();
}

function extractTpAmb(xml) {
  const match = /<(?:\w+:)?tpAmb\b[^>]*>\s*([12])\s*<\/(?:\w+:)?tpAmb>/i.exec(xml);
  return match?.[1];
}

function resolveExpectedAmbiente(xml) {
  return extractTpAmb(xml) === '2' ? 'homologacao' : 'producao';
}

async function main() {
  const { apply, clienteId, batchSize } = parseArgs();
  loadEnvFile();

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const storageRootPath = process.env.STORAGE_ROOT_PATH
    ? resolve(process.env.STORAGE_ROOT_PATH)
    : resolve(process.cwd(), 'storage');
  const reportDir = resolve(process.cwd(), '.tmp', 'nfe-environment-reclassification');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(reportDir, `report-${timestamp}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    clienteId: clienteId || null,
    summary: {
      processed: 0,
      unchanged: 0,
      reclassified: 0,
      conflicts: 0,
      missingXml: 0,
      readErrors: 0,
      updated: 0
    },
    unchanged: [],
    reclassified: [],
    conflicts: [],
    missingXml: [],
    readErrors: []
  };

  let cursorId;

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
        where: {
          ...(clienteId ? { clienteId } : {})
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          clienteId: true,
          estabelecimentoId: true,
          ambiente: true,
          chaveAcesso: true,
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
        const item = {
          id: document.id,
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          ambienteAtual: document.ambiente,
          chaveAcesso: document.chaveAcesso,
          storageKey
        };

        if (!storageKey) {
          report.summary.missingXml += 1;
          report.missingXml.push({
            ...item,
            motivo: 'Documento sem xmlCompletoPath e sem xmlResumoPath'
          });
          continue;
        }

        let xml;
        try {
          xml = normalizeText((await readFile(resolve(storageRootPath, storageKey))).toString('utf8'));
        } catch (error) {
          report.summary.readErrors += 1;
          report.readErrors.push({
            ...item,
            motivo: error instanceof Error ? error.message : String(error)
          });
          continue;
        }

        const tpAmb = extractTpAmb(xml);
        const ambienteEsperado = resolveExpectedAmbiente(xml);

        if (ambienteEsperado === document.ambiente) {
          report.summary.unchanged += 1;
          report.unchanged.push({
            ...item,
            tpAmb: tpAmb || null,
            ambienteEsperado
          });
          continue;
        }

        const conflicting = await prisma.nfeDocumento.findUnique({
          where: {
            ambiente_chaveAcesso: {
              ambiente: ambienteEsperado,
              chaveAcesso: document.chaveAcesso
            }
          },
          select: {
            id: true,
            ambiente: true
          }
        });

        if (conflicting && conflicting.id !== document.id) {
          report.summary.conflicts += 1;
          report.conflicts.push({
            ...item,
            tpAmb: tpAmb || null,
            ambienteEsperado,
            conflictingDocumentId: conflicting.id,
            conflictingAmbiente: conflicting.ambiente
          });
          continue;
        }

        report.summary.reclassified += 1;
        report.reclassified.push({
          ...item,
          tpAmb: tpAmb || null,
          ambienteEsperado
        });

        if (apply) {
          await prisma.nfeDocumento.update({
            where: { id: document.id },
            data: { ambiente: ambienteEsperado }
          });
          report.summary.updated += 1;
        }
      }

      cursorId = documents[documents.length - 1].id;
    }

    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      [
        'Reclassificacao de ambiente das NF-e concluida.',
        `Processados: ${report.summary.processed}.`,
        `Sem mudanca: ${report.summary.unchanged}.`,
        `Elegiveis para reclassificacao: ${report.summary.reclassified}.`,
        `Conflitos: ${report.summary.conflicts}.`,
        `Sem XML: ${report.summary.missingXml}.`,
        `Falhas de leitura: ${report.summary.readErrors}.`,
        apply ? `Atualizados: ${report.summary.updated}.` : 'Nenhuma alteracao aplicada (dry-run).',
        `Relatorio: ${reportPath}.`
      ].join(' ')
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha ao reclassificar ambiente das NF-e:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
