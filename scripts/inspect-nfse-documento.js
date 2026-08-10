const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * Inspeciona (SOMENTE LEITURA - nao altera nada) o registro completo de uma ou mais NFS-e pelo
 * numero + nome do cliente, incluindo todos os NfseEvento vinculados a cada documento e uma busca
 * cruzada por chaveAcesso/nsu para confirmar (ou descartar) colisao de identidade entre documentos.
 *
 * Uso:
 *   node scripts/inspect-nfse-documento.js --numero=231,232 --clienteNome="TERRAPLANAGEM"
 *   node scripts/inspect-nfse-documento.js --chaveAcesso=<chave>
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
  const numeroArg = args.find((arg) => arg.startsWith('--numero='));
  const clienteNomeArg = args.find((arg) => arg.startsWith('--clienteNome='));
  const chaveAcessoArg = args.find((arg) => arg.startsWith('--chaveAcesso='));

  return {
    numeros: numeroArg
      ? numeroArg
          .slice('--numero='.length)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    clienteNome: clienteNomeArg ? clienteNomeArg.slice('--clienteNome='.length).trim() || undefined : undefined,
    chaveAcesso: chaveAcessoArg ? chaveAcessoArg.slice('--chaveAcesso='.length).trim() || undefined : undefined
  };
}

function serialize(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') {
        return val.toString();
      }
      if (val && typeof val === 'object' && val.constructor && val.constructor.name === 'Decimal') {
        return val.toString();
      }
      return val;
    })
  );
}

async function main() {
  loadEnvFile();
  const { numeros, clienteNome, chaveAcesso } = parseArgs();

  if (!numeros.length && !chaveAcesso) {
    throw new Error('Informe --numero=<lista separada por virgula> (com --clienteNome=...) ou --chaveAcesso=<chave>.');
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    let documentos = [];

    if (chaveAcesso) {
      documentos = await prisma.nfseDocumento.findMany({
        where: { chaveAcesso },
        include: { eventos: true, cliente: { select: { razaoSocial: true, cnpj: true } } }
      });
    } else {
      const clientesWhere = clienteNome ? { razaoSocial: { contains: clienteNome, mode: 'insensitive' } } : {};
      const clientes = await prisma.cliente.findMany({ where: clientesWhere, select: { id: true, razaoSocial: true } });

      if (clienteNome && !clientes.length) {
        console.log(`Nenhum cliente encontrado com razaoSocial contendo "${clienteNome}".`);
        return;
      }

      documentos = await prisma.nfseDocumento.findMany({
        where: {
          numeroNfse: { in: numeros },
          ...(clienteNome ? { clienteId: { in: clientes.map((cliente) => cliente.id) } } : {})
        },
        include: { eventos: true, cliente: { select: { razaoSocial: true, cnpj: true } } },
        orderBy: [{ numeroNfse: 'asc' }]
      });
    }

    if (!documentos.length) {
      console.log('Nenhum documento encontrado com os filtros informados.');
      return;
    }

    for (const documento of documentos) {
      const eventosProprios = documento.eventos.filter((evento) => evento.chaveAcesso === documento.chaveAcesso);
      const eventosOrfaos = documento.eventos.filter((evento) => evento.chaveAcesso !== documento.chaveAcesso);

      // Eventos em QUALQUER lugar do banco com esta chave, independente de qual documento eles
      // estao vinculados hoje pela FK - fonte da verdade para saber se essa chave foi cancelada.
      const eventosPelaChaveEmQualquerLugar = await prisma.nfseEvento.findMany({
        where: { chaveAcesso: documento.chaveAcesso },
        select: { id: true, nfseDocumentoId: true, tipoEvento: true, descricao: true, dataEvento: true, createdAt: true }
      });

      // Outros documentos que compartilham o mesmo NSU (evidencia direta de colisao de NSU).
      const outrosComMesmoNsu =
        documento.nsu != null
          ? await prisma.nfseDocumento.findMany({
              where: {
                clienteId: documento.clienteId,
                ambiente: documento.ambiente,
                nsu: documento.nsu,
                id: { not: documento.id }
              },
              select: { id: true, numeroNfse: true, chaveAcesso: true, status: true, dataCancelamento: true, createdAt: true, updatedAt: true }
            })
          : [];

      console.log('='.repeat(100));
      console.log(
        serialize({
          documento: {
            id: documento.id,
            cliente: documento.cliente,
            ambiente: documento.ambiente,
            nsu: documento.nsu,
            chaveAcesso: documento.chaveAcesso,
            numeroNfse: documento.numeroNfse,
            serie: documento.serie,
            dataEmissao: documento.dataEmissao,
            status: documento.status,
            dataCancelamento: documento.dataCancelamento,
            valorServico: documento.valorServico,
            cnpjPrestador: documento.cnpjPrestador,
            razaoSocialPrestador: documento.razaoSocialPrestador,
            cnpjTomador: documento.cnpjTomador,
            razaoSocialTomador: documento.razaoSocialTomador,
            xmlPath: documento.xmlPath,
            danfsePath: documento.danfsePath,
            hashXml: documento.hashXml,
            origem: documento.origem,
            createdAt: documento.createdAt,
            updatedAt: documento.updatedAt
          },
          eventosVinculadosPelaFK_proprios: eventosProprios,
          eventosVinculadosPelaFK_ORFAOS_chaveDiferente: eventosOrfaos,
          eventosPelaChaveEmQualquerLugarDoBanco: eventosPelaChaveEmQualquerLugar,
          outrosDocumentosComMesmoNsu: outrosComMesmoNsu
        })
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha ao inspecionar documento NFS-e:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
