const { existsSync, readFileSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Diagnostica e (opcionalmente) corrige NfseDocumento com "dataCancelamento" preenchido sem
 * nenhum NfseEvento de cancelamento correspondente para a MESMA chave de acesso.
 *
 * Esse estado surge quando a reconciliacao por NSU (sync.service.ts) reaproveitava a linha de um
 * documento antigo para representar uma chave nova: o campo dataCancelamento antigo sobrevivia
 * porque o Prisma trata "undefined" como "nao altere este campo". O bug de origem ja foi corrigido
 * no codigo (sync.service.ts agora zera dataCancelamento e remove eventos orfaos ao reconciliar por
 * NSU) - este script serve para higienizar documentos que ja foram corrompidos ANTES da correcao.
 *
 * Uso:
 *   node scripts/fix-nfse-stale-cancelamento.js                       # dry-run, todos os clientes
 *   node scripts/fix-nfse-stale-cancelamento.js --clienteId=<uuid>    # dry-run, um cliente
 *   node scripts/fix-nfse-stale-cancelamento.js --apply               # aplica a correcao
 *
 * O script NUNCA altera o campo "status" automaticamente. Quando o documento tem status='cancelada'
 * SEM evento correspondente, ele so aparece no relatorio para revisao manual (pode ser um
 * cancelamento real que ainda nao teve o evento sincronizado - nao e necessariamente o bug).
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

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isEventoCancelamento(evento) {
  const tipoEvento = normalizeSearchText(evento.tipoEvento);
  const descricao = normalizeSearchText(evento.descricao);

  return (
    tipoEvento === 'e101101' ||
    tipoEvento.includes('cancelamento') ||
    tipoEvento.includes('cancelada') ||
    descricao.includes('cancelamento') ||
    descricao.includes('cancelada')
  );
}

async function main() {
  const { apply, clienteId, batchSize } = parseArgs();
  loadEnvFile();

  if (clienteId && !isUuid(clienteId)) {
    throw new Error(`clienteId invalido: "${clienteId}". Informe um UUID real no formato 00000000-0000-0000-0000-000000000000.`);
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const reportDir = resolve(process.cwd(), '.tmp', 'nfse-stale-cancelamento');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(reportDir, `report-${timestamp}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    clienteId: clienteId || null,
    summary: {
      processed: 0,
      confirmedCancelled: 0,
      fixedDataCancelamentoOnly: 0,
      needsManualReviewStatusCancelada: 0,
      fixed: 0
    },
    fixedDataCancelamentoOnly: [],
    needsManualReviewStatusCancelada: []
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
          OR: [{ dataCancelamento: { not: null } }, { status: 'cancelada' }]
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          clienteId: true,
          ambiente: true,
          numeroNfse: true,
          chaveAcesso: true,
          dataEmissao: true,
          status: true,
          dataCancelamento: true,
          valorServico: true,
          cnpjPrestador: true,
          cnpjTomador: true
        }
      });

      if (!documents.length) {
        break;
      }

      for (const document of documents) {
        report.summary.processed += 1;

        const eventos = await prisma.nfseEvento.findMany({
          where: { chaveAcesso: document.chaveAcesso },
          select: { tipoEvento: true, descricao: true }
        });

        if (eventos.some(isEventoCancelamento)) {
          report.summary.confirmedCancelled += 1;
          continue;
        }

        const item = {
          id: document.id,
          clienteId: document.clienteId,
          ambiente: document.ambiente,
          numeroNfse: document.numeroNfse,
          chaveAcesso: document.chaveAcesso,
          dataEmissao: document.dataEmissao,
          statusAtual: document.status,
          dataCancelamentoAtual: document.dataCancelamento,
          valorServico: document.valorServico ? document.valorServico.toString() : null,
          cnpjPrestador: document.cnpjPrestador,
          cnpjTomador: document.cnpjTomador
        };

        if (document.status === 'cancelada') {
          // Ambiguo: pode ser o bug OU um cancelamento real cujo evento ainda nao sincronizou.
          // Nunca corrigido automaticamente - so entra no relatorio para revisao manual.
          report.summary.needsManualReviewStatusCancelada += 1;
          report.needsManualReviewStatusCancelada.push(item);
          continue;
        }

        // status != 'cancelada' mas dataCancelamento preenchido: assinatura de alta confianca do
        // bug de reconciliacao por NSU (o campo sobrou de uma linha reaproveitada).
        report.summary.fixedDataCancelamentoOnly += 1;
        report.fixedDataCancelamentoOnly.push(item);

        if (apply) {
          await prisma.nfseDocumento.update({
            where: { id: document.id },
            data: { dataCancelamento: null }
          });
          report.summary.fixed += 1;
        }
      }

      cursorId = documents[documents.length - 1].id;
    }

    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      [
        'Diagnostico de cancelamento indevido em NFS-e concluido.',
        `Processados: ${report.summary.processed}.`,
        `Confirmados como realmente cancelados (evento correspondente encontrado): ${report.summary.confirmedCancelled}.`,
        `Assinatura de alta confianca do bug (dataCancelamento sem evento, status normal): ${report.summary.fixedDataCancelamentoOnly}.`,
        `Precisam de revisao manual (status='cancelada' sem evento - pode ser cancelamento real pendente de sync): ${report.summary.needsManualReviewStatusCancelada}.`,
        apply
          ? `Corrigidos automaticamente (dataCancelamento limpo): ${report.summary.fixed}. Documentos com status='cancelada' NUNCA sao alterados automaticamente.`
          : 'Nenhuma alteracao aplicada (dry-run). Revise o relatorio antes de rodar novamente com --apply.',
        `Relatorio completo: ${reportPath}.`
      ].join(' ')
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha ao diagnosticar cancelamento indevido em NFS-e:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
