import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NfeAmbiente } from '@prisma/client';
import { NfeManifestacaoClient, NfeManifestacaoClientError } from '../../../integrations/nfe-distribuicao/nfe-manifestacao.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/storage.service';
import { NfeManifestacaoService } from '../nfe-manifestacao.service';
import { NFE_AUTOMATION_TERM_VERSION } from '../nfe-manifestacao.service';

describe('NfeManifestacaoService', () => {
  const validAccessKey = '4'.repeat(43) + '8';
  const document = {
    id: 'doc-1',
    clienteId: 'cliente-1',
    estabelecimentoId: 'estab-1',
    ambiente: NfeAmbiente.producao,
    chaveAcesso: validAccessKey,
    modelo: '55',
    tipoRelacao: 'recebida',
    resumoDisponivel: true,
    xmlCompletoDisponivel: false,
    status: 'Autorizada',
    dataAutorizacao: new Date(),
    dataEmissao: new Date(),
    estabelecimento: { id: 'estab-1', clienteId: 'cliente-1', cnpj: '01861020970', ativo: true },
    eventos: []
  };

  const prisma = {
    nfeDocumento: { findFirst: jest.fn(), findMany: jest.fn() },
    nfeManifestacao: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    nfeEvento: { findMany: jest.fn() },
    certificado: { findMany: jest.fn() },
    clienteEstabelecimento: { findFirst: jest.fn() },
    nfeSyncControle: { findMany: jest.fn() },
    nfeAutomacaoConfiguracao: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    nfeAutomacaoAuditoria: { create: jest.fn() },
    nfeXmlRecuperacao: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), createMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() }
  };
  (prisma as any).$transaction = jest.fn((work: (transaction: typeof prisma) => unknown) => work(prisma));
  const storage = { hasObject: jest.fn(), getObject: jest.fn() };
  const client: NfeManifestacaoClient = { sendManifestacao: jest.fn() };
  const service = new NfeManifestacaoService(
    prisma as unknown as PrismaService,
    storage as unknown as LocalStorageService,
    client
  );

  const dto = (overrides: Record<string, unknown> = {}) => ({
    clienteId: 'cliente-1',
    requestId: '3f6d31c8-8932-41d8-b33c-a9d9481f5840',
    tipo: 'ciencia_operacao' as const,
    confirmacaoExpressa: true,
    ...overrides
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'real';
    prisma.nfeDocumento.findFirst.mockResolvedValue({ ...document, estabelecimento: { ...document.estabelecimento }, eventos: [] });
    prisma.nfeManifestacao.findMany.mockResolvedValue([]);
    prisma.nfeManifestacao.findUnique.mockResolvedValue(null);
    prisma.nfeEvento.findMany.mockResolvedValue([]);
    prisma.clienteEstabelecimento.findFirst.mockResolvedValue({ id: 'estab-1', clienteId: 'cliente-1', cnpj: '01861020970' });
    prisma.nfeSyncControle.findMany.mockResolvedValue([]);
    prisma.nfeAutomacaoConfiguracao.findMany.mockResolvedValue([]);
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValue(null);
    prisma.nfeAutomacaoConfiguracao.upsert.mockResolvedValue({
      id: 'config-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: true, recuperacaoXmlAutomatica: false, autorizacaoAtiva: true,
      autorizadaEm: new Date(), versaoTermo: NFE_AUTOMATION_TERM_VERSION, revogadaEm: null
    });
    prisma.nfeAutomacaoConfiguracao.update.mockResolvedValue({
      id: 'config-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: false, recuperacaoXmlAutomatica: false, autorizacaoAtiva: false,
      autorizadaEm: new Date(), versaoTermo: NFE_AUTOMATION_TERM_VERSION, revogadaEm: new Date()
    });
    prisma.nfeAutomacaoAuditoria.create.mockResolvedValue({});
    prisma.nfeDocumento.findMany.mockResolvedValue([]);
    prisma.nfeXmlRecuperacao.findMany.mockResolvedValue([]);
    prisma.nfeXmlRecuperacao.findUnique.mockResolvedValue(null);
    prisma.nfeXmlRecuperacao.createMany.mockResolvedValue({ count: 0 });
    prisma.nfeXmlRecuperacao.updateMany.mockResolvedValue({ count: 1 });
    prisma.nfeEvento.findMany.mockResolvedValue([]);
    prisma.certificado.findMany.mockResolvedValue([{
      id: 'cert-1',
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-1.bin'
    }]);
    storage.hasObject.mockResolvedValue(true);
    let saved: Record<string, unknown> = {};
    prisma.nfeManifestacao.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      saved = { id: 'manifest-1', ...data };
      return saved;
    });
    prisma.nfeManifestacao.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      saved = { ...saved, ...data };
      return saved;
    });
    (client.sendManifestacao as jest.Mock).mockResolvedValue({
      statusCode: 200,
      cStat: '128',
      xMotivo: 'Lote de evento processado',
      eventCStat: '135',
      eventXMotivo: 'Evento registrado e vinculado a NF-e',
      nProt: '142260000000001'
    });
  });

  afterEach(() => {
    delete process.env.NFE_DISTRIBUICAO_CLIENT_MODE;
  });

  it('exige autorização explícita antes de qualquer transmissão', async () => {
    await expect(service.registrar('doc-1', dto({ confirmacaoExpressa: false }) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.sendManifestacao).not.toHaveBeenCalled();
    expect(prisma.nfeManifestacao.create).not.toHaveBeenCalled();
  });

  it('exige consentimento e versão vigente do termo para ativar Ciência automática', async () => {
    await expect(service.updateAutomationSettings({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: true, recuperacaoXmlAutomatica: false,
      confirmacaoExpressa: false, versaoTermo: NFE_AUTOMATION_TERM_VERSION
    }, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.nfeAutomacaoConfiguracao.upsert).not.toHaveBeenCalled();
  });

  it('registra escopo por estabelecimento e auditoria ao conceder autorização automática', async () => {
    const result = await service.updateAutomationSettings({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: true, recuperacaoXmlAutomatica: false,
      confirmacaoExpressa: true, versaoTermo: NFE_AUTOMATION_TERM_VERSION
    }, 'user-1');
    expect(prisma.nfeAutomacaoConfiguracao.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { clienteId_estabelecimentoId_ambiente: { clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao } },
      create: expect.objectContaining({ clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cienciaAutomatica: true, usuarioAutorizouId: 'user-1' })
    }));
    expect(prisma.nfeAutomacaoAuditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ usuarioId: 'user-1', acao: 'autorizacao_concedida', autorizacaoAtiva: true })
    }));
    expect(result.autorizacaoAtiva).toBe(true);
  });

  it('revoga a autorização para novas Ciências sem desativar a recuperação de XML', async () => {
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValueOnce({ id: 'config-1', autorizacaoAtiva: true });
    prisma.nfeAutomacaoConfiguracao.update.mockResolvedValueOnce({
      id: 'config-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: false, recuperacaoXmlAutomatica: true, autorizacaoAtiva: false,
      autorizadaEm: new Date(), versaoTermo: NFE_AUTOMATION_TERM_VERSION, revogadaEm: new Date()
    });
    const result = await service.revokeAutomationAuthorization({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
    }, 'user-2');
    expect(result.autorizacaoAtiva).toBe(false);
    expect(result.recuperacaoXmlAutomatica).toBe(true);
    expect(prisma.nfeAutomacaoAuditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ usuarioId: 'user-2', acao: 'autorizacao_revogada', recuperacaoXml: true })
    }));
  });

  it('registra a manifestação CPF aceita e mantém o histórico sem expor o CPF', async () => {
    const logger = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    const result = await service.registrar('doc-1', dto() as any, 'user-1');

    expect(prisma.certificado.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cnpjTitular: '01861020970' })
    }));
    expect(client.sendManifestacao).toHaveBeenCalledWith(expect.objectContaining({
      cnpjConsulta: '01861020970',
      chaveAcesso: validAccessKey,
      tipo: 'ciencia_operacao',
      sequencia: 1,
      certificateId: 'cert-1'
    }));
    expect(result).toMatchObject({ status: 'registrada', cStat: '135', nProt: '142260000000001' });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('01861020970');
    expect(JSON.stringify(logger.mock.calls)).not.toContain(validAccessKey);
  });

  it('aceita certificado de CNPJ que corresponda exatamente ao estabelecimento', async () => {
    prisma.nfeDocumento.findFirst.mockResolvedValueOnce({
      ...document,
      estabelecimento: { ...document.estabelecimento, cnpj: '12345678000199' }
    });
    prisma.certificado.findMany.mockResolvedValueOnce([{ id: 'cert-cnpj', arquivoCriptografadoPath: 'certs/cnpj.pfx' }]);

    const result = await service.registrar('doc-1', dto({ requestId: '9e6d31c8-8932-41d8-b33c-a9d9481f5840' }) as any);

    expect(prisma.certificado.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cnpjTitular: '12345678000199' })
    }));
    expect(result.status).toBe('registrada');
  });

  it('mantém o cStat do evento 136 como registrado sem vínculo e não o trata como XML liberado', async () => {
    (client.sendManifestacao as jest.Mock).mockResolvedValueOnce({
      statusCode: 200, cStat: '128', xMotivo: 'Lote processado', eventCStat: '136', eventXMotivo: 'Evento registrado sem vínculo', nProt: null
    });

    const result = await service.registrar('doc-1', dto() as any);

    expect(result).toMatchObject({ status: 'registrada_sem_vinculo', cStat: '136' });
  });

  it('persiste rejeição SEFAZ real sem transformar em sucesso', async () => {
    (client.sendManifestacao as jest.Mock).mockResolvedValueOnce({
      statusCode: 200, cStat: '128', xMotivo: 'Lote processado', eventCStat: '573', eventXMotivo: 'Duplicidade de evento', nProt: null
    });

    const result = await service.registrar('doc-1', dto() as any);

    expect(result).toMatchObject({ status: 'rejeitada', cStat: '573', xMotivo: 'Duplicidade de evento' });
  });

  it('bloqueia quando o certificado não corresponde ao CPF do estabelecimento', async () => {
    prisma.certificado.findMany.mockResolvedValueOnce([]);

    await expect(service.registrar('doc-1', dto() as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('não usa o adaptador mock para transmitir manifestação', async () => {
    process.env.NFE_DISTRIBUICAO_CLIENT_MODE = 'mock';

    await expect(service.registrar('doc-1', dto() as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('não envia evento para documento fora do escopo do cliente', async () => {
    prisma.nfeDocumento.findFirst.mockResolvedValueOnce(null);

    await expect(service.registrar('doc-1', dto() as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('respeita prazo oficial de 90 dias para manifestação conclusiva', async () => {
    prisma.nfeDocumento.findFirst.mockResolvedValueOnce({
      ...document,
      dataAutorizacao: new Date('2025-01-01T00:00:00.000Z')
    });

    await expect(service.registrar('doc-1', dto({ tipo: 'confirmacao_operacao' }) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('exige justificativa para Operação não Realizada', async () => {
    await expect(service.registrar('doc-1', dto({ tipo: 'operacao_nao_realizada' }) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('não repete automaticamente um envio cujo resultado ficou indeterminado', async () => {
    (client.sendManifestacao as jest.Mock).mockRejectedValueOnce(new Error('socket timeout'));
    const first = await service.registrar('doc-1', dto() as any);
    expect(first.status).toBe('resultado_indeterminado');
    prisma.nfeManifestacao.findMany.mockResolvedValueOnce([{
      tipoEvento: '210210', status: 'resultado_indeterminado', nSeqEvento: 1
    }]);

    await expect(service.registrar('doc-1', dto({ requestId: '8e6d31c8-8932-41d8-b33c-a9d9481f5840' }) as any)).rejects.toBeInstanceOf(ConflictException);
    expect(client.sendManifestacao).toHaveBeenCalledTimes(1);
  });

  it('identifica falha local anterior ao envio e permite nova tentativa somente em ação manual', async () => {
    (client.sendManifestacao as jest.Mock).mockRejectedValueOnce(new NfeManifestacaoClientError('Falha ao preparar assinatura', false));

    const first = await service.registrar('doc-1', dto() as any);
    expect(first.status).toBe('falha_local');
    expect(prisma.nfeManifestacao.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'falha_local' })
    }));

    const second = await service.registrar('doc-1', dto({ requestId: '7e6d31c8-8932-41d8-b33c-a9d9481f5840' }) as any);
    expect(second.status).toBe('registrada');
    expect(client.sendManifestacao).toHaveBeenCalledTimes(2);
  });

  it('mostra no histórico o cStat lido do evento recebido na distribuição', async () => {
    const eventDate = new Date();
    prisma.nfeEvento.findMany.mockResolvedValueOnce([{
      id: 'event-1', tipoEvento: '210210', dataEvento: eventDate, descricao: 'Ciência da Operação', xmlPath: 'events/event-1.xml', createdAt: eventDate
    }]);
    storage.getObject.mockResolvedValueOnce(Buffer.from('<procEventoNFe><retEvento><infEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado à NF-e</xMotivo><nProt>142260000000001</nProt></infEvento></retEvento></procEventoNFe>'));
    prisma.nfeManifestacao.findMany.mockResolvedValueOnce([]);

    const result = await service.getHistory('doc-1', 'cliente-1');

    expect(result.status).toBe('aguardando_disponibilizacao');
    expect(result.historico).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipoEvento: '210210', origem: 'distribuicao', status: 'registrada', cStat: '135' })
    ]));
  });

  it('não conclui que houve autorização quando o evento importado não contém cStat', async () => {
    prisma.nfeEvento.findMany.mockResolvedValueOnce([{
      id: 'event-unknown', tipoEvento: '210210', dataEvento: new Date(), descricao: 'Ciência da Operação', xmlPath: 'events/unknown.xml', createdAt: new Date()
    }]);
    storage.getObject.mockResolvedValueOnce(Buffer.from('<evento><infEvento><tpEvento>210210</tpEvento></infEvento></evento>'));
    prisma.nfeManifestacao.findMany.mockResolvedValueOnce([]);

    const result = await service.getHistory('doc-1', 'cliente-1');

    expect(result.status).toBe('resumo_disponivel');
    expect(result.historico).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'resultado_indeterminado', cStat: null })
    ]));
  });

  it('revokes consent and records the audit when automatic Science is switched off', async () => {
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValueOnce({ id: 'config-1', autorizacaoAtiva: true });
    prisma.nfeAutomacaoConfiguracao.upsert.mockResolvedValueOnce({
      id: 'config-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: false, recuperacaoXmlAutomatica: true, autorizacaoAtiva: false,
      autorizadaEm: new Date(), versaoTermo: NFE_AUTOMATION_TERM_VERSION, revogadaEm: new Date()
    });

    await service.updateAutomationSettings({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: false, recuperacaoXmlAutomatica: true
    }, 'user-2');

    expect(prisma.nfeAutomacaoConfiguracao.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ autorizacaoAtiva: false, revogadaPorId: 'user-2' })
    }));
    expect(prisma.nfeAutomacaoAuditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ acao: 'autorizacao_revogada', autorizacaoAtiva: false, recuperacaoXml: true })
    }));
  });

  it('lists unqueued received summaries as pending manual Science', async () => {
    prisma.nfeXmlRecuperacao.findMany.mockResolvedValueOnce([]);
    prisma.nfeDocumento.findMany.mockResolvedValueOnce([{
      id: 'doc-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      numeroNfe: '5307', dataEmissao: new Date('2026-06-29T13:00:00Z'), schemaDoc: 'resNFe_v1.01.xsd',
      resumoDisponivel: true, xmlCompletoDisponivel: false
    }]);

    const result = await service.listAutomaticRecoveryItems({ clienteId: 'cliente-1' } as any);

    expect(result).toEqual([expect.objectContaining({ documentoId: 'doc-1', status: 'aguardando_ciencia', resumoDisponivel: true })]);
    expect(prisma.nfeDocumento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clienteId: 'cliente-1', tipoRelacao: 'recebida', xmlRecuperacao: null })
    }));
  });

  it('keeps a summary pending without automatic consent and sends no event', async () => {
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: { cienciaAutomatica: false, recuperacaoXmlAutomatica: true, autorizacaoAtiva: false },
      nfeDocumento: { ...document, estabelecimento: { ...document.estabelecimento } }
    });

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'aguardando_ciencia' });
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('registers authorized Science before allowing a full XML query', async () => {
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValueOnce({ cienciaAutomatica: true, autorizacaoAtiva: true });
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        usuarioAutorizouId: 'user-1', autorizadaEm: new Date(),
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, estabelecimento: { ...document.estabelecimento } }
    });

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual(expect.objectContaining({ canQuery: true, status: 'aguardando_xml', estabelecimentoId: 'estab-1' }));
    expect(client.sendManifestacao).toHaveBeenCalledTimes(1);
    expect(prisma.nfeManifestacao.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tipoEvento: '210210', usuarioId: 'user-1', estabelecimentoId: 'estab-1', status: 'enviando' })
    }));
  });

  it.each(['2', '3', '9'])('does not send automatic Science when resNFe cSitNFe is %s', async (cSitNFe) => {
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        usuarioAutorizouId: 'user-1', autorizadaEm: new Date(),
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, status: cSitNFe, estabelecimento: { ...document.estabelecimento } }
    });
    prisma.nfeDocumento.findFirst.mockResolvedValueOnce({
      ...document, status: cSitNFe, estabelecimento: { ...document.estabelecimento }, eventos: []
    });

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'resumo_nao_autorizado' });
    expect(prisma.nfeManifestacao.create).not.toHaveBeenCalled();
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('does not repeat an indeterminate Science event or allow an XML query', async () => {
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, estabelecimento: { ...document.estabelecimento } }
    });
    prisma.nfeManifestacao.findMany.mockResolvedValueOnce([{ tipoEvento: '210210', status: 'resultado_indeterminado' }]);

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'resultado_indeterminado' });
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('waits for event distribution after cStat 136 and never sends a duplicate Science', async () => {
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValueOnce({ cienciaAutomatica: true, autorizacaoAtiva: true });
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        usuarioAutorizouId: 'user-1', autorizadaEm: new Date(),
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, estabelecimento: { ...document.estabelecimento } }
    });
    prisma.nfeManifestacao.findMany.mockResolvedValueOnce([]);
    (client.sendManifestacao as jest.Mock).mockResolvedValueOnce({
      statusCode: 200, cStat: '128', eventCStat: '136', eventXMotivo: 'Event recorded without linkage', xMotivo: 'Batch processed'
    });

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'aguardando_evento_distribuicao' });
    expect(client.sendManifestacao).toHaveBeenCalledTimes(1);
    expect(prisma.nfeXmlRecuperacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'aguardando_evento_distribuicao', resultadoConsulta: 'registrada_sem_vinculo' })
    }));
  });

  it('marks automatic recovery as certificate pending when no valid establishment certificate exists', async () => {
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        usuarioAutorizouId: 'user-1', autorizadaEm: new Date(),
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, estabelecimento: { ...document.estabelecimento } }
    });
    prisma.certificado.findMany.mockResolvedValueOnce([]);

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'certificado_pendente' });
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('blocks automatic Science when the official ten-day deadline has expired', async () => {
    const expired = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        usuarioAutorizouId: 'user-1', autorizadaEm: new Date(),
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, dataAutorizacao: expired, estabelecimento: { ...document.estabelecimento } }
    });
    prisma.nfeDocumento.findFirst.mockResolvedValueOnce({
      ...document, dataAutorizacao: expired, estabelecimento: { ...document.estabelecimento }
    });

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'ciencia_fora_prazo' });
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });

  it('requeues previously registered Science when automatic XML retrieval is enabled later', async () => {
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValueOnce({ id: 'config-1', autorizacaoAtiva: false });
    prisma.nfeAutomacaoConfiguracao.upsert.mockResolvedValueOnce({
      id: 'config-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: false, recuperacaoXmlAutomatica: true, autorizacaoAtiva: false,
      autorizadaEm: null, versaoTermo: null, revogadaEm: null
    });

    await service.updateAutomationSettings({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao,
      cienciaAutomatica: false, recuperacaoXmlAutomatica: true
    });

    expect(prisma.nfeXmlRecuperacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { configuracaoId: 'config-1', status: 'ciencia_registrada' },
      data: expect.objectContaining({ status: 'aguardando_xml' })
    }));
  });

  it('rechecks current consent immediately before automatic Science transmission', async () => {
    prisma.nfeXmlRecuperacao.findFirst.mockResolvedValueOnce({
      id: 'task-1', leaseId: 'lease-1',
      configuracao: {
        cienciaAutomatica: true, recuperacaoXmlAutomatica: true, autorizacaoAtiva: true,
        usuarioAutorizouId: 'user-1', autorizadaEm: new Date(),
        clienteId: 'cliente-1', estabelecimentoId: 'estab-1', ambiente: NfeAmbiente.producao
      },
      nfeDocumento: { ...document, estabelecimento: { ...document.estabelecimento } }
    });
    prisma.nfeAutomacaoConfiguracao.findUnique.mockResolvedValueOnce(null);

    const result = await service.prepareAutomaticRecovery('task-1', 'lease-1');

    expect(result).toEqual({ canQuery: false, status: 'autorizacao_revogada' });
    expect(prisma.nfeManifestacao.create).not.toHaveBeenCalled();
    expect(client.sendManifestacao).not.toHaveBeenCalled();
  });
});
