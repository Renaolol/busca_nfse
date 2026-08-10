const { existsSync, readFileSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Diagnostica e (opcionalmente) corrige NfseDocumento que aparecem como cancelados sem motivo
 * genuino. O front/back decidem "cancelado" (hasCancelamento) se QUALQUER uma destas for verdade:
 *   - status === 'cancelada'
 *   - dataCancelamento preenchido
 *   - existe NfseEvento vinculado (pela FK nfseDocumentoId) que parece cancelamento
 *
 * O bug de reconciliacao por NSU (corrigido em sync.service.ts) podia deixar UM DESSES sinais
 * "sobrando" numa linha que passou a representar uma chave de acesso diferente:
 *   - dataCancelamento antigo sobrevivia (Prisma trata undefined como "nao altere")
 *   - o NfseEvento continuava vinculado pela FK, mesmo com evento.chaveAcesso != documento.chaveAcesso
 *
 * Este script varre TODOS os documentos (nao so os com status/dataCancelamento marcados, porque o
 * terceiro sinal - evento orfao pela FK - pode marcar um documento como cancelado mesmo com
 * status/dataCancelamento limpos) e usa a chaveAcesso do PROPRIO evento (campo independente da FK)
 * como fonte da verdade para saber se o cancelamento e genuino.
 *
 * Uso:
 *   node scripts/fix-nfse-stale-cancelamento.js                       # dry-run, todos os clientes
 *   node scripts/fix-nfse-stale-cancelamento.js --clienteId=<uuid>    # dry-run, um cliente
 *   node scripts/fix-nfse-stale-cancelamento.js --apply               # aplica a correcao
 *
 * O script NUNCA altera o campo "status" automaticamente. Quando o documento tem status='cancelada'
 * sem NENHUMA evidencia (nem evento proprio, nem orfao), ele so aparece no relatorio para revisao
 * manual - pode ser um cancelamento real cujo evento ainda nao foi sincronizado.
 *
 * Correcao aplicada (--apply) para os casos de alta confianca:
 *   - dataCancelamento preenchido sem evidencia genuina -> zerado.
 *   - NfseEvento de cancelamento vinculado por FG com chaveAcesso diferente da do documento -> o
 *     evento e realocado para o documento real (mesma chaveAcesso, se existir) ou removido (se o
 *     documento real nao existir localmente).
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
      highConfidenceBug: 0,
      needsManualReviewStatusCancelada: 0,
      fixedDocuments: 0,
      orphanEventsRelinked: 0,
      orphanEventsDeleted: 0
    },
    highConfidenceBug: [],
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
          ...(clienteId ? { clienteId } : {})
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
          cnpjTomador: true,
          eventos: {
            select: {
              id: true,
              chaveAcesso: true,
              tipoEvento: true,
              descricao: true
            }
          }
        }
      });

      if (!documents.length) {
        break;
      }

      for (const document of documents) {
        report.summary.processed += 1;

        const eventosProprios = document.eventos.filter((evento) => evento.chaveAcesso === document.chaveAcesso);
        const eventosOrfaos = document.eventos.filter((evento) => evento.chaveAcesso !== document.chaveAcesso);

        const pareceCancelado =
          document.status === 'cancelada' || Boolean(document.dataCancelamento) || document.eventos.some(isEventoCancelamento);

        if (!pareceCancelado) {
          continue;
        }

        if (eventosProprios.some(isEventoCancelamento)) {
          report.summary.confirmedCancelled += 1;
          continue;
        }

        const orphanCancelEvents = eventosOrfaos.filter(isEventoCancelamento);

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
          cnpjTomador: document.cnpjTomador,
          eventosOrfaosDeCancelamento: orphanCancelEvents.map((evento) => ({
            id: evento.id,
            chaveAcesso: evento.chaveAcesso,
            tipoEvento: evento.tipoEvento
          }))
        };

        if (document.status === 'cancelada') {
          // Ambiguo: pode ser o bug OU um cancelamento real cujo evento ainda nao sincronizou.
          // Nunca corrigido automaticamente - so entra no relatorio para revisao manual.
          report.summary.needsManualReviewStatusCancelada += 1;
          report.needsManualReviewStatusCancelada.push(item);
          continue;
        }

        // status != 'cancelada', mas o documento aparenta estar cancelado por dataCancelamento
        // preenchido e/ou por um evento de cancelamento vinculado que na verdade pertence a outra
        // chave de acesso: assinatura de alta confianca do bug de reconciliacao por NSU.
        report.summary.highConfidenceBug += 1;
        report.highConfidenceBug.push(item);

        if (apply) {
          if (document.dataCancelamento) {
            await prisma.nfseDocumento.update({
              where: { id: document.id },
              data: { dataCancelamento: null }
            });
          }

          for (const evento of orphanCancelEvents) {
            const donoReal = await prisma.nfseDocumento.findFirst({
              where: { ambiente: document.ambiente, chaveAcesso: evento.chaveAcesso },
              select: { id: true }
            });

            if (donoReal && donoReal.id !== document.id) {
              await prisma.nfseEvento.update({
                where: { id: evento.id },
                data: { nfseDocumentoId: donoReal.id }
              });
              report.summary.orphanEventsRelinked += 1;
            } else {
              await prisma.nfseEvento.delete({ where: { id: evento.id } });
              report.summary.orphanEventsDeleted += 1;
            }
          }

          report.summary.fixedDocuments += 1;
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
        `Confirmados como realmente cancelados (evento proprio encontrado): ${report.summary.confirmedCancelled}.`,
        `Assinatura de alta confianca do bug (dataCancelamento e/ou evento orfao, status normal): ${report.summary.highConfidenceBug}.`,
        `Precisam de revisao manual (status='cancelada' sem evidencia - pode ser cancelamento real pendente de sync): ${report.summary.needsManualReviewStatusCancelada}.`,
        apply
          ? `Documentos corrigidos: ${report.summary.fixedDocuments}. Eventos orfaos realocados: ${report.summary.orphanEventsRelinked}. Eventos orfaos removidos: ${report.summary.orphanEventsDeleted}. Documentos com status='cancelada' NUNCA sao alterados automaticamente.`
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
