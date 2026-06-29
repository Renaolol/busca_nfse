import { NfeAmbiente, NfeSyncStatus, NfeTipoRelacao, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NfeDistribuicaoClient } from '../../../integrations/nfe-distribuicao/nfe-distribuicao.types';
import { LocalStorageService } from '../../storage/storage.service';
import { NfeService } from '../nfe.service';
import { NfeXmlParserService } from '../nfe-xml-parser.service';

describe('NfeService', () => {
  const prisma = {
    cliente: {
      findUnique: jest.fn()
    },
    clienteEstabelecimento: {
      findUnique: jest.fn(),
      findMany: jest.fn()
    },
    certificado: {
      findFirst: jest.fn()
    },
    nfeDocumento: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn()
    },
    nfeSyncControle: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn(),
    putObject: jest.fn()
  };

  const distribuicaoClient: NfeDistribuicaoClient = {
    distribuirPorNsu: jest.fn()
  };

  const service = new NfeService(
    prisma as unknown as PrismaService,
    new NfeXmlParserService(),
    storage as unknown as LocalStorageService,
    distribuicaoClient
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.cliente.findUnique.mockResolvedValue({ id: 'cliente-1' });
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'estab-1',
      clienteId: 'cliente-1',
      cnpj: '12345678000199'
    });
    prisma.clienteEstabelecimento.findMany.mockResolvedValue([
      {
        id: 'estab-1',
        clienteId: 'cliente-1',
        cnpj: '12345678000199',
        createdAt: new Date('2026-06-29T00:00:00.000Z')
      }
    ]);
    prisma.certificado.findFirst.mockResolvedValue({ id: 'cert-1' });
    prisma.nfeDocumento.findUnique.mockResolvedValue(null);
    prisma.nfeDocumento.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
      id: 'doc-1',
      ...args.create
    }));
    prisma.nfeSyncControle.findMany.mockResolvedValue([]);
    prisma.nfeSyncControle.upsert.mockResolvedValue({});
    prisma.nfeSyncControle.updateMany.mockResolvedValue({ count: 1 });
    prisma.nfeSyncControle.update.mockResolvedValue({});
    storage.putObject.mockResolvedValue(undefined);
  });

  it('retorna estatisticas agregadas do dashboard por cliente', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(12).mockResolvedValueOnce(9);
    prisma.nfeDocumento.groupBy
      .mockResolvedValueOnce([
        {
          clienteId: 'cliente-1',
          _count: { _all: 10 }
        },
        {
          clienteId: 'cliente-2',
          _count: { _all: 2 }
        }
      ])
      .mockResolvedValueOnce([
        {
          clienteId: 'cliente-1',
          _count: { _all: 8 }
        },
        {
          clienteId: 'cliente-2',
          _count: { _all: 1 }
        }
      ]);

    const result = await service.getDashboardStats({});

    expect(result).toEqual({
      totalNfe: 12,
      xmlsCompletos: 9,
      byClient: [
        {
          clienteId: 'cliente-1',
          totalNfe: 10,
          xmlsCompletos: 8
        },
        {
          clienteId: 'cliente-2',
          totalNfe: 2,
          xmlsCompletos: 1
        }
      ]
    });
  });

  it('retorna XML com metadados de download', async () => {
    prisma.nfeDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      xmlCompletoPath: 'nfe/producao/123/2026/06/xml/a.xml',
      xmlResumoPath: null
    });
    storage.getObject.mockResolvedValue(Buffer.from('<xml>conteudo</xml>', 'utf8'));

    const result = await service.getXml('doc-1', 'cliente-1');

    expect(result.fileName).toBe('NFE-35260612345678000199550010000001231000001231.xml');
    expect(result.contentType).toBe('application/xml');
    expect(result.contentBase64).toBe(Buffer.from('<xml>conteudo</xml>', 'utf8').toString('base64'));
  });

  it('inicia controles de sync reaproveitando certificados', async () => {
    const result = await service.iniciarSync({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao,
      nsuInicial: '25'
    });

    expect(prisma.nfeSyncControle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clienteId: 'cliente-1',
          estabelecimentoId: 'estab-1',
          ambiente: NfeAmbiente.producao,
          ultimoNsuConsultado: 24n
        })
      })
    );
    expect(result).toEqual({ controlesCriadosOuAtualizados: 1 });
  });

  it('roda distribuicao e persiste NF-e sincronizada', async () => {
    prisma.nfeSyncControle.findMany.mockResolvedValue([
      {
        id: 'ctrl-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        cnpjConsulta: '12345678000199',
        ambiente: NfeAmbiente.producao,
        ultimoNsuConsultado: 10n,
        ultimoNsuDistribuido: 10n,
        status: NfeSyncStatus.ativo
      }
    ]);
    (distribuicaoClient.distribuirPorNsu as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documentos localizados',
      ultNsu: 11n,
      maxNsu: 99n,
      documents: [
        {
          nsu: 11n,
          schema: 'procNFe_v4.00',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260612345678000199550010000001231000001231">
      <ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-06-29T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Emitente Teste</xNome></emit>
      <dest><CNPJ>99888777000166</CNPJ><xNome>Cliente Teste</xNome></dest>
      <total><ICMSTot><vNF>150.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><cStat>100</cStat><dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto></infProt></protNFe>
</nfeProc>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.runNow({
      clienteId: 'cliente-1',
      ambiente: NfeAmbiente.producao
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/xml/35260612345678000199550010000001231000001231.xml'),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '35260612345678000199550010000001231000001231',
          tipoRelacao: NfeTipoRelacao.emitida,
          valorTotal: new Prisma.Decimal('150.00')
        })
      })
    );
    expect(prisma.nfeSyncControle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          ultimoNsuConsultado: 11n,
          ultimoNsuDistribuido: 11n,
          maxNsu: 99n
        })
      })
    );
    expect(result).toEqual({
      processed: 1,
      documentsSaved: 1
    });
  });

  it('lista NF-e recebidas por cnpjConsulta', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([]);

    await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '12345678000199',
      tipoRelacao: 'recebidas'
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clienteId: 'cliente-1',
          cnpjDestinatario: '12345678000199'
        })
      })
    );
  });
});
