import { CteService } from '../cte.service';
import { CteXmlParserService } from '../cte-xml-parser.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/storage.service';

describe('CteService', () => {
  const prisma = {
    nfeDocumento: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn()
  };

  const parser = new CteXmlParserService();
  const service = new CteService(
    prisma as unknown as PrismaService,
    storage as unknown as LocalStorageService,
    parser
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.nfeDocumento.findMany.mockResolvedValue([]);
    prisma.nfeDocumento.findUnique.mockResolvedValue(null);
  });

  it('lista CT-es usando modelo 57 como filtro base', async () => {
    await service.findAll({ clienteId: 'cliente-1' });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([expect.objectContaining({ modelo: '57' })])
            }),
            { clienteId: 'cliente-1' }
          ])
        })
      })
    );
  });

  it('aplica filtros de numero, chave e ambiente na listagem de CT-e', async () => {
    await service.findAll({
      clienteId: 'cliente-1',
      numeroCte: '12345',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: 'producao'
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { clienteId: 'cliente-1' },
            { numeroNfe: { contains: '12345' } },
            { chaveAcesso: { contains: '42260795849600000135570010000319691243772228' } },
            { ambiente: 'producao' }
          ])
        })
      })
    );
  });

  it('retorna estatisticas agregadas do dashboard por cliente', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(7).mockResolvedValueOnce(4);
    prisma.nfeDocumento.groupBy
      .mockResolvedValueOnce([
        { clienteId: 'cliente-1', _count: { _all: 5 } },
        { clienteId: 'cliente-2', _count: { _all: 2 } }
      ])
      .mockResolvedValueOnce([
        { clienteId: 'cliente-1', _count: { _all: 3 } },
        { clienteId: 'cliente-2', _count: { _all: 1 } }
      ]);

    const result = await service.getDashboardStats({});

    expect(result).toEqual({
      totalCte: 7,
      xmlsCompletos: 4,
      byClient: [
        { clienteId: 'cliente-1', totalCte: 5, xmlsCompletos: 3 },
        { clienteId: 'cliente-2', totalCte: 2, xmlsCompletos: 1 }
      ]
    });
  });

  it('enriquece numero e valor a partir do XML quando os campos nao estao persistidos', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: null,
        serie: null,
        modelo: '57',
        valorTotal: null,
        schemaDoc: 'cteProc_v4.00',
        dataEmissao: null,
        dataAutorizacao: null,
        xmlCompletoPath: 'nfe/producao/123/2026/07/xml/a.xml',
        xmlResumoPath: null
      }
    ]);
    storage.getObject.mockResolvedValue(
      Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe42260795849600000135570010000319691243772228">
      <ide>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>31969</nCT>
        <dhEmi>2026-06-15T15:07:00-03:00</dhEmi>
      </ide>
      <vPrest>
        <vTPrest>1450.75</vTPrest>
      </vPrest>
    </infCte>
  </CTe>
</cteProc>`,
        'utf8'
      )
    );

    const [result] = await service.findAll({ clienteId: 'cliente-1' });

    expect(result.numeroNfe).toBe('31969');
    expect(result.valorTotal).toBe('1450.75');
    expect(result.serie).toBe('1');
  });

  it('retorna XML com metadados de download', async () => {
    prisma.nfeDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      modelo: '57',
      schemaDoc: 'cteProc_v4.00',
      xmlCompletoPath: 'nfe/producao/123/2026/07/xml/a.xml',
      xmlResumoPath: null
    });
    storage.getObject.mockResolvedValue(Buffer.from('<xml>cte</xml>', 'utf8'));

    const result = await service.getXml('doc-1', 'cliente-1');

    expect(result.fileName).toBe('CTE-42260795849600000135570010000319691243772228.xml');
    expect(result.contentType).toBe('application/xml');
    expect(result.contentBase64).toBe(Buffer.from('<xml>cte</xml>', 'utf8').toString('base64'));
  });

  it('nao expoe NF-e pelo endpoint de CT-e', async () => {
    prisma.nfeDocumento.findUnique.mockResolvedValue({
      id: 'doc-1',
      clienteId: 'cliente-1',
      chaveAcesso: '35260612345678000199550010000001231000001231',
      modelo: '55',
      schemaDoc: 'procNFe_v4.00'
    });

    await expect(service.findOne('doc-1', 'cliente-1')).rejects.toThrow('CT-e nao encontrado');
  });
});
