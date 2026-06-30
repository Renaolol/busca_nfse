const { existsSync, readFileSync } = require('node:fs');
const { rm } = require('node:fs/promises');
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

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('Uso: npm run nfe:reset -- --yes');
    console.error('Esse comando remove todos os controles e documentos de NF-e e apaga a pasta local storage/nfe.');
    process.exit(1);
  }

  loadEnvFile();

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const storageRootPath = process.env.STORAGE_ROOT_PATH
    ? resolve(process.env.STORAGE_ROOT_PATH)
    : resolve(process.cwd(), 'storage');
  const nfeStoragePath = resolve(storageRootPath, 'nfe');

  try {
    const deletedDocuments = await prisma.nfeDocumento.deleteMany();
    const deletedControls = await prisma.nfeSyncControle.deleteMany();
    await rm(nfeStoragePath, { recursive: true, force: true });

    console.log(
      [
        'Reset de NF-e concluido.',
        `Controles removidos: ${deletedControls.count}.`,
        `Documentos removidos: ${deletedDocuments.count}.`,
        `Pasta limpa: ${nfeStoragePath}.`
      ].join(' ')
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha ao resetar NF-e:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
