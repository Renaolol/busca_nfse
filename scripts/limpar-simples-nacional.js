const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const MIGRATION_BUSCA_NOME = '20260930190000_simples_nacional_busca_nome';

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

// Consultas em andamento nas tabelas do Simples (ex.: a migration criando o indice de busca, ou uma importacao).
async function listarAtividades(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT pid, state, date_trunc('second', now() - query_start)::text AS duracao,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 100) AS consulta
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND datname = current_database()
      AND query ILIKE '%simples_nacional%'
      AND state <> 'idle'`);
}

async function main() {
  loadEnvFile();

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const [{ estimativa }] = await prisma.$queryRawUnsafe(
      `SELECT coalesce(max(reltuples), -1)::bigint AS estimativa FROM pg_class WHERE relname = 'simples_nacional_empresas'`
    );
    const atividades = await listarAtividades(prisma);
    console.log(
      Number(estimativa) >= 0
        ? `Tabela do Simples Nacional: cerca de ${Number(estimativa).toLocaleString('pt-BR')} empresa(s).`
        : 'Tabela do Simples Nacional: tamanho ainda nao estimado pelo banco.'
    );
    atividades.forEach((atividade) =>
      console.log(`Em andamento (pid ${atividade.pid}, ${atividade.state}, ${atividade.duracao}): ${atividade.consulta}`)
    );

    if (!process.argv.includes('--yes')) {
      console.error('');
      console.error('Uso: npm run simples:limpar -- --yes');
      console.error('Remove TODAS as empresas e importacoes da tabela do Simples Nacional (nao e possivel desfazer).');
      console.error('Pare o servico antes (.\\NotaSyncGCONT.exe stop). Consultas em andamento nessas tabelas sao canceladas.');
      process.exit(1);
    }

    for (const atividade of atividades) {
      await prisma.$queryRawUnsafe('SELECT pg_cancel_backend($1::int)', Number(atividade.pid));
      console.log(`Consulta cancelada: pid ${atividade.pid}.`);
    }

    await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '60s'`),
      prisma.$executeRawUnsafe('TRUNCATE TABLE simples_nacional_empresas, simples_nacional_importacoes')
    ]);
    console.log('Tabela do Simples Nacional esvaziada.');

    const [falha] = await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations
       WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`,
      MIGRATION_BUSCA_NOME
    );
    if (falha) {
      console.log('');
      console.log('A migration do indice de busca ficou marcada como falha (foi interrompida). Libere-a e aplique de novo:');
      console.log(`  npx prisma migrate resolve --rolled-back ${MIGRATION_BUSCA_NOME}`);
      console.log('  npm run prisma:deploy');
    }
    console.log('Depois inicie o servico: .\\NotaSyncGCONT.exe start');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const mensagem = error instanceof Error ? error.message : String(error);
  if (/lock timeout|canceling statement due to lock/i.test(mensagem)) {
    console.error('A tabela continua em uso. Pare o servico (.\\NotaSyncGCONT.exe stop), aguarde alguns segundos e rode de novo.');
  } else {
    console.error('Falha ao limpar a tabela do Simples Nacional:', mensagem);
  }
  process.exit(1);
});
