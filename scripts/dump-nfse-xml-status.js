const { readFile } = require('node:fs/promises');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * Le o XML armazenado localmente de uma NFS-e (SOMENTE LEITURA) e mostra TODAS as ocorrencias das
 * tags status/Situacao/cStat no documento - nao apenas a primeira, que e o que
 * NfseXmlParserService.extract() usa hoje (regex sem escopo, pega a primeira ocorrencia em
 * qualquer lugar do XML). Serve para confirmar se um bloco aninhado (ex: referencia a nota
 * substituida) esta "vazando" um status de cancelamento para o documento errado.
 *
 * Uso:
 *   node scripts/dump-nfse-xml-status.js --path="nfse/producao/.../xml/<chave>.xml"
 */

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
  const pathArg = args.find((arg) => arg.startsWith('--path='));
  return {
    storageKey: pathArg ? pathArg.slice('--path='.length).trim() : undefined
  };
}

function findAllOccurrences(xml, tag) {
  const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'gi');
  const occurrences = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(xml.length, match.index + match[0].length + 40);
    occurrences.push({
      valor: match[1].trim(),
      posicao: match.index,
      contexto: xml.slice(start, end).replace(/\s+/g, ' ').trim()
    });
  }
  return occurrences;
}

async function main() {
  loadEnvFile();
  const { storageKey } = parseArgs();

  if (!storageKey) {
    throw new Error('Informe --path="<caminho relativo ao storage, ex: nfse/producao/.../xml/<chave>.xml>"');
  }

  const storageRootPath = process.env.STORAGE_ROOT_PATH ? resolve(process.env.STORAGE_ROOT_PATH) : resolve(process.cwd(), 'storage');
  const absolutePath = resolve(storageRootPath, storageKey);

  console.log(`Lendo: ${absolutePath}`);
  const xml = await readFile(absolutePath, 'utf8');

  console.log(`Tamanho do arquivo: ${xml.length} caracteres.`);
  console.log('='.repeat(100));

  for (const tag of ['status', 'Situacao', 'cStat']) {
    const occurrences = findAllOccurrences(xml, tag);
    console.log(`Tag <${tag}>: ${occurrences.length} ocorrencia(s) encontrada(s).`);
    occurrences.forEach((occurrence, index) => {
      console.log(`  [${index}] valor="${occurrence.valor}" posicao=${occurrence.posicao}`);
      console.log(`      contexto: ...${occurrence.contexto}...`);
    });
  }

  console.log('='.repeat(100));
  console.log('Primeira ocorrencia que o parser atual (extract) escolheria como status do documento:');
  for (const tag of ['status', 'Situacao', 'cStat']) {
    const occurrences = findAllOccurrences(xml, tag);
    if (occurrences.length) {
      console.log(`  -> tag <${tag}>, valor="${occurrences[0].valor}" (posicao ${occurrences[0].posicao})`);
      break;
    }
  }

  console.log('='.repeat(100));
  console.log('XML completo (para inspecao manual):');
  console.log(xml);
}

main().catch((error) => {
  console.error('Falha ao ler XML da NFS-e:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
