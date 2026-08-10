const { existsSync, readFileSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

/**
 * Preenche retroativamente NfseDocumento.chaveSubstituida para documentos importados ANTES dessa
 * coluna existir. A migracao so cria a coluna (fica NULL pra tudo que ja estava no banco); o valor
 * so passa a ser gravado quando o XML e (re)importado. Este script relê o XML ja armazenado (sem
 * chamar a API do ADN) e extrai o bloco <subst><chSubstda> do proprio arquivo, igual o parser faz
 * na importacao.
 *
 * Uso:
 *   node scripts/backfill-nfse-chave-substituida.js                       # dry-run, todos os clientes
 *   node scripts/backfill-nfse-chave-substituida.js --clienteId=<uuid>    # dry-run, um cliente
 *   node scripts/backfill-nfse-chave-substituida.js --apply               # aplica o backfill
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
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

function normalizeChaveAcesso(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits : null;
}

function extractNestedTag(xml, parentTag, childTag) {
  const parentRegex = new RegExp(`<(?:\\w+:)?${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${parentTag}>`, 'i');
  const parentMatch = parentRegex.exec(xml);
  if (!parentMatch?.[1]) {
    return null;
  }

  const childRegex = new RegExp(`<(?:\\w+:)?${childTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${childTag}>`, 'i');
  const childMatch = parentMatch[1].match(childRegex);
  const value = childMatch?.[1]?.trim();
  return value || null;
}

function extractChaveSubstituida(xml) {
  return normalizeChaveAcesso(extractNestedTag(xml, 'subst', 'chSubstda'));
}

async function main() {
  const { apply, clienteId, batchSize } = parseArgs();
  loadEnvFile();

  if (clienteId && !isUuid(clienteId)) {
    throw new Error(`clienteId invalido: "${clienteId}". Informe um UUID real no formato 00000000-0000-0000-0000-000000000000.`);
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const storageRootPath = process.env.STORAGE_ROOT_PATH ? resolve(process.env.STORAGE_ROOT_PATH) : resolve(process.cwd(), 'storage');

  const reportDir = resolve(process.cwd(), '.tmp', 'nfse-backfill-chave-substituida');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(reportDir, `report-${timestamp}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    clienteId: clienteId || null,
    storageRootPath,
    summary: {
      processed: 0,
      semXml: 0,
      arquivoAusente: 0,
      semSubstituicaoNoXml: 0,
      encontrados: 0,
      atualizados: 0
    },
    encontrados: []
  };

  let cursorId;

  try {
    while (true) {
      const documents = await prisma.nfseDocumento.findMany({
        take: batchSize,
        ...(cursorId
          ? {
              skip: 1,
              cursor: { id: cursorId }
            }
          : {}),
        where: {
          ...(clienteId ? { clienteId } : {}),
          chaveSubstituida: null
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          clienteId: true,
          ambiente: true,
          numeroNfse: true,
          chaveAcesso: true,
          xmlPath: true
        }
      });

      if (!documents.length) {
        break;
      }

      for (const document of documents) {
        report.summary.processed += 1;

        if (!document.xmlPath) {
          report.summary.semXml += 1;
          continue;
        }

        let xml;
        try {
          xml = await readFile(resolve(storageRootPath, document.xmlPath), 'utf8');
        } catch (error) {
          if ((error && error.code) === 'ENOENT') {
            report.summary.arquivoAusente += 1;
            continue;
          }
          throw error;
        }

        const chaveSubstituida = extractChaveSubstituida(xml);
        if (!chaveSubstituida) {
          report.summary.semSubstituicaoNoXml += 1;
          continue;
        }

        report.summary.encontrados += 1;
        report.encontrados.push({
          id: document.id,
          clienteId: document.clienteId,
          ambiente: document.ambiente,
          numeroNfse: document.numeroNfse,
          chaveAcesso: document.chaveAcesso,
          chaveSubstituida
        });

        if (apply) {
          await prisma.nfseDocumento.update({
            where: { id: document.id },
            data: { chaveSubstituida }
          });
          report.summary.atualizados += 1;
        }
      }

      cursorId = documents[documents.length - 1].id;
    }

    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      [
        'Backfill de chaveSubstituida concluido.',
        `Processados (sem chaveSubstituida ainda): ${report.summary.processed}.`,
        `Sem XML registrado: ${report.summary.semXml}.`,
        `Arquivo XML ausente no storage: ${report.summary.arquivoAusente}.`,
        `Sem bloco de substituicao no XML: ${report.summary.semSubstituicaoNoXml}.`,
        `Encontrados com substituicao: ${report.summary.encontrados}.`,
        apply ? `Atualizados no banco: ${report.summary.atualizados}.` : 'Nenhuma alteracao aplicada (dry-run).',
        `Relatorio: ${reportPath}.`
      ].join(' ')
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha ao fazer backfill de chaveSubstituida:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
