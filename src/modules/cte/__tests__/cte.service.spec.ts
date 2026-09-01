import { CteService } from '../cte.service';
import { CteXmlParserService } from '../cte-xml-parser.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/storage.service';
import { NfeService } from '../../nfe/nfe.service';
import { CteConsultaClient } from '../../../integrations/cte-consulta/cte-consulta.types';
import { NfeAmbiente, Prisma } from '@prisma/client';

describe('CteService', () => {
  const prisma = {
    cliente: {
      findUnique: jest.fn()
    },
    clienteEstabelecimento: {
      findUnique: jest.fn()
    },
    certificado: {
      findMany: jest.fn()
    },
    nfeDocumento: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn()
    }
  };

  const storage = {
    getObject: jest.fn(),
    putObject: jest.fn(),
    hasObject: jest.fn()
  };

  const nfeService = {
    sincronizarEventosDocumentos: jest.fn(),
    persistEventDocumentFromExternalSource: jest.fn()
  };

  const cteConsultaClient: CteConsultaClient = {
    consultarPorChave: jest.fn()
  };

  const parser = new CteXmlParserService();
  const service = new CteService(
    prisma as unknown as PrismaService,
    storage as unknown as LocalStorageService,
    parser,
    nfeService as unknown as NfeService,
    cteConsultaClient
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.cliente.findUnique.mockResolvedValue({ id: 'cliente-1' });
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({
      id: 'est-1',
      clienteId: 'cliente-1',
      ativo: true,
      cnpj: '12345678000199'
    });
    prisma.certificado.findMany.mockResolvedValue([
      {
        id: 'cert-1',
        nome: 'Certificado Principal',
        estabelecimentoId: 'est-1',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
      }
    ]);
    prisma.nfeDocumento.findMany.mockResolvedValue([]);
    prisma.nfeDocumento.findUnique.mockResolvedValue(null);
    prisma.nfeDocumento.upsert.mockResolvedValue({ id: 'doc-1' });
    nfeService.sincronizarEventosDocumentos.mockResolvedValue({
      documentosProcessados: 0,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0,
      detalhes: []
    });
    nfeService.persistEventDocumentFromExternalSource.mockResolvedValue({});
    storage.putObject.mockResolvedValue(undefined);
    storage.hasObject.mockResolvedValue(true);
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'CT-e localizado por chave',
      documents: [],
      rawResponse: { mock: true }
    });
  });

  it('lista CT-es usando modelo 57 como filtro base', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(12);
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

  it('pagina a listagem de CT-e armazenados', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(241);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll({
      clienteId: 'cliente-1',
      page: 2,
      pageSize: 100
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 100,
        take: 100
      })
    );
    expect(result).toEqual({
      items: [],
      total: 241,
      page: 2,
      pageSize: 100,
      totalPages: 3
    });
  });

  it('colapsa duplicatas legadas por ambiente e chave_acesso na listagem ampla', async () => {
    prisma.nfeDocumento.count.mockResolvedValueOnce(2);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-resumo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: '31969',
        serie: '1',
        modelo: '57',
        dataEmissao: new Date('2026-06-07T00:00:00.000Z'),
        dataAutorizacao: null,
        cnpjEmitente: '95849600000135',
        razaoSocialEmitente: 'TRANSPORTADORA LTDA',
        cnpjDestinatario: '12345678000199',
        razaoSocialDestinatario: 'DESTINATARIO LTDA',
        valorTotal: null,
        schemaDoc: 'resCTe_v1.00',
        resumoDisponivel: true,
        xmlCompletoDisponivel: false,
        xmlResumoPath: 'nfe/producao/95849600000135/2026/06/resumos/cte-a.xml',
        xmlCompletoPath: null,
        updatedAt: new Date('2026-07-31T16:23:00.000Z'),
        createdAt: new Date('2026-07-31T16:23:00.000Z'),
        eventos: []
      },
      {
        id: 'doc-completo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: '31969',
        serie: '1',
        modelo: '57',
        dataEmissao: new Date('2026-06-07T00:00:00.000Z'),
        dataAutorizacao: new Date('2026-06-07T01:00:00.000Z'),
        cnpjEmitente: '95849600000135',
        razaoSocialEmitente: 'TRANSPORTADORA LTDA',
        cnpjDestinatario: '12345678000199',
        razaoSocialDestinatario: 'DESTINATARIO LTDA',
        valorTotal: new Prisma.Decimal('11075.73'),
        schemaDoc: 'cteProc_v4.00',
        resumoDisponivel: true,
        xmlCompletoDisponivel: true,
        xmlResumoPath: 'nfe/producao/95849600000135/2026/06/resumos/cte-b.xml',
        xmlCompletoPath: 'nfe/producao/95849600000135/2026/06/xml/cte-b.xml',
        updatedAt: new Date('2026-08-03T09:31:00.000Z'),
        createdAt: new Date('2026-08-03T09:31:00.000Z'),
        eventos: []
      }
    ]);

    const response = await service.findAll({
      clienteId: 'cliente-1',
      all: true
    });

    expect(response.total).toBe(2);
    expect(response.items).toHaveLength(1);
    expect(response.items[0].id).toBe('doc-completo');
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

  it('na listagem ampla por cliente nao exige cnpj do documento quando tipoRelacao nao e informado', async () => {
    await service.findAll({
      clienteId: 'cliente-1',
      cnpjConsulta: '12345678000199'
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ clienteId: 'cliente-1' }])
        })
      })
    );

    const where = prisma.nfeDocumento.findMany.mock.calls.at(-1)?.[0]?.where;
    const hasCnpjRelationFilter = Array.isArray(where?.AND)
      ? where.AND.some(
          (condition: { OR?: Array<{ cnpjEmitente?: string; cnpjDestinatario?: string }> }) =>
            Array.isArray(condition?.OR) &&
            condition.OR.some(
              (item) => item?.cnpjEmitente === '12345678000199' || item?.cnpjDestinatario === '12345678000199'
            )
        )
      : false;

    expect(hasCnpjRelationFilter).toBe(false);
  });

  it('oculta resumos de rejeicao do CT-e na listagem base', async () => {
    await service.findAll({
      clienteId: 'cliente-1'
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              NOT: {
                AND: [
                  { schemaDoc: 'retConsSitCTe_v4.00' },
                  {
                    status: {
                      contains: 'Rejeicao',
                      mode: 'insensitive'
                    }
                  }
                ]
              }
            })
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

    const response = await service.findAll({ clienteId: 'cliente-1' });
    const [result] = response.items;

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

  it('consulta CT-e por chave e persiste resumo retornado pelo autorizador', async () => {
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'Autorizado o uso do CT-e',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <cStat>100</cStat>
  <xMotivo>Autorizado o uso do CT-e</xMotivo>
  <chCTe>42260795849600000135570010000319691243772228</chCTe>
  <protCTe>
    <infProt>
      <chCTe>42260795849600000135570010000319691243772228</chCTe>
      <dhRecbto>2026-07-15T10:00:01-03:00</dhRecbto>
    </infProt>
  </protCTe>
</retConsSitCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.consultarChave({
      clienteId: 'cliente-1',
      estabelecimentoId: 'est-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao
    });

    expect(cteConsultaClient.consultarPorChave).toHaveBeenCalledWith({
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/resumos/42260795849600000135570010000319691243772228.xml'),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          schemaDoc: 'retConsSitCTe_v4.00',
          dataAutorizacao: new Date('2026-07-15T13:00:01.000Z')
        })
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 200,
        cStat: '100',
        consultaValida: true,
        documentosEncontrados: 1,
        documentosPersistidos: 1,
        eventosEncontrados: 0,
        eventosPersistidos: 0
      })
    );
  });

  it('persiste XML principal de CT-e vindo de fonte externa no modulo dedicado', async () => {
    await service.persistDocumentFromExternalSource({
      clienteId: 'cliente-1',
      estabelecimentoId: 'est-1',
      ambiente: NfeAmbiente.producao,
      cnpjConsulta: '12345678000199',
      fallbackDataEmissao: '2026-07-15',
      document: {
        schema: 'cteProc_v4.00',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe42260795849600000135570010000319691243772228">
      <ide>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>31969</nCT>
        <dhEmi>2026-07-15T10:00:00-03:00</dhEmi>
      </ide>
      <emit><CNPJ>12345678000199</CNPJ><xNome>Empresa Emitente</xNome></emit>
      <dest><CNPJ>99887766000155</CNPJ><xNome>Empresa Destinataria</xNome></dest>
      <vPrest><vTPrest>1450.75</vTPrest></vPrest>
    </infCte>
  </CTe>
</cteProc>`
      },
      origem: 'importacao_xml'
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/xml/42260795849600000135570010000319691243772228.xml'),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '42260795849600000135570010000319691243772228',
          modelo: '57',
          schemaDoc: 'cteProc_v4.00',
          origem: 'importacao_xml'
        })
      })
    );
    expect(nfeService.persistEventDocumentFromExternalSource).not.toHaveBeenCalled();
  });

  it('roteia evento de CT-e vindo de fonte externa para o storage compartilhado de eventos', async () => {
    await service.persistDocumentFromExternalSource({
      clienteId: 'cliente-1',
      estabelecimentoId: 'est-1',
      ambiente: NfeAmbiente.producao,
      cnpjConsulta: '12345678000199',
      document: {
        schema: 'procEventoCTe_v4.00',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento Id="ID1101114226079584960000013557001000031969124377222801">
      <tpEvento>110111</tpEvento>
      <chCTe>42260795849600000135570010000319691243772228</chCTe>
      <dhEvento>2026-07-15T11:00:00-03:00</dhEvento>
    </infEvento>
  </eventoCTe>
</procEventoCTe>`
      },
      origem: 'importacao_xml'
    });

    expect(nfeService.persistEventDocumentFromExternalSource).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        ambiente: NfeAmbiente.producao,
        document: expect.objectContaining({
          schema: 'procEventoCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228'
        }),
        origem: 'importacao_xml'
      })
    );
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
  });

  it('usa a data de emissao da Dominio como fallback para resumo valido sem dhEmi', async () => {
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'Autorizado o uso do CT-e',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <cStat>100</cStat>
  <xMotivo>Autorizado o uso do CT-e</xMotivo>
  <chCTe>42260795849600000135570010000319691243772228</chCTe>
</retConsSitCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    await service.consultarChaveInternal({
      clienteId: 'cliente-1',
      estabelecimentoId: 'est-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao,
      fallbackDataEmissao: '2026-05-21'
    });

    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          dataEmissao: new Date('2026-05-21T00:00:00.000Z')
        })
      })
    );
  });

  it('rejeita consulta manual quando a chave informada nao pertence a CT-e', async () => {
    await expect(
      service.consultarChave({
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        ambiente: NfeAmbiente.producao
      })
    ).rejects.toThrow('A chave informada nao pertence a um CT-e valido para consulta por este endpoint (modelo 55).');

    expect(cteConsultaClient.consultarPorChave).not.toHaveBeenCalled();
  });

  it('nao persiste resumo de CT-e quando a consulta retorna rejeicao', async () => {
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '215',
      xMotivo: 'Rejeicao: XML Mal Formado',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <cStat>215</cStat>
  <xMotivo>Rejeicao: XML Mal Formado</xMotivo>
  <chCTe>42260795849600000135570010000319691243772228</chCTe>
</retConsSitCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.consultarChave({
      clienteId: 'cliente-1',
      estabelecimentoId: 'est-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao
    });

    expect(prisma.nfeDocumento.upsert).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        cStat: '215',
        consultaValida: false,
        documentosEncontrados: 1,
        documentosPersistidos: 0
      })
    );
  });

  it('usa a chave solicitada como fallback quando o retorno do CT-e nao traz chCTe', async () => {
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'Autorizado o uso do CT-e',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          chaveAcesso: '',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <cStat>100</cStat>
  <xMotivo>Autorizado o uso do CT-e</xMotivo>
</retConsSitCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.consultarChave({
      clienteId: 'cliente-1',
      estabelecimentoId: 'est-1',
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao
    });

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('/resumos/42260795849600000135570010000319691243772228.xml'),
      expect.any(String)
    );
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chaveAcesso: '42260795849600000135570010000319691243772228'
        })
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 200,
        documentosEncontrados: 1,
        documentosPersistidos: 1
      })
    );
  });

  it('sincroniza eventos de CT-e consultando o autorizador por chave', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: '31969',
        ambiente: NfeAmbiente.producao,
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '100',
      xMotivo: 'Consulta realizada',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: '<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte"><chCTe>42260795849600000135570010000319691243772228</chCTe></retConsSitCTe>'
        },
        {
          schema: 'procEventoCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento>
      <tpEvento>110111</tpEvento>
      <chCTe>42260795849600000135570010000319691243772228</chCTe>
      <dhEvento>2026-07-15T11:00:00-03:00</dhEvento>
    </infEvento>
  </eventoCTe>
</procEventoCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(cteConsultaClient.consultarPorChave).toHaveBeenCalledWith({
      chaveAcesso: '42260795849600000135570010000319691243772228',
      ambiente: NfeAmbiente.producao,
      certificateId: 'cert-1'
    });
    expect(nfeService.persistEventDocumentFromExternalSource).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        ambiente: NfeAmbiente.producao,
        document: expect.objectContaining({
          schema: 'procEventoCTe_v4.00'
        })
      })
    );
    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 1,
      eventosEncontrados: 1,
      eventosImportados: 1,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroDocumento: '31969',
          status: 'sincronizado',
          eventosEncontrados: 1,
          eventosImportados: 1,
          mensagem: 'Consulta realizada'
        }
      ]
    });
  });

  it('identifica e persiste o cancelamento pelo cStat 101 quando o autorizador nao envia procEventoCTe', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: '31969',
        ambiente: NfeAmbiente.producao,
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);
    (cteConsultaClient.consultarPorChave as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '101',
      xMotivo: 'Cancelamento de CT-e homologado',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          xml: `<?xml version="1.0" encoding="UTF-8"?>
<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <cStat>101</cStat>
  <xMotivo>Cancelamento de CT-e homologado</xMotivo>
  <chCTe>42260795849600000135570010000319691243772228</chCTe>
</retConsSitCTe>`
        }
      ],
      rawResponse: { mock: true }
    });

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(nfeService.persistEventDocumentFromExternalSource).not.toHaveBeenCalled();
    expect(prisma.nfeDocumento.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'Cancelamento de CT-e homologado' })
      })
    );
    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 0,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroDocumento: '31969',
          status: 'cancelado_sem_evento',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem:
            'Cancelamento homologado identificado pelo autorizador (cStat 101). O XML do evento nao foi retornado; a situacao do CT-e foi atualizada.'
        }
      ]
    });
  });

  it('nao consulta o WebService de CT-e para documento salvo com chave de outro modelo', async () => {
    prisma.nfeDocumento.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        chaveAcesso: '35260612345678000199550010000001231000001231',
        numeroNfe: '123',
        ambiente: NfeAmbiente.producao,
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(cteConsultaClient.consultarPorChave).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 1,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '35260612345678000199550010000001231000001231',
          numeroDocumento: '123',
          status: 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem:
            'Documento ignorado na sincronizacao de eventos de CT-e porque a chave salva pertence ao modelo 55, nao ao modelo 57.'
        }
      ]
    });
  });

  it('continua sincronizacao manual de eventos de CT-e quando o erro cita o model NfeEvento', async () => {
    prisma.nfeDocumento.findMany
      .mockRejectedValueOnce(new Error('The table `public.NfeEvento` does not exist in the current database.'))
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'est-1',
          ambiente: NfeAmbiente.producao,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroNfe: '31969'
        }
      ]);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: true,
      limit: 1
    });

    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      documentosProcessados: 1,
      falhas: 0
    });
  });

  it('infere clienteId a partir do documento quando a sincronizacao manual de CT-e nao recebe o cliente no body', async () => {
    prisma.nfeDocumento.findMany
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1'
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          clienteId: 'cliente-1',
          estabelecimentoId: 'est-1',
          ambiente: NfeAmbiente.producao,
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroNfe: '31969',
          origem: 'distribuicao_nsu',
          eventos: []
        }
      ]);

    const result = await service.sincronizarEventos({
      clienteId: '' as string,
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(prisma.cliente.findUnique).toHaveBeenCalledWith({
      where: { id: 'cliente-1' }
    });
    expect(result).toMatchObject({
      documentosProcessados: 1,
      falhas: 0
    });
  });

  it('retorna falha de certificado quando o arquivo criptografado nao existe no storage local do CT-e', async () => {
    storage.hasObject.mockResolvedValue(false);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([
      {
        id: 'doc-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'est-1',
        ambiente: NfeAmbiente.producao,
        chaveAcesso: '42260795849600000135570010000319691243772228',
        numeroNfe: '31969',
        origem: 'distribuicao_nsu',
        eventos: []
      }
    ]);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 1,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroDocumento: '31969',
          status: 'falha_certificado',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem:
            'Arquivo do certificado selecionado (Certificado Principal) nao encontrado no storage local para o CNPJ 12345678000199. Caminho esperado: certificados/cliente-1/cert-1.bin. Recadastre ou restaure esse certificado.'
        }
      ]
    });
  });

  it('retorna falha estruturada quando a preparacao da sincronizacao manual de CT-e quebra antes do loop', async () => {
    prisma.nfeDocumento.findMany
      .mockRejectedValueOnce(new Error('boom na consulta inicial do cte'))
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroNfe: '31969'
        }
      ]);

    const result = await service.sincronizarEventos({
      clienteId: 'cliente-1',
      documentoIds: ['doc-1'],
      somenteSemEventos: false,
      limit: 1
    });

    expect(result).toEqual({
      documentosProcessados: 1,
      documentosComEventos: 0,
      eventosEncontrados: 0,
      eventosImportados: 0,
      falhas: 1,
      detalhes: [
        {
          documentoId: 'doc-1',
          chaveAcesso: '42260795849600000135570010000319691243772228',
          numeroDocumento: '31969',
          status: 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: 'boom na consulta inicial do cte'
        }
      ]
    });
  });
});
