import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NfeAmbiente, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NFE_MANIFESTACAO_CLIENT,
  NFE_MANIFESTACAO_EVENT_CODES,
  NfeManifestacaoClient,
  NfeManifestacaoClientError,
  NfeManifestacaoResult,
  NfeManifestacaoTipo
} from '../../integrations/nfe-distribuicao/nfe-manifestacao.types';
import { RegistrarNfeManifestacaoDto } from './dto/registrar-manifestacao.dto';
import { NfeAutomacaoQueryDto, RevogarAutomacaoNfeDto, UpdateAutomacaoNfeDto } from './dto/update-automacao-nfe.dto';

const SCIENCE_CODE = NFE_MANIFESTACAO_EVENT_CODES.ciencia_operacao;
const FINAL_CODES = new Set([
  NFE_MANIFESTACAO_EVENT_CODES.confirmacao_operacao,
  NFE_MANIFESTACAO_EVENT_CODES.desconhecimento_operacao,
  NFE_MANIFESTACAO_EVENT_CODES.operacao_nao_realizada
]);
const TERMINAL_ACCEPTED_STATUSES = new Set(['registrada', 'registrada_sem_vinculo']);
const INDETERMINATE_STATUSES = new Set(['enviando', 'resultado_indeterminado']);
const STALE_MANIFESTATION_ATTEMPT_MS = 10 * 60 * 1000;
export const NFE_AUTOMATION_TERM_VERSION = '2026-10-v1';
const CERTIFICATE_RECOVERY_STATUSES = [
  'certificado_pendente',
  'certificado_nao_cadastrado',
  'certificado_inativo',
  'certificado_expirado',
  'certificado_incompativel',
  'certificado_indisponivel'
] as const;
const CERTIFICATE_RECOVERY_STATUS_SET = new Set<string>(CERTIFICATE_RECOVERY_STATUSES);
const RECOVERY_STATUSES = [
  'aguardando_ciencia', 'ciencia_aguardando_envio', 'aguardando_evento_distribuicao', 'aguardando_xml', 'aguardando_sefaz',
  ...CERTIFICATE_RECOVERY_STATUSES
] as const;

type AutomaticRecoveryPreparation =
  | { canQuery: false; status: string }
  | {
      canQuery: true;
      status: 'aguardando_xml';
      clienteId: string;
      estabelecimentoId: string;
      actorType: 'CPF' | 'CNPJ';
      ambiente: NfeAmbiente;
      chaveAcesso: string;
    };

type ManifestationStatus = 'registrada' | 'registrada_sem_vinculo' | 'rejeitada' | 'falha_local' | 'resultado_indeterminado' | 'enviando';

type CertificateResolution =
  | { certificate: { id: string; arquivoCriptografadoPath: string }; status: null; reason: null }
  | { certificate: null; status: typeof CERTIFICATE_RECOVERY_STATUSES[number]; reason: string };

@Injectable()
export class NfeManifestacaoService {
  private readonly logger = new Logger(NfeManifestacaoService.name);
  private readonly recoveryRetryMs = 6 * 60 * 60 * 1000;
  private readonly recoveryLeaseMs = 20 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    @Inject(NFE_MANIFESTACAO_CLIENT) private readonly manifestacaoClient: NfeManifestacaoClient
  ) {}

  async listAutomationSettings(query: NfeAutomacaoQueryDto) {
    const where = {
      clienteId: query.clienteId,
      ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {})
    };
    const [controls, settings, recoveries] = await Promise.all([
      this.prisma.nfeSyncControle.findMany({
        where,
        orderBy: [{ estabelecimentoId: 'asc' }, { ambiente: 'asc' }],
        select: { id: true, clienteId: true, estabelecimentoId: true, cnpjConsulta: true, ambiente: true, status: true }
      }),
      this.prisma.nfeAutomacaoConfiguracao.findMany({ where, include: { usuarioAutorizou: { select: { id: true, nome: true, username: true } } } }),
      this.prisma.nfeXmlRecuperacao.findMany({ where, select: { estabelecimentoId: true, ambiente: true, status: true } })
    ]);
    const settingsByScope = new Map(settings.map((item) => [`${item.estabelecimentoId}|${item.ambiente}`, item]));
    const pendingByScope = new Map<string, Record<string, number>>();
    for (const row of recoveries) {
      const key = `${row.estabelecimentoId}|${row.ambiente}`;
      const counts = pendingByScope.get(key) ?? {};
      counts[row.status] = (counts[row.status] || 0) + 1;
      pendingByScope.set(key, counts);
    }
    const seen = new Set<string>();
    return controls.flatMap((control) => {
      const key = `${control.estabelecimentoId}|${control.ambiente}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const setting = settingsByScope.get(key);
      return [{
        controlId: control.id,
        clienteId: control.clienteId,
        estabelecimentoId: control.estabelecimentoId,
        ambiente: control.ambiente,
        actorType: this.onlyDigits(control.cnpjConsulta).length === 11 ? 'CPF' : 'CNPJ',
        cienciaAutomatica: setting?.cienciaAutomatica ?? false,
        recuperacaoXmlAutomatica: setting?.recuperacaoXmlAutomatica ?? false,
        autorizacaoAtiva: setting?.autorizacaoAtiva ?? false,
        autorizadaEm: setting?.autorizadaEm ?? null,
        versaoTermo: setting?.versaoTermo ?? null,
        autorizadaPor: setting?.usuarioAutorizou?.nome || setting?.usuarioAutorizou?.username || null,
        revogadaEm: setting?.revogadaEm ?? null,
        pendencias: pendingByScope.get(key) ?? {}
      }];
    });
  }

  async updateAutomationSettings(dto: UpdateAutomacaoNfeDto, usuarioId?: string) {
    const establishment = await this.prisma.clienteEstabelecimento.findFirst({
      where: { id: dto.estabelecimentoId, clienteId: dto.clienteId, ativo: true },
      select: { id: true, clienteId: true, cnpj: true }
    });
    if (!establishment) throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado.');
    const actor = this.onlyDigits(establishment.cnpj);
    if (actor.length !== 11 && actor.length !== 14) {
      throw new BadRequestException('O estabelecimento precisa ter um CPF ou CNPJ valido para habilitar a automacao de NF-e.');
    }
    if (dto.cienciaAutomatica && (dto.confirmacaoExpressa !== true || dto.versaoTermo !== NFE_AUTOMATION_TERM_VERSION)) {
      throw new BadRequestException(`A autorizacao expressa e a aceitacao do termo ${NFE_AUTOMATION_TERM_VERSION} sao obrigatorias para ativar a Ciencia automatica.`);
    }

    const where = {
      clienteId_estabelecimentoId_ambiente: {
        clienteId: dto.clienteId,
        estabelecimentoId: dto.estabelecimentoId,
        ambiente: dto.ambiente
      }
    };
    const previous = await this.prisma.nfeAutomacaoConfiguracao.findUnique({ where });
    const now = new Date();
    const grantsAuthorization = dto.cienciaAutomatica === true;
    const revokesAuthorization = Boolean(previous?.autorizacaoAtiva && !grantsAuthorization);
    const action = grantsAuthorization && !previous?.autorizacaoAtiva
      ? 'autorizacao_concedida'
      : revokesAuthorization
        ? 'autorizacao_revogada'
        : previous ? 'configuracao_atualizada' : 'configuracao_criada';
    const config = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.nfeAutomacaoConfiguracao.upsert({
        where,
        create: {
          clienteId: dto.clienteId,
          estabelecimentoId: dto.estabelecimentoId,
          ambiente: dto.ambiente,
          cienciaAutomatica: dto.cienciaAutomatica,
          recuperacaoXmlAutomatica: dto.recuperacaoXmlAutomatica,
          autorizacaoAtiva: grantsAuthorization,
          usuarioAutorizouId: grantsAuthorization ? usuarioId : undefined,
          autorizadaEm: grantsAuthorization ? now : undefined,
          versaoTermo: grantsAuthorization ? NFE_AUTOMATION_TERM_VERSION : undefined
        },
        update: {
          cienciaAutomatica: dto.cienciaAutomatica,
          recuperacaoXmlAutomatica: dto.recuperacaoXmlAutomatica,
          ...(grantsAuthorization ? {
            autorizacaoAtiva: true,
            usuarioAutorizouId: usuarioId,
            autorizadaEm: now,
            versaoTermo: NFE_AUTOMATION_TERM_VERSION,
            revogadaPorId: null,
            revogadaEm: null
          } : {}),
          ...(revokesAuthorization ? {
            autorizacaoAtiva: false,
            revogadaPorId: usuarioId,
            revogadaEm: now
          } : {})
        }
      });
      await tx.nfeAutomacaoAuditoria.create({
        data: {
          clienteId: dto.clienteId,
          estabelecimentoId: dto.estabelecimentoId,
          configuracaoId: saved.id,
          usuarioId,
          acao: action,
          cienciaAutomatica: saved.cienciaAutomatica,
          recuperacaoXml: saved.recuperacaoXmlAutomatica,
          autorizacaoAtiva: saved.autorizacaoAtiva,
          versaoTermo: grantsAuthorization ? NFE_AUTOMATION_TERM_VERSION : saved.versaoTermo
        }
      });
      return saved;
    });
    if (config.cienciaAutomatica || config.recuperacaoXmlAutomatica) {
      await this.enqueueExistingSummaries(config);
    }
    if (config.recuperacaoXmlAutomatica) {
      await this.prisma.nfeXmlRecuperacao.updateMany({
        where: { configuracaoId: config.id, status: 'ciencia_registrada' },
        data: { status: 'aguardando_xml', proximaTentativaEm: now, cStat: null, xMotivo: null }
      });
    }
    if (config.autorizacaoAtiva && config.cienciaAutomatica) {
      await this.prisma.nfeXmlRecuperacao.updateMany({
        where: { configuracaoId: config.id, status: 'aguardando_ciencia' },
        data: { status: 'ciencia_aguardando_envio', proximaTentativaEm: now, cStat: null, xMotivo: null }
      });
      await this.prisma.nfeXmlRecuperacao.updateMany({
        where: { configuracaoId: config.id, status: 'autorizacao_revogada' },
        data: { status: 'ciencia_aguardando_envio', proximaTentativaEm: now, cStat: null, xMotivo: null }
      });
      await this.prisma.nfeXmlRecuperacao.updateMany({
        where: { configuracaoId: config.id, status: { in: [...CERTIFICATE_RECOVERY_STATUSES] } },
        data: {
          status: 'ciencia_aguardando_envio', proximaTentativaEm: now, cStat: null,
          xMotivo: null, resultadoConsulta: 'certificado_revalidar'
        }
      });
    }
    return this.toPublicAutomationConfig(config);
  }

  async revokeAutomationAuthorization(dto: RevogarAutomacaoNfeDto, usuarioId?: string) {
    const where = {
      clienteId_estabelecimentoId_ambiente: {
        clienteId: dto.clienteId,
        estabelecimentoId: dto.estabelecimentoId,
        ambiente: dto.ambiente
      }
    };
    const previous = await this.prisma.nfeAutomacaoConfiguracao.findUnique({ where });
    if (!previous) throw new NotFoundException('Nao existe autorizacao de automacao para revogar neste estabelecimento e ambiente.');
    const config = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.nfeAutomacaoConfiguracao.update({
        where,
        data: { cienciaAutomatica: false, autorizacaoAtiva: false, revogadaPorId: usuarioId, revogadaEm: new Date() }
      });
      await tx.nfeAutomacaoAuditoria.create({
        data: {
          clienteId: dto.clienteId,
          estabelecimentoId: dto.estabelecimentoId,
          configuracaoId: saved.id,
          usuarioId,
          acao: 'autorizacao_revogada',
          cienciaAutomatica: false,
          recuperacaoXml: saved.recuperacaoXmlAutomatica,
          autorizacaoAtiva: false,
          versaoTermo: saved.versaoTermo
        }
      });
      return saved;
    });
    return this.toPublicAutomationConfig(config);
  }

  async listAutomaticRecoveryItems(query: NfeAutomacaoQueryDto) {
    const rows = await this.prisma.nfeXmlRecuperacao.findMany({
      where: {
        clienteId: query.clienteId,
        ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}),
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: [{ proximaTentativaEm: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
      include: { nfeDocumento: { select: { id: true, numeroNfe: true, dataEmissao: true, schemaDoc: true, resumoDisponivel: true, xmlCompletoDisponivel: true } } }
    });
    const queued = rows.map((item) => ({
      id: item.id,
      documentoId: item.nfeDocumentoId,
      clienteId: item.clienteId,
      estabelecimentoId: item.estabelecimentoId,
      ambiente: item.ambiente,
      status: item.status,
      tentativas: item.tentativas,
      proximaTentativaEm: item.proximaTentativaEm,
      ultimaTentativaEm: item.ultimaTentativaEm,
      cStat: item.cStat,
      xMotivo: this.sanitizeSefazText(item.xMotivo),
      numeroNfe: item.nfeDocumento.numeroNfe,
      dataEmissao: item.nfeDocumento.dataEmissao,
      schemaDoc: item.nfeDocumento.schemaDoc,
      resumoDisponivel: item.nfeDocumento.resumoDisponivel,
      xmlCompletoDisponivel: item.nfeDocumento.xmlCompletoDisponivel
    }));
    const unqueuedSummaries = !query.status || query.status === 'aguardando_ciencia'
      ? await this.prisma.nfeDocumento.findMany({
      where: {
        OR: [
          {
            clienteId: query.clienteId,
            ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}),
            tipoRelacao: 'recebida'
          },
          {
            vinculos: { some: {
              clienteId: query.clienteId,
              ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}),
              tipoRelacao: 'recebida'
            } }
          }
        ],
        modelo: '55',
        resumoDisponivel: true,
        xmlCompletoDisponivel: false,
        xmlRecuperacoes: { none: { clienteId: query.clienteId, ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}) } }
      },
      orderBy: [{ dataEmissao: 'asc' }, { createdAt: 'asc' }],
      take: Math.max(0, 200 - queued.length),
      select: {
        id: true, clienteId: true, estabelecimentoId: true, ambiente: true, numeroNfe: true,
        dataEmissao: true, schemaDoc: true, resumoDisponivel: true, xmlCompletoDisponivel: true,
        vinculos: {
          where: { clienteId: query.clienteId, ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}) },
          select: { clienteId: true, estabelecimentoId: true, tipoRelacao: true }
        }
      }
      })
      : [];
    return [
      ...queued,
      ...unqueuedSummaries.map((document) => {
        const link = (document as typeof document & { vinculos?: Array<any> }).vinculos?.[0];
        return {
        id: `resumo-${document.id}`,
        documentoId: document.id,
        clienteId: link?.clienteId ?? document.clienteId,
        estabelecimentoId: link?.estabelecimentoId ?? document.estabelecimentoId,
        ambiente: document.ambiente,
        status: 'aguardando_ciencia',
        tentativas: 0,
        proximaTentativaEm: null,
        ultimaTentativaEm: null,
        cStat: null,
        xMotivo: 'Aguardando autorização expressa de Ciência da Operação para este estabelecimento e ambiente. Nenhum evento foi enviado.',
        numeroNfe: document.numeroNfe,
        dataEmissao: document.dataEmissao,
        schemaDoc: document.schemaDoc,
        resumoDisponivel: document.resumoDisponivel,
        xmlCompletoDisponivel: document.xmlCompletoDisponivel
        };
      })
    ];
  }

  async listAutomationManifestations(query: NfeAutomacaoQueryDto) {
    const rows = await this.prisma.nfeManifestacao.findMany({
      where: { clienteId: query.clienteId, ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, nfeDocumentoId: true, estabelecimentoId: true, ambiente: true, tipoEvento: true,
        certificadoId: true, cpfCnpjDestinatario: true, usuarioId: true, status: true, cStat: true, xMotivo: true, nProt: true,
        cStatLote: true, xMotivoLote: true, httpStatus: true, enviadoEm: true, processadoEm: true, createdAt: true,
        nfeDocumento: { select: { numeroNfe: true, dataEmissao: true } }
      }
    });
    return rows.map((item) => ({
      ...item,
      xMotivo: this.sanitizeSefazText(item.xMotivo),
      xMotivoLote: this.sanitizeSefazText(item.xMotivoLote)
    }));
  }

  async listAutomationAudit(query: NfeAutomacaoQueryDto) {
    return this.prisma.nfeAutomacaoAuditoria.findMany({
      where: { clienteId: query.clienteId, ...(query.estabelecimentoId ? { estabelecimentoId: query.estabelecimentoId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, estabelecimentoId: true, configuracaoId: true, usuarioId: true, acao: true,
        cienciaAutomatica: true, recuperacaoXml: true, autorizacaoAtiva: true, versaoTermo: true, createdAt: true
      }
    });
  }

  async observePersistedDocument(documentId: string, clienteId?: string, estabelecimentoId?: string) {
    const document = await this.prisma.nfeDocumento.findFirst({
      where: {
        id: documentId,
        ...(clienteId ? {
          OR: [
            { clienteId },
            { vinculos: { some: { clienteId, ...(estabelecimentoId ? { estabelecimentoId } : {}) } } }
          ]
        } : {})
      },
      select: {
        id: true, clienteId: true, estabelecimentoId: true, ambiente: true, modelo: true, tipoRelacao: true,
        resumoDisponivel: true, xmlCompletoDisponivel: true,
        ...(clienteId ? {
          vinculos: {
            where: { clienteId, ...(estabelecimentoId ? { estabelecimentoId } : {}) },
            select: { clienteId: true, estabelecimentoId: true, tipoRelacao: true }
          }
        } : {})
      }
    });
    if (!document) return;
    const link = (document as typeof document & { vinculos?: Array<{ clienteId: string; estabelecimentoId: string; tipoRelacao: string | null }> }).vinculos?.[0];
    if (link) {
      document.clienteId = link.clienteId;
      document.estabelecimentoId = link.estabelecimentoId;
      document.tipoRelacao = link.tipoRelacao as typeof document.tipoRelacao;
    }
    if (document.xmlCompletoDisponivel) {
      await this.prisma.nfeXmlRecuperacao.updateMany({
        where: { nfeDocumentoId: document.id },
        data: { status: 'xml_disponivel', cStat: null, xMotivo: null, resultadoConsulta: 'xml_completo', proximaTentativaEm: null, leaseId: null, leaseAte: null }
      });
      return;
    }
    if (document.modelo !== '55' || document.tipoRelacao !== 'recebida' || !document.resumoDisponivel) return;
    const config = await this.prisma.nfeAutomacaoConfiguracao.findUnique({
      where: { clienteId_estabelecimentoId_ambiente: { clienteId: document.clienteId, estabelecimentoId: document.estabelecimentoId, ambiente: document.ambiente } }
    });
    if (!config || (!config.cienciaAutomatica && !config.recuperacaoXmlAutomatica)) return;
    await this.prisma.nfeXmlRecuperacao.createMany({
        data: [{
        nfeDocumentoId: document.id,
        clienteId: document.clienteId,
        estabelecimentoId: document.estabelecimentoId,
        configuracaoId: config.id,
        ambiente: document.ambiente,
          status: config.cienciaAutomatica && config.autorizacaoAtiva ? 'ciencia_aguardando_envio' : 'aguardando_ciencia',
          proximaTentativaEm: config.autorizacaoAtiva && config.cienciaAutomatica ? new Date() : null,
          xMotivo: config.autorizacaoAtiva && config.cienciaAutomatica
            ? null
            : 'Aguardando autorização expressa de Ciência da Operação para este estabelecimento e ambiente.'
      }],
      skipDuplicates: true
    });
  }

  async claimDueRecoveryTasks(limit = 3) {
    const now = new Date();
    const rows = await this.prisma.nfeXmlRecuperacao.findMany({
      where: {
        status: { in: [...RECOVERY_STATUSES] },
        AND: [
          { OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: now } }] },
          { OR: [{ leaseAte: null }, { leaseAte: { lt: now } }] },
          { OR: [
            { status: 'aguardando_ciencia', configuracao: { autorizacaoAtiva: true, cienciaAutomatica: true } },
            { status: 'ciencia_aguardando_envio', configuracao: { autorizacaoAtiva: true, cienciaAutomatica: true } },
            { status: { in: [...CERTIFICATE_RECOVERY_STATUSES] }, configuracao: { autorizacaoAtiva: true, cienciaAutomatica: true } },
            { status: 'aguardando_evento_distribuicao', configuracao: { recuperacaoXmlAutomatica: true } },
            { status: 'aguardando_xml', configuracao: { recuperacaoXmlAutomatica: true } },
            { status: 'aguardando_sefaz', configuracao: { recuperacaoXmlAutomatica: true } }
          ] }
        ]
      },
      orderBy: [{ proximaTentativaEm: 'asc' }, { createdAt: 'asc' }],
      take: Math.max(1, Math.min(limit, 3))
    });
    const claimed = [];
    for (const row of rows) {
      const leaseId = randomUUID();
      const leaseAte = new Date(now.getTime() + this.recoveryLeaseMs);
      const result = await this.prisma.nfeXmlRecuperacao.updateMany({
        where: { id: row.id, OR: [{ leaseAte: null }, { leaseAte: { lt: now } }] },
        data: { leaseId, leaseAte, ultimaTentativaEm: now, tentativas: { increment: 1 } }
      });
      if (result.count === 1) claimed.push({ id: row.id, leaseId });
    }
    return claimed;
  }

  async prepareAutomaticRecovery(taskId: string, leaseId: string): Promise<AutomaticRecoveryPreparation> {
    const task = await this.prisma.nfeXmlRecuperacao.findFirst({
      where: { id: taskId, leaseId },
      include: {
        configuracao: true,
        nfeDocumento: {
          include: {
            estabelecimento: { select: { id: true, clienteId: true, cnpj: true, ativo: true } },
            vinculos: { include: { estabelecimento: { select: { id: true, clienteId: true, cnpj: true, ativo: true } } } }
          }
        }
      }
    });
    if (!task) return { canQuery: false, status: 'lease_expirada' };
    const storedDocument = task.nfeDocumento as typeof task.nfeDocumento & { vinculos?: Array<any> };
    const taskClienteId = task.clienteId ?? task.configuracao.clienteId ?? storedDocument.clienteId;
    const taskEstabelecimentoId = task.estabelecimentoId ?? task.configuracao.estabelecimentoId ?? storedDocument.estabelecimentoId;
    const scopedLink = storedDocument.vinculos?.find((item) =>
      item.clienteId === taskClienteId && item.estabelecimentoId === taskEstabelecimentoId
    );
    if (!scopedLink && storedDocument.clienteId !== taskClienteId) {
      await this.updateRecoveryTask(taskId, leaseId, {
        status: 'erro_processamento', resultadoConsulta: 'vinculo_cliente_ausente', proximaTentativaEm: null
      });
      return { canQuery: false, status: 'erro_processamento' };
    }
    const document = scopedLink ? {
      ...storedDocument,
      clienteId: scopedLink.clienteId,
      estabelecimentoId: scopedLink.estabelecimentoId,
      tipoRelacao: scopedLink.tipoRelacao ?? storedDocument.tipoRelacao,
      estabelecimento: scopedLink.estabelecimento
    } : storedDocument;
    if (document.xmlCompletoDisponivel) {
      await this.updateRecoveryTask(taskId, leaseId, { status: 'xml_disponivel', resultadoConsulta: 'xml_completo', proximaTentativaEm: null });
      return { canQuery: false, status: 'xml_disponivel' };
    }
    if (document.tipoRelacao !== 'recebida' || !document.resumoDisponivel) {
      return { canQuery: false, status: 'configuracao_desativada' };
    }
    if (!document.estabelecimento.ativo || document.estabelecimento.clienteId !== document.clienteId) {
      await this.updateRecoveryTask(taskId, leaseId, { status: 'erro_processamento', resultadoConsulta: 'estabelecimento_fora_do_escopo', proximaTentativaEm: null });
      return { canQuery: false, status: 'erro_processamento' };
    }

    const attempts = await this.prisma.nfeManifestacao.findMany({ where: { nfeDocumentoId: document.id }, orderBy: { createdAt: 'asc' } });
    const importedEvents = await this.loadImportedManifestations(document.id);
    if ([...attempts, ...importedEvents].some((item) => INDETERMINATE_STATUSES.has(item.status))) {
      await this.updateRecoveryTask(taskId, leaseId, { status: 'resultado_indeterminado', resultadoConsulta: 'manifestacao_indeterminada', proximaTentativaEm: null });
      return { canQuery: false, status: 'resultado_indeterminado' };
    }
    const acceptedScience = [...attempts, ...importedEvents].some((item) => item.tipoEvento === SCIENCE_CODE && item.status === 'registrada');
    const acceptedConclusive = [...attempts, ...importedEvents].some((item) => FINAL_CODES.has(item.tipoEvento) && TERMINAL_ACCEPTED_STATUSES.has(item.status));
    const scienceWithoutLink = [...attempts, ...importedEvents].some((item) => item.tipoEvento === SCIENCE_CODE && item.status === 'registrada_sem_vinculo');
    if (scienceWithoutLink && !acceptedScience && !acceptedConclusive) {
      await this.updateRecoveryTask(taskId, leaseId, {
        status: 'aguardando_evento_distribuicao',
        resultadoConsulta: 'ciencia_sem_vinculo',
        proximaTentativaEm: new Date(Date.now() + this.recoveryRetryMs)
      });
      return { canQuery: false, status: 'aguardando_evento_distribuicao' };
    }
    if (!acceptedScience && !acceptedConclusive) {
      if (!task.configuracao.autorizacaoAtiva || !task.configuracao.cienciaAutomatica) {
        await this.updateRecoveryTask(taskId, leaseId, {
          status: 'aguardando_ciencia',
          resultadoConsulta: 'autorizacao_ciencia_ausente',
          xMotivo: 'Aguardando autorização expressa de Ciência da Operação para este estabelecimento e ambiente. Nenhum evento foi enviado.',
          proximaTentativaEm: null
        });
        return { canQuery: false, status: 'aguardando_ciencia' };
      }
      const result = await this.registerAutomaticScience(document, task.configuracao.usuarioAutorizouId, task.configuracao.autorizadaEm);
      if (result.status !== 'registrada') {
        const status = CERTIFICATE_RECOVERY_STATUS_SET.has(result.status)
          ? result.status
          : result.status === 'resultado_indeterminado'
          ? 'resultado_indeterminado'
          : result.status === 'registrada_sem_vinculo'
            ? 'aguardando_evento_distribuicao'
            : result.status === 'falha_local' && /certificado/i.test(result.xMotivo || '')
              ? 'certificado_pendente'
              : result.status === 'falha_local' && /prazo oficial de 10 dias/i.test(result.xMotivo || '')
                ? 'ciencia_fora_prazo'
                : result.status === 'falha_local' && /cSitNFe 1/i.test(result.xMotivo || '')
                  ? 'resumo_nao_autorizado'
                : result.status === 'falha_local' && /autorizacao.*(?:revogada|inativa|desativada)/i.test(result.xMotivo || '')
                  ? 'autorizacao_revogada'
                : result.status === 'falha_local'
                  ? 'erro_processamento'
                  : 'manifestacao_rejeitada';
        await this.updateRecoveryTask(taskId, leaseId, {
          status,
          cStat: result.cStat,
          xMotivo: result.xMotivo,
          resultadoConsulta: result.status,
          proximaTentativaEm: status === 'aguardando_evento_distribuicao' || CERTIFICATE_RECOVERY_STATUS_SET.has(status)
            ? new Date(Date.now() + this.recoveryRetryMs)
            : null
        });
        return { canQuery: false, status };
      }
    }
    if (!task.configuracao.recuperacaoXmlAutomatica) {
      await this.updateRecoveryTask(taskId, leaseId, { status: 'ciencia_registrada', resultadoConsulta: 'xml_automatico_desativado', proximaTentativaEm: null });
      return { canQuery: false, status: 'ciencia_registrada' };
    }
    return {
      canQuery: true,
      status: 'aguardando_xml',
      clienteId: document.clienteId,
      estabelecimentoId: document.estabelecimentoId,
      actorType: this.onlyDigits(document.estabelecimento.cnpj).length === 11 ? 'CPF' : 'CNPJ',
      ambiente: document.ambiente,
      chaveAcesso: document.chaveAcesso
    };
  }

  async recordAutomaticRecoveryResult(taskId: string, leaseId: string, result: {
    status: 'xml_disponivel' | 'aguardando_xml' | 'aguardando_sefaz' | 'erro_processamento';
    cStat?: string | null;
    xMotivo?: string | null;
    resultadoConsulta: string;
    retryAfterMs?: number | null;
  }) {
    const nextAttempt = result.retryAfterMs == null ? null : new Date(Date.now() + result.retryAfterMs);
    await this.updateRecoveryTask(taskId, leaseId, {
      status: result.status,
      cStat: result.cStat ?? null,
      xMotivo: this.sanitizeSefazText(result.xMotivo),
      resultadoConsulta: result.resultadoConsulta,
      proximaTentativaEm: nextAttempt,
      leaseId: null,
      leaseAte: null
    });
  }

  async releaseRecoveryTask(taskId: string, leaseId: string) {
    await this.prisma.nfeXmlRecuperacao.updateMany({ where: { id: taskId, leaseId }, data: { leaseId: null, leaseAte: null } });
  }

  async logAutomaticRecoveryDiagnostic(params: {
    ambiente: NfeAmbiente;
    actorType: 'CPF' | 'CNPJ';
    httpStatus: number | null;
    cStat: string | null;
    xMotivo: string | null;
    documentsReceived: number;
    schemas: string[];
    result: string;
  }) {
    this.logger.log(JSON.stringify({
      tipoConsulta: 'consChNFe_automatica',
      ambiente: params.ambiente,
      actorType: params.actorType,
      httpStatus: params.httpStatus,
      cStat: params.cStat,
      xMotivo: this.sanitizeSefazText(params.xMotivo),
      documentosRecebidos: params.documentsReceived,
      schemas: params.schemas,
      resultado: params.result
    }));
  }

  async getHistory(documentId: string, clienteId: string) {
    const document = await this.getDocumentOrThrow(documentId, clienteId);
    const history = await this.prisma.nfeManifestacao.findMany({
      where: { nfeDocumentoId: document.id, clienteId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tipoEvento: true,
        nSeqEvento: true,
        ambiente: true,
        certificadoId: true,
        cpfCnpjDestinatario: true,
        usuarioId: true,
        status: true,
        cStat: true,
        xMotivo: true,
        nProt: true,
        cStatLote: true,
        xMotivoLote: true,
        httpStatus: true,
        justificativa: true,
        autorizacaoExpressaEm: true,
        enviadoEm: true,
        processadoEm: true,
        createdAt: true
      }
    });
    const importedEvents = await this.loadImportedManifestations(document.id);
    const officialEvents = importedEvents.map((item) => ({
        id: item.id,
        tipoEvento: item.tipoEvento,
        nSeqEvento: item.nSeqEvento,
        ambiente: document.ambiente,
        status: item.status,
        cStat: item.cStat,
        xMotivo: item.xMotivo,
        nProt: null,
        justificativa: null,
        autorizacaoExpressaEm: null,
        enviadoEm: item.dataEvento,
        processadoEm: item.dataEvento,
        createdAt: item.createdAt,
        origem: 'distribuicao'
      }));
    const appHistory = history.map((item) => ({ ...item, origem: 'notasync' }));
    const mergedHistory = [...appHistory, ...officialEvents]
      .sort((a, b) => new Date(a.processadoEm || a.createdAt || 0).getTime() - new Date(b.processadoEm || b.createdAt || 0).getTime());
    const hasAcceptedManifestation = mergedHistory.some((item) => item.status === 'registrada');
    const hasAcceptedScience = mergedHistory.some((item) => item.tipoEvento === SCIENCE_CODE && item.status === 'registrada');
    const hasAcceptedFinal = mergedHistory.some((item) => FINAL_CODES.has(item.tipoEvento) && item.status === 'registrada');
    const authorizedAt = document.dataAutorizacao ?? document.dataEmissao;
    const conclusiveDeadline = authorizedAt ? new Date(authorizedAt.getTime() + 90 * 24 * 60 * 60 * 1000) : null;
    const status = document.xmlCompletoDisponivel
      ? 'xml_completo_disponivel'
      : hasAcceptedManifestation
        ? 'aguardando_disponibilizacao'
        : document.resumoDisponivel
          ? 'resumo_disponivel'
          : 'sem_xml';

    return {
      documentoId: document.id,
      clienteId: document.clienteId,
      estabelecimentoId: document.estabelecimentoId,
      chaveAcesso: document.chaveAcesso,
      status,
      modelo: document.modelo,
      tipoRelacao: document.tipoRelacao,
      resumoDisponivel: document.resumoDisponivel,
      xmlCompletoDisponivel: document.xmlCompletoDisponivel,
      manifestacaoConclusivaPendente: hasAcceptedScience && !hasAcceptedFinal && Boolean(conclusiveDeadline),
      prazoManifestacaoConclusiva: hasAcceptedScience && !hasAcceptedFinal ? conclusiveDeadline : null,
      historico: mergedHistory.map((item) => ({ ...item, xMotivo: this.sanitizeSefazText(item.xMotivo) }))
    };
  }

  async reconcileImportedManifestations(documentId: string, clienteId: string) {
    const document = await this.getDocumentOrThrow(documentId, clienteId);
    const attempts = await this.prisma.nfeManifestacao.findMany({
      where: { nfeDocumentoId: document.id, clienteId: document.clienteId, status: { in: ['resultado_indeterminado', 'enviando'] } },
      orderBy: { createdAt: 'asc' }
    });
    const staleBefore = Date.now() - STALE_MANIFESTATION_ATTEMPT_MS;
    for (const attempt of attempts) {
      if (attempt.status !== 'enviando') continue;
      const sentAt = attempt.enviadoEm ?? attempt.createdAt;
      if (!sentAt || sentAt.getTime() > staleBefore) continue;
      const staleUpdate = await this.prisma.nfeManifestacao.updateMany({
        where: { id: attempt.id, status: 'enviando' },
        data: {
          status: 'resultado_indeterminado',
          xMotivo: 'O processo foi interrompido antes de confirmar o retorno. Consulte os eventos oficiais antes de qualquer reenvio.',
          processadoEm: new Date()
        }
      });
      if (staleUpdate.count === 1) attempt.status = 'resultado_indeterminado';
    }
    const importedEvents = await this.loadImportedManifestations(document.id);
    const reconciled: Array<{ tipoEvento: string; status: string; cStat: string | null; nProt: string | null }> = [];

    for (const attempt of attempts) {
      const officialEvent = importedEvents.find((event) =>
        event.tipoEvento === attempt.tipoEvento &&
        ['registrada', 'registrada_sem_vinculo'].includes(event.status) &&
        (event.nSeqEvento === attempt.nSeqEvento || (event.nSeqEvento == null && attempt.tipoEvento === SCIENCE_CODE))
      );
      if (!officialEvent) continue;

      const status = officialEvent.status as 'registrada' | 'registrada_sem_vinculo';
      await this.prisma.nfeManifestacao.update({
        where: { id: attempt.id },
        data: {
          status,
          cStat: officialEvent.cStat,
          xMotivo: this.sanitizeSefazText(officialEvent.xMotivo),
          nProt: officialEvent.nProt,
          processadoEm: officialEvent.dataEvento ?? new Date()
        }
      });
      attempt.status = status;
      const recoveryStatus = status === 'registrada' ? 'aguardando_xml' : 'aguardando_evento_distribuicao';
      await this.prisma.nfeXmlRecuperacao.updateMany({
        where: {
          nfeDocumentoId: document.id,
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          status: 'resultado_indeterminado'
        },
        data: {
          status: recoveryStatus,
          cStat: officialEvent.cStat,
          xMotivo: this.sanitizeSefazText(officialEvent.xMotivo),
          resultadoConsulta: 'ciencia_reconciliada',
          proximaTentativaEm: status === 'registrada' ? new Date() : new Date(Date.now() + this.recoveryRetryMs),
          leaseId: null,
          leaseAte: null
        }
      });
      reconciled.push({ tipoEvento: attempt.tipoEvento, status, cStat: officialEvent.cStat, nProt: officialEvent.nProt });
    }

    const cienciaIndeterminadaPendente = attempts.some((item) =>
      item.tipoEvento === SCIENCE_CODE && item.status === 'resultado_indeterminado'
    ) && !importedEvents.some((item) => item.tipoEvento === SCIENCE_CODE);

    return {
      documentoId: document.id,
      tentativasReconciliadas: reconciled.length,
      eventos: reconciled,
      cienciaIndeterminadaPendente,
      xmlCompletoDisponivel: document.xmlCompletoDisponivel,
      proximaAcao: reconciled.some((item) => item.cStat === '135')
        ? 'A Ciência foi confirmada na distribuição; aguarde a consulta agendada do XML por chave.'
        : reconciled.some((item) => item.cStat === '136')
          ? 'O evento foi confirmado sem vínculo; aguarde sua distribuição e consulte novamente os eventos.'
          : cienciaIndeterminadaPendente
            ? 'Nenhum evento correspondente foi localizado. Confira o portal oficial; se a Ciência estiver ausente, autorize o reenvio manual nesta tela.'
            : 'Nenhum evento correspondente foi encontrado na distribuição. Confira o portal oficial antes de autorizar qualquer reenvio.'
    };
  }

  async registrar(documentId: string, dto: RegistrarNfeManifestacaoDto, usuarioId?: string) {
    if (process.env.NFE_DISTRIBUICAO_CLIENT_MODE !== 'real') {
      throw new BadRequestException('Manifestacao exige o cliente real da SEFAZ. Nenhum evento foi enviado.');
    }
    if (dto.confirmacaoExpressa !== true) {
      throw new BadRequestException('A autorizacao expressa do usuario e obrigatoria.');
    }
    if (dto.tipo === 'operacao_nao_realizada' && !dto.justificativa?.trim()) {
      throw new BadRequestException('Informe a justificativa de Operacao nao Realizada.');
    }

    const document = await this.getDocumentOrThrow(documentId, dto.clienteId);
    this.assertManifestationEligible(document);
    const actor = this.onlyDigits(document.estabelecimento.cnpj);
    if (actor.length !== 11 && actor.length !== 14) {
      throw new BadRequestException('A identidade do estabelecimento nao e um CPF/CNPJ valido para manifestacao.');
    }

    const certificate = await this.findCertificate(document.clienteId, document.estabelecimentoId, actor);
    if (!certificate || !(await this.storage.hasObject(certificate.arquivoCriptografadoPath))) {
      throw new BadRequestException('Nao existe certificado ativo, valido e vinculado a identidade do estabelecimento para este evento.');
    }

    const priorByRequestId = await this.prisma.nfeManifestacao.findUnique({ where: { requestId: dto.requestId } });
    if (priorByRequestId) {
      if (priorByRequestId.nfeDocumentoId !== document.id || priorByRequestId.clienteId !== document.clienteId) {
        throw new ConflictException('O identificador desta autorizacao ja foi usado em outro documento.');
      }
      return this.toPublicResult(priorByRequestId);
    }

    const code = NFE_MANIFESTACAO_EVENT_CODES[dto.tipo];
    const existingAttempts = await this.prisma.nfeManifestacao.findMany({
      where: { nfeDocumentoId: document.id },
      orderBy: { createdAt: 'asc' }
    });
    const importedEvents = await this.loadImportedManifestations(document.id);
    const retryIndeterminateScience = dto.reenvioResultadoIndeterminadoConfirmado === true;
    if (retryIndeterminateScience && dto.tipo !== 'ciencia_operacao') {
      throw new BadRequestException('A confirmacao de reenvio indeterminado so pode ser usada para Ciencia da Operacao.');
    }
    const indeterminateScienceExists = [
      ...existingAttempts,
      ...importedEvents
    ].some((item) => item.tipoEvento === SCIENCE_CODE && item.status === 'resultado_indeterminado');
    const indeterminateOtherEventExists = [
      ...existingAttempts,
      ...importedEvents
    ].some((item) => item.tipoEvento !== SCIENCE_CODE && item.status === 'resultado_indeterminado');
    if (retryIndeterminateScience && !indeterminateScienceExists) {
      throw new BadRequestException('Nao existe tentativa de Ciencia com resultado indeterminado para confirmar o reenvio.');
    }
    if (retryIndeterminateScience && importedEvents.some((item) => item.tipoEvento === SCIENCE_CODE)) {
      throw new ConflictException('Existe evento de Ciência importado da distribuição oficial. Reconcilie esse evento antes de qualquer reenvio.');
    }
    if (indeterminateOtherEventExists) {
      throw new ConflictException('Existe evento de manifestação distribuído cujo resultado não pôde ser confirmado. Verifique-o no portal oficial antes de enviar outro evento.');
    }
    if (!retryIndeterminateScience && importedEvents.some((item) => item.status === 'resultado_indeterminado')) {
      throw new ConflictException('Existe evento de manifestação distribuído cujo resultado não pôde ser confirmado. Verifique-o no portal oficial antes de enviar outro evento.');
    }
    this.assertNoManifestationInProgress(existingAttempts, retryIndeterminateScience);

    const acceptedAttempts = existingAttempts.filter((item) => TERMINAL_ACCEPTED_STATUSES.has(item.status));
    const acceptedImportedEvents = importedEvents.filter((item) => TERMINAL_ACCEPTED_STATUSES.has(item.status));
    const acceptedFinalCount = Array.from(FINAL_CODES).reduce((total, eventCode) => {
      const appCount = acceptedAttempts.filter((item) => item.tipoEvento === eventCode).reduce((max, item) => Math.max(max, item.nSeqEvento), 0);
      const importedCount = acceptedImportedEvents.filter((item) => item.tipoEvento === eventCode).reduce((max, item) => Math.max(max, item.nSeqEvento ?? 1), 0);
      return total + Math.max(appCount, importedCount);
    }, 0);
    const hasFinal = acceptedFinalCount > 0;

    if (dto.tipo === 'ciencia_operacao' && (hasFinal || acceptedAttempts.some((item) => item.tipoEvento === SCIENCE_CODE) || acceptedImportedEvents.some((item) => item.tipoEvento === SCIENCE_CODE))) {
      throw new BadRequestException('A Ciencia nao pode ser duplicada nem registrada depois de uma manifestacao conclusiva.');
    }
    if (FINAL_CODES.has(code) && acceptedFinalCount >= 2) {
      throw new BadRequestException('A manifestacao conclusiva ja usou o limite de dois registros permitido para a NF-e.');
    }
    if (FINAL_CODES.has(code) && hasFinal && dto.retificarConclusiva !== true) {
      throw new BadRequestException('Ja existe manifestacao conclusiva. Marque explicitamente a opcao de retificacao antes de enviar.');
    }
    if (dto.tipo === 'ciencia_operacao' && /cancelad|denegad/i.test(document.status || '')) {
      throw new BadRequestException('A Ciencia nao pode ser registrada para NF-e cancelada ou denegada.');
    }
    if (FINAL_CODES.has(code)) {
      this.assertConclusiveDeadline(document.dataAutorizacao ?? document.dataEmissao);
    }

    const appSequence = acceptedAttempts.filter((item) => item.tipoEvento === code).reduce((max, item) => Math.max(max, item.nSeqEvento), 0);
    const importedSequence = acceptedImportedEvents.filter((item) => item.tipoEvento === code).reduce((max, item) => Math.max(max, item.nSeqEvento ?? 1), 0);
    const sequence = Math.max(appSequence, importedSequence) + 1;
    if (sequence > 2) {
      throw new BadRequestException('O limite oficial de sequencia para este tipo de evento foi atingido.');
    }

    const requestedAt = new Date();
    let attempt;
    try {
      attempt = await this.prisma.nfeManifestacao.create({
        data: {
          nfeDocumentoId: document.id,
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          certificadoId: certificate.id,
          cpfCnpjDestinatario: actor,
          usuarioId: usuarioId || undefined,
          requestId: dto.requestId,
          tipoEvento: code,
          nSeqEvento: sequence,
          ambiente: document.ambiente,
          status: 'enviando',
          justificativa: dto.tipo === 'operacao_nao_realizada' ? dto.justificativa!.trim() : null,
          autorizacaoExpressaEm: requestedAt,
          enviadoEm: requestedAt
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Ja existe um envio deste evento em andamento ou com resultado ainda nao confirmado.');
      }
      throw error;
    }

    let response: NfeManifestacaoResult;
    try {
      response = await this.manifestacaoClient.sendManifestacao({
        cnpjConsulta: actor,
        chaveAcesso: document.chaveAcesso,
        tipo: dto.tipo,
        sequencia: sequence,
        justificativa: dto.tipo === 'operacao_nao_realizada' ? dto.justificativa!.trim() : undefined,
        ambiente: document.ambiente,
        certificateId: certificate.id
      });
    } catch (error) {
      const message = this.toSafeErrorMessage(error);
      const status: ManifestationStatus = error instanceof NfeManifestacaoClientError && !error.requestMayHaveBeenSent
        ? 'falha_local'
        : 'resultado_indeterminado';
      const clientError = error instanceof NfeManifestacaoClientError ? error : null;
      const artifacts = await this.persistManifestationArtifacts(
        attempt.id,
        clientError?.signedEventXml,
        clientError?.responseXml
      );
      const updated = await this.prisma.nfeManifestacao.update({
        where: { id: attempt.id },
        data: {
          status,
          xMotivo: artifacts.error ? `${message} Artefatos fiscais nao puderam ser arquivados.` : message,
          xmlEventoAssinadoPath: artifacts.xmlEventoAssinadoPath,
          xmlRetornoPath: artifacts.xmlRetornoPath,
          processadoEm: new Date()
        }
      });
      this.logSafeResult(dto.tipo, document.ambiente, null, null, null, status, message);
      return { ...this.toPublicResult(updated), artefatosSalvos: !artifacts.error };
    }

    const accepted = response.statusCode === 200 && response.cStat === '128' && ['135', '136'].includes(response.eventCStat || '');
    const duplicateNeedsReconciliation = response.eventCStat === '573';
    const status: ManifestationStatus = duplicateNeedsReconciliation
      ? 'resultado_indeterminado'
      : accepted
        ? response.eventCStat === '135' ? 'registrada' : 'registrada_sem_vinculo'
        : 'rejeitada';
    const artifacts = await this.persistManifestationArtifacts(attempt.id, response.signedEventXml, response.responseXml);
    const eventReason = this.sanitizeSefazText(response.eventXMotivo ?? response.xMotivo);
    const updated = await this.prisma.nfeManifestacao.update({
      where: { id: attempt.id },
      data: {
        status,
        cStat: response.eventCStat ?? response.cStat,
        xMotivo: artifacts.error
          ? `${eventReason ?? 'Retorno recebido da SEFAZ.'} Artefatos fiscais nao puderam ser arquivados.`
          : eventReason,
        nProt: response.nProt,
        cStatLote: response.cStat,
        xMotivoLote: this.sanitizeSefazText(response.xMotivo),
        httpStatus: response.statusCode,
        xmlEventoAssinadoPath: artifacts.xmlEventoAssinadoPath,
        xmlRetornoPath: artifacts.xmlRetornoPath,
        processadoEm: new Date()
      }
    });

    let recuperacao: {
      status: string;
      proximaTentativaEm: Date | null;
      xmlCompletoDisponivel: boolean;
      proximaAcao: string;
    } | null = null;
    if (dto.tipo === 'ciencia_operacao' && (accepted || duplicateNeedsReconciliation)) {
      try {
        recuperacao = await this.scheduleManualScienceRecovery(document, response.eventCStat, eventReason);
      } catch {
        recuperacao = {
          status: 'falha_ao_enfileirar',
          proximaTentativaEm: null,
          xmlCompletoDisponivel: document.xmlCompletoDisponivel,
          proximaAcao: 'O evento foi registrado no historico. A fila de recuperacao nao foi atualizada; verifique as pendencias administrativas antes de repetir qualquer envio.'
        };
      }
    } else if (accepted && FINAL_CODES.has(code)) {
      await this.scheduleXmlRecovery(document.id, document.clienteId, document.estabelecimentoId);
    }

    this.logSafeResult(dto.tipo, document.ambiente, response.statusCode, response.cStat, response.eventCStat, status, response.eventXMotivo ?? response.xMotivo);
    return {
      ...this.toPublicResult(updated),
      artefatosSalvos: !artifacts.error,
      ...(recuperacao ? { recuperacao } : {})
    };
  }

  private async registerAutomaticScience(
    source: Awaited<ReturnType<NfeManifestacaoService['getDocumentOrThrow']>>,
    authorizedById: string | null,
    authorizedAt: Date | null
  ): Promise<{ status: string; cStat: string | null; xMotivo: string | null }> {
    if (process.env.NFE_DISTRIBUICAO_CLIENT_MODE !== 'real') {
      return { status: 'falha_local', cStat: null, xMotivo: 'O cliente real da SEFAZ nao esta ativo.' };
    }
    const document = await this.getDocumentOrThrow(source.id, source.clienteId);
    try {
      this.assertManifestationEligible(document);
    } catch (error) {
      return { status: 'falha_local', cStat: null, xMotivo: this.toSafeErrorMessage(error) };
    }
    const actor = this.onlyDigits(document.estabelecimento.cnpj);
    const certificateResolution = await this.resolveCertificate(document.clienteId, document.estabelecimentoId, actor);
    if (!certificateResolution.certificate) {
      return { status: certificateResolution.status, cStat: null, xMotivo: certificateResolution.reason };
    }
    const certificate = certificateResolution.certificate;
    try {
      this.assertScienceDeadline(document.dataAutorizacao ?? document.dataEmissao);
    } catch (error) {
      return { status: 'falha_local', cStat: null, xMotivo: this.toSafeErrorMessage(error) };
    }
    const priorEvents = await this.loadImportedManifestations(document.id);
    const priorAttempts = await this.prisma.nfeManifestacao.findMany({ where: { nfeDocumentoId: document.id }, orderBy: { createdAt: 'asc' } });
    if ([...priorEvents, ...priorAttempts].some((item) => INDETERMINATE_STATUSES.has(item.status))) {
      return { status: 'resultado_indeterminado', cStat: null, xMotivo: 'Existe uma manifestacao anterior com resultado nao confirmado; a automacao nao repetiu o evento.' };
    }
    if ([...priorEvents, ...priorAttempts].some((item) => FINAL_CODES.has(item.tipoEvento) && TERMINAL_ACCEPTED_STATUSES.has(item.status))) {
      return { status: 'falha_local', cStat: null, xMotivo: 'Ja existe manifestacao conclusiva; a Ciencia automatica nao foi enviada.' };
    }
    const priorScience = [...priorEvents, ...priorAttempts]
      .filter((item) => item.tipoEvento === SCIENCE_CODE)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    if (priorScience) {
      if (priorScience.status === 'registrada') return { status: 'registrada', cStat: priorScience.cStat, xMotivo: priorScience.xMotivo };
      if (priorScience.status === 'registrada_sem_vinculo') return { status: 'registrada_sem_vinculo', cStat: priorScience.cStat, xMotivo: priorScience.xMotivo };
      if (priorScience.status === 'falha_local') {
        // falha_local means the client proved that no request was sent; it is safe to retry after local remediation.
      } else {
        return { status: priorScience.status, cStat: priorScience.cStat ?? null, xMotivo: priorScience.xMotivo ?? null };
      }
    }

    const currentAuthorization = await this.prisma.nfeAutomacaoConfiguracao.findUnique({
      where: {
        clienteId_estabelecimentoId_ambiente: {
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          ambiente: document.ambiente
        }
      },
      select: { cienciaAutomatica: true, autorizacaoAtiva: true }
    });
    if (!currentAuthorization?.cienciaAutomatica || !currentAuthorization.autorizacaoAtiva) {
      return { status: 'falha_local', cStat: null, xMotivo: 'A autorizacao da automacao foi revogada ou desativada antes do envio.' };
    }

    const requestedAt = new Date();
    let attempt;
    try {
      attempt = await this.prisma.nfeManifestacao.create({
        data: {
          nfeDocumentoId: document.id,
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          certificadoId: certificate.id,
          usuarioId: authorizedById || undefined,
          requestId: randomUUID(),
          tipoEvento: SCIENCE_CODE,
          nSeqEvento: 1,
          ambiente: document.ambiente,
          status: 'enviando',
          justificativa: null,
          autorizacaoExpressaEm: authorizedAt ?? requestedAt,
          enviadoEm: requestedAt
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const previous = await this.prisma.nfeManifestacao.findMany({ where: { nfeDocumentoId: document.id, tipoEvento: SCIENCE_CODE }, orderBy: { createdAt: 'desc' } });
        const latest = previous[0];
        return { status: latest?.status ?? 'resultado_indeterminado', cStat: latest?.cStat ?? null, xMotivo: this.sanitizeSefazText(latest?.xMotivo) };
      }
      throw error;
    }
    try {
      const response = await this.manifestacaoClient.sendManifestacao({
        cnpjConsulta: actor,
        chaveAcesso: document.chaveAcesso,
        tipo: 'ciencia_operacao',
        sequencia: 1,
        ambiente: document.ambiente,
        certificateId: certificate.id
      });
      const accepted = response.statusCode === 200 && response.cStat === '128' && ['135', '136'].includes(response.eventCStat || '');
      const status = accepted ? response.eventCStat === '135' ? 'registrada' : 'registrada_sem_vinculo' : 'rejeitada';
      const updated = await this.prisma.nfeManifestacao.update({
        where: { id: attempt.id },
        data: {
          status,
          cStat: response.eventCStat ?? response.cStat,
          xMotivo: this.sanitizeSefazText(response.eventXMotivo ?? response.xMotivo),
          nProt: response.nProt,
          processadoEm: new Date()
        }
      });
      this.logSafeResult('ciencia_operacao', document.ambiente, response.statusCode, response.cStat, response.eventCStat, status, response.eventXMotivo ?? response.xMotivo);
      if (status === 'registrada') await this.scheduleXmlRecovery(document.id, document.clienteId, document.estabelecimentoId);
      return { status, cStat: updated.cStat, xMotivo: this.sanitizeSefazText(updated.xMotivo) };
    } catch (error) {
      const status = error instanceof NfeManifestacaoClientError && !error.requestMayHaveBeenSent ? 'falha_local' : 'resultado_indeterminado';
      const certificateUnavailable = error instanceof NfeManifestacaoClientError && error.failureStage === 'certificate';
      const safeMessage = certificateUnavailable
        ? 'O certificado cadastrado não pôde ser carregado ou descriptografado pelo serviço de manifestação. Verifique o arquivo protegido e a senha cadastrada; nenhum evento foi transmitido.'
        : this.toSafeErrorMessage(error);
      const updated = await this.prisma.nfeManifestacao.update({
        where: { id: attempt.id },
        data: { status, xMotivo: safeMessage, processadoEm: new Date() }
      });
      this.logSafeResult('ciencia_operacao', document.ambiente, null, null, null, status, safeMessage);
      return { status: certificateUnavailable ? 'certificado_indisponivel' : status, cStat: updated.cStat, xMotivo: safeMessage };
    }
  }

  private assertScienceDeadline(authorizedAt?: Date | null): void {
    if (!authorizedAt || Number.isNaN(authorizedAt.getTime())) {
      throw new BadRequestException('Nao foi possivel validar o prazo oficial de 10 dias da Ciencia sem a data de autorizacao da NF-e.');
    }
    if (Date.now() > authorizedAt.getTime() + 10 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('O prazo oficial de 10 dias para Ciencia da Emissao foi excedido.');
    }
  }

  private async enqueueExistingSummaries(config: {
    id: string; clienteId: string; estabelecimentoId: string; ambiente: NfeAmbiente;
    cienciaAutomatica: boolean; autorizacaoAtiva: boolean;
  }): Promise<void> {
    let cursor: string | undefined;
    while (true) {
      const documents = await this.prisma.nfeDocumento.findMany({
        where: {
          OR: [
            {
              clienteId: config.clienteId,
              estabelecimentoId: config.estabelecimentoId,
              tipoRelacao: 'recebida'
            },
            {
              vinculos: { some: {
                clienteId: config.clienteId,
                estabelecimentoId: config.estabelecimentoId,
                tipoRelacao: 'recebida'
              } }
            }
          ],
          ambiente: config.ambiente,
          modelo: '55',
          resumoDisponivel: true,
          xmlCompletoDisponivel: false,
          xmlRecuperacoes: { none: { clienteId: config.clienteId, estabelecimentoId: config.estabelecimentoId } }
        },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true }
      });
      if (documents.length === 0) break;
      await this.prisma.nfeXmlRecuperacao.createMany({
        data: documents.map((document) => ({
          nfeDocumentoId: document.id,
          clienteId: config.clienteId,
          estabelecimentoId: config.estabelecimentoId,
          configuracaoId: config.id,
          ambiente: config.ambiente,
          status: config.cienciaAutomatica && config.autorizacaoAtiva ? 'ciencia_aguardando_envio' : 'aguardando_ciencia',
          proximaTentativaEm: config.cienciaAutomatica && config.autorizacaoAtiva ? new Date() : null,
          xMotivo: config.cienciaAutomatica && config.autorizacaoAtiva
            ? null
            : 'Aguardando autorização expressa de Ciência da Operação para este estabelecimento e ambiente.'
        })),
        skipDuplicates: true
      });
      if (documents.length < 500) break;
      cursor = documents[documents.length - 1].id;
    }
  }

  private toPublicAutomationConfig(config: {
    clienteId: string; estabelecimentoId: string; ambiente: NfeAmbiente; cienciaAutomatica: boolean;
    recuperacaoXmlAutomatica: boolean; autorizacaoAtiva: boolean; autorizadaEm: Date | null;
    versaoTermo: string | null; revogadaEm: Date | null;
  }) {
    return {
      clienteId: config.clienteId,
      estabelecimentoId: config.estabelecimentoId,
      ambiente: config.ambiente,
      cienciaAutomatica: config.cienciaAutomatica,
      recuperacaoXmlAutomatica: config.recuperacaoXmlAutomatica,
      autorizacaoAtiva: config.autorizacaoAtiva,
      autorizadaEm: config.autorizadaEm,
      versaoTermo: config.versaoTermo,
      revogadaEm: config.revogadaEm
    };
  }

  private async updateRecoveryTask(id: string, leaseId: string, data: Prisma.NfeXmlRecuperacaoUpdateManyMutationInput) {
    await this.prisma.nfeXmlRecuperacao.updateMany({ where: { id, leaseId }, data });
  }

  private async scheduleXmlRecovery(documentId: string, clienteId: string, estabelecimentoId: string) {
    const task = await this.prisma.nfeXmlRecuperacao.findFirst({
      where: { nfeDocumentoId: documentId, clienteId, estabelecimentoId },
      include: { configuracao: true }
    });
    if (
      !task || task.clienteId !== clienteId || task.estabelecimentoId !== estabelecimentoId ||
      !task.configuracao.recuperacaoXmlAutomatica || task.status === 'xml_disponivel'
    ) return;
    await this.prisma.nfeXmlRecuperacao.update({
      where: { id: task.id },
      data: { status: 'aguardando_xml', resultadoConsulta: 'manifestacao_registrada', proximaTentativaEm: new Date(), cStat: null, xMotivo: null }
    });
  }

  private async persistManifestationArtifacts(
    attemptId: string,
    signedEventXml?: string | null,
    responseXml?: string | null
  ): Promise<{ xmlEventoAssinadoPath: string | null; xmlRetornoPath: string | null; error: boolean }> {
    const baseKey = `nfe/manifestacoes/${attemptId}`;
    let xmlEventoAssinadoPath: string | null = null;
    let xmlRetornoPath: string | null = null;
    let error = false;

    if (signedEventXml) {
      try {
        xmlEventoAssinadoPath = await this.storage.putObject(`${baseKey}/evento-assinado.xml`, signedEventXml);
      } catch {
        error = true;
      }
    }
    if (responseXml) {
      try {
        xmlRetornoPath = await this.storage.putObject(`${baseKey}/retorno-soap.xml`, responseXml);
      } catch {
        error = true;
      }
    }

    return { xmlEventoAssinadoPath, xmlRetornoPath, error };
  }

  private async scheduleManualScienceRecovery(
    document: Awaited<ReturnType<NfeManifestacaoService['getDocumentOrThrow']>>,
    eventCStat: string | null,
    eventReason: string | null
  ): Promise<{
    status: string;
    proximaTentativaEm: Date | null;
    xmlCompletoDisponivel: boolean;
    proximaAcao: string;
  }> {
    const config = await this.prisma.nfeAutomacaoConfiguracao.upsert({
      where: {
        clienteId_estabelecimentoId_ambiente: {
          clienteId: document.clienteId,
          estabelecimentoId: document.estabelecimentoId,
          ambiente: document.ambiente
        }
      },
      create: {
        clienteId: document.clienteId,
        estabelecimentoId: document.estabelecimentoId,
        ambiente: document.ambiente,
        cienciaAutomatica: false,
        recuperacaoXmlAutomatica: true,
        autorizacaoAtiva: false
      },
      update: { recuperacaoXmlAutomatica: true }
    });

    const now = new Date();
    const status = eventCStat === '135'
      ? 'aguardando_xml'
      : eventCStat === '136'
        ? 'aguardando_evento_distribuicao'
        : 'resultado_indeterminado';
    const proximaTentativaEm = eventCStat === '135'
      ? now
      : eventCStat === '136'
        ? new Date(now.getTime() + this.recoveryRetryMs)
        : null;
    const xMotivo = status === 'resultado_indeterminado'
      ? 'A SEFAZ retornou duplicidade (573). Consulte os eventos oficiais e confirme se a Ciência foi registrada antes de autorizar qualquer novo envio.'
      : this.sanitizeSefazText(eventReason) ?? (status === 'aguardando_xml'
        ? 'Ciência registrada e vinculada; aguardando consulta do XML completo por chave.'
        : 'Ciência registrada sem vínculo; aguardando a distribuição do evento antes da consulta do XML.');

    await this.prisma.nfeXmlRecuperacao.createMany({
      data: [{
        nfeDocumentoId: document.id,
        clienteId: document.clienteId,
        estabelecimentoId: document.estabelecimentoId,
        configuracaoId: config.id,
        ambiente: document.ambiente,
        status,
        proximaTentativaEm,
        cStat: eventCStat,
        xMotivo
      }],
      skipDuplicates: true
    });
    await this.prisma.nfeXmlRecuperacao.updateMany({
      where: { nfeDocumentoId: document.id, clienteId: document.clienteId, estabelecimentoId: document.estabelecimentoId },
      data: {
        configuracaoId: config.id,
        status,
        proximaTentativaEm,
        cStat: eventCStat,
        xMotivo,
        resultadoConsulta: eventCStat === '135'
          ? 'ciencia_registrada'
          : eventCStat === '136'
            ? 'ciencia_sem_vinculo'
            : 'ciencia_duplicada_reconciliar',
        leaseId: null,
        leaseAte: null
      }
    });

    const proximaAcao = eventCStat === '135'
      ? process.env.NFE_SYNC_AUTO_RUN_ENABLED === 'false'
        ? 'A fila foi criada, mas a rotina automática de NF-e está desligada; solicite uma consulta manual por chave ou reative a rotina para obter o XML.'
        : 'Aguardar a consulta agendada por chave. Se a SEFAZ continuar retornando o resumo, a pendência será reagendada.'
      : eventCStat === '136'
        ? 'Aguardar a distribuição do evento e conferir os eventos da NF-e; a consulta do XML só começa quando houver vínculo.'
        : 'Consultar os eventos oficiais desta NF-e para reconciliar a duplicidade. Reenvie somente se o evento não constar e houver nova autorização expressa.';

    return {
      status,
      proximaTentativaEm,
      xmlCompletoDisponivel: document.xmlCompletoDisponivel,
      proximaAcao
    };
  }

  private async getDocumentOrThrow(documentId: string, clienteId: string) {
    const document = await this.prisma.nfeDocumento.findFirst({
      where: {
        id: documentId,
        OR: [
          { clienteId },
          { vinculos: { some: { clienteId } } }
        ]
      },
      include: {
        estabelecimento: { select: { id: true, clienteId: true, cnpj: true, ativo: true } },
        vinculos: {
          where: { clienteId },
          include: { estabelecimento: { select: { id: true, clienteId: true, cnpj: true, ativo: true } } }
        }
      }
    });
    if (!document) {
      throw new NotFoundException('NF-e nao encontrada.');
    }
    const scoped = (document as typeof document & { vinculos?: Array<any> }).vinculos?.[0];
    if (!scoped && document.clienteId !== clienteId) throw new NotFoundException('NF-e nao encontrada.');
    const base = { ...(document as any) };
    delete base.vinculos;
    if (!scoped) return base;
    return {
      ...base,
      clienteId: scoped.clienteId,
      estabelecimentoId: scoped.estabelecimentoId,
      tipoRelacao: scoped.tipoRelacao ?? document.tipoRelacao,
      estabelecimento: scoped.estabelecimento
    };
  }

  private assertManifestationEligible(document: Awaited<ReturnType<NfeManifestacaoService['getDocumentOrThrow']>>): void {
    if (document.modelo !== '55') {
      throw new BadRequestException('Manifestacao do destinatario so esta habilitada para NF-e modelo 55.');
    }
    if (document.tipoRelacao !== 'recebida') {
      throw new BadRequestException('O estabelecimento ainda nao foi identificado como destinatario desta NF-e.');
    }
    if (!document.resumoDisponivel || document.xmlCompletoDisponivel) {
      throw new BadRequestException('Manifestacao disponivel somente quando existe resumo sem XML completo.');
    }
    const summaryStatus = String(document.status || '').trim();
    if (summaryStatus !== '1' && !/autorizad/i.test(summaryStatus)) {
      throw new BadRequestException('Ciencia automatica permitida somente para resNFe com cSitNFe 1 (uso autorizado).');
    }
    if (!document.estabelecimento.ativo || document.estabelecimento.clienteId !== document.clienteId) {
      throw new BadRequestException('Estabelecimento inativo ou fora do escopo do cliente.');
    }
    if (!this.isValidAccessKey(document.chaveAcesso)) {
      throw new BadRequestException('A chave armazenada da NF-e e invalida.');
    }
  }

  private async findCertificate(clienteId: string, estabelecimentoId: string, actor: string) {
    const resolution = await this.resolveCertificate(clienteId, estabelecimentoId, actor);
    return resolution.certificate;
  }

  private async resolveCertificate(clienteId: string, estabelecimentoId: string, actor: string): Promise<CertificateResolution> {
    const now = new Date();
    const certificates = await this.prisma.certificado.findMany({
      where: { OR: [{ clienteId, estabelecimentoId }, { clienteId, estabelecimentoId: null }] },
      orderBy: [{ estabelecimentoId: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, cnpjTitular: true, ativo: true, validadeFim: true, arquivoCriptografadoPath: true }
    });
    if (!certificates.length) {
      return {
        certificate: null,
        status: 'certificado_nao_cadastrado',
        reason: 'Nenhum certificado digital está cadastrado no escopo deste cliente e estabelecimento.'
      };
    }
    const matching = certificates.filter((certificate) => this.onlyDigits(certificate.cnpjTitular) === actor);
    if (!matching.length) {
      return {
        certificate: null,
        status: 'certificado_incompativel',
        reason: 'Os certificados cadastrados neste escopo não têm titular igual à identidade CPF/CNPJ do estabelecimento. Nenhum evento foi enviado.'
      };
    }
    const active = matching.filter((certificate) => certificate.ativo);
    if (!active.length) {
      return {
        certificate: null,
        status: 'certificado_inativo',
        reason: 'Há certificado com titular compatível, mas todos estão inativos. Ative ou cadastre o certificado correto.'
      };
    }
    const valid = active.filter((certificate) => !certificate.validadeFim || certificate.validadeFim > now);
    if (!valid.length) {
      return {
        certificate: null,
        status: 'certificado_expirado',
        reason: 'O certificado com titular compatível está expirado. Nenhum evento foi enviado.'
      };
    }
    let storageUnavailable = false;
    for (const certificate of valid) {
      try {
        if (await this.storage.hasObject(certificate.arquivoCriptografadoPath)) {
          return {
            certificate: { id: certificate.id, arquivoCriptografadoPath: certificate.arquivoCriptografadoPath },
            status: null,
            reason: null
          };
        }
      } catch {
        storageUnavailable = true;
      }
    }
    return {
      certificate: null,
      status: 'certificado_indisponivel',
      reason: storageUnavailable
        ? 'O armazenamento protegido do certificado não respondeu. A tarefa será reavaliada; nenhum evento foi enviado.'
        : 'O certificado ativo e válido foi localizado, mas seu arquivo não está acessível no armazenamento protegido. Restaure ou recadastre o certificado.'
    };
  }

  private async loadImportedManifestations(documentId: string): Promise<Array<{
    id: string;
    tipoEvento: string;
    dataEvento: Date | null;
    createdAt: Date;
    nSeqEvento: number | null;
    cStat: string | null;
    xMotivo: string | null;
    nProt: string | null;
    status: string;
  }>> {
    const rows = await this.prisma.nfeEvento.findMany({
      where: { nfeDocumentoId: documentId, tipoEvento: { in: Array.from(new Set(Object.values(NFE_MANIFESTACAO_EVENT_CODES))) } },
      select: { id: true, tipoEvento: true, dataEvento: true, descricao: true, xmlPath: true, createdAt: true }
    });
    return Promise.all(rows.filter((row) => row.tipoEvento).map(async (row) => {
      let response: { cStat: string | null; xMotivo: string | null; nProt: string | null; nSeqEvento: number | null } | null = null;
      if (row.xmlPath) {
        try {
          const xml = (await this.storage.getObject(row.xmlPath)).toString('utf8');
          response = this.parseImportedManifestationResponse(xml);
        } catch {
          response = null;
        }
      }
      const status = response?.cStat === '135'
        ? 'registrada'
        : response?.cStat === '136'
          ? 'registrada_sem_vinculo'
          : response?.cStat
            ? 'rejeitada'
            : 'resultado_indeterminado';
      return {
        id: row.id,
        tipoEvento: row.tipoEvento!,
        dataEvento: row.dataEvento,
        createdAt: row.createdAt,
        nSeqEvento: response?.nSeqEvento ?? null,
        cStat: response?.cStat ?? null,
        xMotivo: response?.xMotivo ?? row.descricao,
        nProt: response?.nProt ?? null,
        status
      };
    }));
  }

  private parseImportedManifestationResponse(xml: string): {
    cStat: string | null;
    xMotivo: string | null;
    nProt: string | null;
    nSeqEvento: number | null;
  } {
    const retEvento = xml.match(/<(?:\w+:)?retEvento\b[^>]*>[\s\S]*?<\/(?:\w+:)?retEvento>/i)?.[0] ?? '';
    const infEvento = retEvento.match(/<(?:\w+:)?infEvento\b[^>]*>[\s\S]*?<\/(?:\w+:)?infEvento>/i)?.[0] ?? retEvento;
    const read = (source: string, tag: string) => {
      const value = source.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'))?.[1];
      return value?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || null;
    };
    const sequence = Number(read(infEvento, 'nSeqEvento'));
    return {
      cStat: read(infEvento, 'cStat'),
      xMotivo: read(infEvento, 'xMotivo'),
      nProt: read(infEvento, 'nProt'),
      nSeqEvento: Number.isInteger(sequence) && sequence > 0 ? sequence : null
    };
  }

  private assertNoManifestationInProgress(
    attempts: Array<{ tipoEvento: string; status: string }>,
    allowConfirmedIndeterminateScience = false
  ): void {
    if (attempts.some((item) =>
      item.status === 'enviando' ||
      (item.status === 'resultado_indeterminado' && !(allowConfirmedIndeterminateScience && item.tipoEvento === SCIENCE_CODE))
    )) {
      throw new ConflictException('Existe envio de manifestação com resultado pendente. Consulte o historico oficial antes de tentar novamente.');
    }
  }

  private assertConclusiveDeadline(authorizedAt?: Date | null): void {
    if (!authorizedAt || Number.isNaN(authorizedAt.getTime())) {
      throw new BadRequestException('Nao foi possivel validar o prazo oficial sem data de autorizacao da NF-e.');
    }
    const deadline = new Date(authorizedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    if (Date.now() > deadline.getTime()) {
      throw new BadRequestException('O prazo oficial de 90 dias para manifestacao conclusiva foi excedido.');
    }
  }

  private toPublicResult(item: {
    id: string;
    tipoEvento: string;
    nSeqEvento: number;
    status: string;
    cStat: string | null;
    xMotivo: string | null;
    nProt: string | null;
    certificadoId?: string | null;
    cpfCnpjDestinatario?: string | null;
    usuarioId?: string | null;
    cStatLote?: string | null;
    xMotivoLote?: string | null;
    httpStatus?: number | null;
    autorizacaoExpressaEm: Date;
    enviadoEm: Date | null;
    processadoEm: Date | null;
  }) {
    return {
      id: item.id,
      tipoEvento: item.tipoEvento,
      nSeqEvento: item.nSeqEvento,
      status: item.status,
      cStat: item.cStat,
      xMotivo: this.sanitizeSefazText(item.xMotivo),
      nProt: item.nProt,
      certificadoId: item.certificadoId ?? null,
      cpfCnpjDestinatario: item.cpfCnpjDestinatario ?? null,
      usuarioId: item.usuarioId ?? null,
      cStatLote: item.cStatLote ?? null,
      xMotivoLote: this.sanitizeSefazText(item.xMotivoLote),
      httpStatus: item.httpStatus ?? null,
      autorizacaoExpressaEm: item.autorizacaoExpressaEm,
      enviadoEm: item.enviadoEm,
      processadoEm: item.processadoEm
    };
  }

  private sanitizeSefazText(value?: string | null): string | null {
    if (!value) return null;
    if (/-----BEGIN [^-]+-----|<\??xml\b|<[A-Za-z_:][^>]*>/i.test(value)) return '[conteudo sensivel ocultado]';
    return value
      .replace(/\b\d{44}\b/g, '[chave ocultada]')
      .replace(/\b\d{14}\b/g, '[CNPJ ocultado]')
      .replace(/\b\d{11}\b/g, '[CPF ocultado]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 255);
  }

  private toSafeErrorMessage(error: unknown): string {
    return this.sanitizeSefazText(error instanceof Error ? error.message : 'Falha sem detalhes no envio do evento.') ?? 'Falha sem detalhes no envio do evento.';
  }

  private logSafeResult(
    tipo: NfeManifestacaoTipo,
    ambiente: NfeAmbiente,
    httpStatus: number | null,
    cStat: string | null,
    eventCStat: string | null,
    status: string,
    xMotivo?: string | null
  ): void {
    this.logger.log(JSON.stringify({
      tipoConsulta: 'manifestacao',
      tipoEvento: tipo,
      ambiente,
      httpStatus,
      cStat,
      eventCStat,
      xMotivo: this.sanitizeSefazText(xMotivo),
      resultado: status
    }));
  }

  private onlyDigits(value: string): string {
    return String(value || '').replace(/\D/g, '');
  }

  private isValidAccessKey(value: string): boolean {
    if (!/^\d{44}$/.test(value)) return false;
    let sum = 0;
    let weight = 2;
    for (let index = 42; index >= 0; index -= 1) {
      sum += Number(value[index]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    const expected = remainder <= 1 ? 0 : 11 - remainder;
    return Number(value[43]) === expected;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
