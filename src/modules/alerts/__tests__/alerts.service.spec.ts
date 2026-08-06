import { NotFoundException } from '@nestjs/common';
import { AlertsService } from '../alerts.service';

describe('AlertsService', () => {
  const prisma = {
    nfeEvento: {
      findMany: jest.fn(),
      findUnique: jest.fn()
    },
    nfseDocumento: {
      findMany: jest.fn()
    },
    alertResolution: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn()
    },
    cteDesacordoResolucao: {
      upsert: jest.fn(),
      deleteMany: jest.fn()
    }
  } as any;
  const storage = {
    getObject: jest.fn()
  } as any;
  const nfseDanfse = {
    extractRetentionAlertData: jest.fn()
  } as any;

  let service: AlertsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.nfeEvento.findMany.mockResolvedValue([]);
    prisma.nfseDocumento.findMany.mockResolvedValue([]);
    prisma.alertResolution.findMany.mockResolvedValue([]);
    service = new AlertsService(prisma, storage, nfseDanfse);
  });

  it('lista alertas de desacordo de CT-e com status resolvido quando houver resolucao', async () => {
    prisma.nfeEvento.findMany.mockResolvedValue([
      {
        id: 'evento-1',
        nfeDocumentoId: 'doc-1',
        chaveAcesso: '42260702914460000401570100190348801457035659',
        tipoEvento: '610110',
        descricao: 'Prestacao de Servico em Desacordo',
        dataEvento: new Date('2026-07-21T06:05:00.000Z'),
        createdAt: new Date('2026-07-21T06:05:00.000Z'),
        cteDesacordoResolucao: {
          id: 'res-1',
          resolvidoEm: new Date('2026-07-21T08:00:00.000Z')
        },
        nfeDocumento: {
          id: 'doc-1',
          clienteId: 'cliente-1',
          numeroNfe: '2849',
          modelo: '57',
          cliente: {
            razaoSocial: 'BAIERLE & BAIERLE LTDA'
          }
        }
      }
    ]);

    const result = await service.findAll({});

    expect(result).toEqual([
      expect.objectContaining({
        id: 'cte-desacordo-evento-1',
        clientId: 'cliente-1',
        cliente: 'BAIERLE & BAIERLE LTDA',
        numeroDocumento: '2849',
        status: 'Resolvido',
        persistence: 'server',
        canToggleResolved: true
      })
    ]);
  });

  it('lista alerta de NFS-e tomada com retencao e aplica resolucao generica quando o fingerprint coincide', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'nfse-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        chaveAcesso: '42110092206960810000176000000000042526078195939549',
        numeroNfse: '425',
        dataEmissao: new Date('2026-07-24T13:35:20.000Z'),
        dataCancelamento: null,
        cnpjTomador: '32973310000189',
        razaoSocialPrestador: 'MULTISAT NOX GERENCIAMENTO E MONITORAMENTO DE RISCO LTDA',
        xmlPath: 'nfse/producao/32973310000189/2026/07/xml/425.xml',
        createdAt: new Date('2026-07-24T13:35:20.000Z'),
        updatedAt: new Date('2026-07-24T13:35:20.000Z'),
        cliente: {
          razaoSocial: 'H.M. Rother Transportes Ltda'
        },
        estabelecimento: {
          cnpj: '32973310000189'
        }
      }
    ]);
    storage.getObject.mockResolvedValue(Buffer.from('<xml />'));
    nfseDanfse.extractRetentionAlertData.mockReturnValue({
      hasRetention: true,
      entries: [
        { code: 'iss', label: 'ISS retido' },
        { code: 'irrf', label: 'IRRF', amount: 'R$ 5,25' }
      ]
    });
    prisma.alertResolution.findMany.mockResolvedValue([
      {
        id: 'res-1',
        alertId: 'nfse-retencao-nfse-1',
        fingerprint: JSON.stringify([
          'nfse-retencao-nfse-1',
          'nfse-retencao-entrada',
          '2026-07-24T13:35:20.000Z',
          'NFS-e de entrada com retencao',
          'A NFS-e 425 de entrada possui retencoes: ISS retido, IRRF: R$ 5,25.',
          'Prestador MULTISAT NOX GERENCIAMENTO E MONITORAMENTO DE RISCO LTDA; chave 42110092206960810000176000000000042526078195939549.'
        ]),
        clienteId: 'cliente-1',
        origem: 'nfse-retencao-entrada',
        titulo: 'NFS-e de entrada com retencao',
        resolvedAt: new Date('2026-07-25T12:00:00.000Z'),
        createdAt: new Date('2026-07-25T12:00:00.000Z'),
        updatedAt: new Date('2026-07-25T12:00:00.000Z')
      }
    ]);

    const result = await service.findAll({});

    expect(storage.getObject).toHaveBeenCalledWith('nfse/producao/32973310000189/2026/07/xml/425.xml');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'nfse-retencao-nfse-1',
        tipo: 'NFS-e',
        numeroDocumento: '425',
        emissor: 'MULTISAT NOX GERENCIAMENTO E MONITORAMENTO DE RISCO LTDA',
        retencoes: ['ISS retido', 'IRRF: R$ 5,25'],
        status: 'Resolvido',
        persistence: 'client',
        canToggleResolved: true
      })
    ]);
  });

  it('ignora NFS-e emitida mesmo quando ha retencao no XML', async () => {
    prisma.nfseDocumento.findMany.mockResolvedValue([
      {
        id: 'nfse-emitida-1',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        chaveAcesso: '42110092206960810000176000000000000126019687178145',
        numeroNfse: '1',
        dataEmissao: new Date('2026-07-24T13:35:20.000Z'),
        dataCancelamento: null,
        cnpjTomador: '11111111000111',
        razaoSocialPrestador: 'Prestador Teste',
        xmlPath: 'nfse/producao/06960810000176/2026/07/xml/1.xml',
        createdAt: new Date('2026-07-24T13:35:20.000Z'),
        updatedAt: new Date('2026-07-24T13:35:20.000Z'),
        cliente: {
          razaoSocial: 'Cliente Teste'
        },
        estabelecimento: {
          cnpj: '06960810000176'
        }
      }
    ]);

    const result = await service.findAll({});

    expect(storage.getObject).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('marca um alerta como resolvido por evento', async () => {
    prisma.nfeEvento.findUnique
      .mockResolvedValueOnce({
        id: 'evento-1',
        nfeDocumentoId: 'doc-1',
        chaveAcesso: '42260702914460000401570100190348801457035659',
        tipoEvento: '610110',
        descricao: 'Prestacao de Servico em Desacordo',
        dataEvento: new Date('2026-07-21T06:05:00.000Z'),
        createdAt: new Date('2026-07-21T06:05:00.000Z'),
        cteDesacordoResolucao: null,
        nfeDocumento: {
          id: 'doc-1',
          clienteId: 'cliente-1',
          numeroNfe: '2849',
          modelo: '57',
          cliente: {
            razaoSocial: 'BAIERLE & BAIERLE LTDA'
          }
        }
      })
      .mockResolvedValueOnce({
        id: 'evento-1',
        nfeDocumentoId: 'doc-1',
        chaveAcesso: '42260702914460000401570100190348801457035659',
        tipoEvento: '610110',
        descricao: 'Prestacao de Servico em Desacordo',
        dataEvento: new Date('2026-07-21T06:05:00.000Z'),
        createdAt: new Date('2026-07-21T06:05:00.000Z'),
        cteDesacordoResolucao: {
          id: 'res-1',
          resolvidoEm: new Date('2026-07-21T08:00:00.000Z')
        },
        nfeDocumento: {
          id: 'doc-1',
          clienteId: 'cliente-1',
          numeroNfe: '2849',
          modelo: '57',
          cliente: {
            razaoSocial: 'BAIERLE & BAIERLE LTDA'
          }
        }
      });

    const result = await service.updateCteDesacordoResolution('evento-1', true);

    expect(prisma.cteDesacordoResolucao.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nfeEventoId: 'evento-1' }
      })
    );
    expect(result.status).toBe('Resolvido');
  });

  it('rejeita resolucao para evento que nao e desacordo de CT-e', async () => {
    prisma.nfeEvento.findUnique.mockResolvedValue({
      id: 'evento-1',
      nfeDocumentoId: 'doc-1',
      chaveAcesso: '42260702914460000401570100190348801457035659',
      tipoEvento: '110111',
      descricao: 'Cancelamento',
      dataEvento: new Date('2026-07-21T06:05:00.000Z'),
      createdAt: new Date('2026-07-21T06:05:00.000Z'),
      cteDesacordoResolucao: null,
      nfeDocumento: {
        id: 'doc-1',
        clienteId: 'cliente-1',
        numeroNfe: '2849',
        modelo: '57',
        cliente: {
          razaoSocial: 'BAIERLE & BAIERLE LTDA'
        }
      }
    });

    await expect(service.updateCteDesacordoResolution('evento-1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista resolucoes genericas persistidas', async () => {
    prisma.alertResolution.findMany.mockResolvedValue([
      {
        id: 'res-1',
        alertId: 'audit-1',
        fingerprint: 'fp-1',
        clienteId: 'cliente-1',
        origem: 'auditoria',
        titulo: 'CT-e criado no sistema',
        resolvedAt: new Date('2026-07-22T08:00:00.000Z'),
        createdAt: new Date('2026-07-22T08:00:00.000Z'),
        updatedAt: new Date('2026-07-22T08:00:00.000Z')
      }
    ]);

    const result = await service.listResolutions({ clienteId: 'cliente-1' });

    expect(prisma.alertResolution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteId: 'cliente-1' }
      })
    );
    expect(result).toEqual([
      {
        alertId: 'audit-1',
        fingerprint: 'fp-1',
        clientId: 'cliente-1',
        origem: 'auditoria',
        titulo: 'CT-e criado no sistema',
        resolvedAt: '2026-07-22T08:00:00.000Z'
      }
    ]);
  });

  it('persiste resolucao generica por alertId', async () => {
    prisma.alertResolution.upsert.mockResolvedValue({
      id: 'res-1',
      alertId: 'audit-1',
      fingerprint: 'fp-1',
      clienteId: 'cliente-1',
      origem: 'auditoria',
      titulo: 'CT-e criado no sistema',
      resolvedAt: new Date('2026-07-22T08:00:00.000Z'),
      createdAt: new Date('2026-07-22T08:00:00.000Z'),
      updatedAt: new Date('2026-07-22T08:00:00.000Z')
    });

    const result = await service.updateResolution('audit-1', {
      resolvido: true,
      fingerprint: 'fp-1',
      clientId: 'cliente-1',
      origem: 'auditoria',
      titulo: 'CT-e criado no sistema'
    });

    expect(prisma.alertResolution.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { alertId: 'audit-1' }
      })
    );
    expect(result.resolvedAt).toBe('2026-07-22T08:00:00.000Z');
  });

  it('remove resolucao generica ao reabrir alerta', async () => {
    const result = await service.updateResolution('audit-1', {
      resolvido: false,
      fingerprint: 'fp-1',
      clientId: 'cliente-1',
      origem: 'auditoria',
      titulo: 'CT-e criado no sistema'
    });

    expect(prisma.alertResolution.deleteMany).toHaveBeenCalledWith({
      where: { alertId: 'audit-1' }
    });
    expect(result.resolvedAt).toBeNull();
  });
});
