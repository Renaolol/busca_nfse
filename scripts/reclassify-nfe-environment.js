const { existsSync, readFileSync } = require('node:fs');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isUuid(value) {
  return UUID_REGEX.test(String(value || '').trim());
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

  if (clienteId && !isUuid(clienteId)) {
    throw new Error(`clienteId invalido: "${clienteId}". Informe um UUID real no formato 00000000-0000-0000-0000-000000000000.`);
  }

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
      missingFiles: 0,
      readErrors: 0,
      updated: 0
    },
    unchanged: [],
    reclassified: [],
    conflicts: [],
    missingXml: [],
    missingFiles: [],
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
        const candidateKeys = [document.xmlCompletoPath, document.xmlResumoPath].filter(Boolean);
        const storageKey = candidateKeys[0] ?? null;
        const item = {
          id: document.id,
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          ambienteAtual: document.ambiente,
          chaveAcesso: document.chaveAcesso,
          storageKey,
          candidateKeys
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
        let resolvedKey = null;
        let lastError = null;
        for (const key of candidateKeys) {
          try {
            xml = normalizeText((await readFile(resolve(storageRootPath, key))).toString('utf8'));
            resolvedKey = key;
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (!xml) {
          const errorMessage = lastError instanceof Error ? lastError.message : String(lastError || '');
          const isMissingFile =
            /ENOENT|no such file or directory/i.test(errorMessage) ||
            (lastError && typeof lastError === 'object' && lastError.code === 'ENOENT');

          if (isMissingFile) {
            report.summary.missingFiles += 1;
            report.missingFiles.push({
              ...item,
              motivo: errorMessage || 'Nenhum dos arquivos XML referenciados foi encontrado no storage local'
            });
          } else {
            report.summary.readErrors += 1;
            report.readErrors.push({
              ...item,
              motivo: errorMessage || 'Falha desconhecida ao ler XML do storage local'
            });
          }
          continue;
        }

        const tpAmb = extractTpAmb(xml);
        const ambienteEsperado = resolveExpectedAmbiente(xml);

        if (ambienteEsperado === document.ambiente) {
          report.summary.unchanged += 1;
          report.unchanged.push({
            ...item,
            storageKey: resolvedKey,
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
            storageKey: resolvedKey,
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
          storageKey: resolvedKey,
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
        `Arquivos ausentes: ${report.summary.missingFiles}.`,
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
