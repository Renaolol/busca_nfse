import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NfeAmbiente, Prisma } from '@prisma/client';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NFE_MANIFESTACAO_CLIENT,
  NFE_MANIFESTACAO_EVENT_CODES,
  NfeManifestacaoClient,
  NfeManifestacaoClientError,
  NfeManifestacaoTipo
} from '../../integrations/nfe-distribuicao/nfe-manifestacao.types';
import { RegistrarNfeManifestacaoDto } from './dto/registrar-manifestacao.dto';

const SCIENCE_CODE = NFE_MANIFESTACAO_EVENT_CODES.ciencia_operacao;
const FINAL_CODES = new Set([
  NFE_MANIFESTACAO_EVENT_CODES.confirmacao_operacao,
  NFE_MANIFESTACAO_EVENT_CODES.desconhecimento_operacao,
  NFE_MANIFESTACAO_EVENT_CODES.operacao_nao_realizada
]);
const TERMINAL_ACCEPTED_STATUSES = new Set(['registrada', 'registrada_sem_vinculo']);
const INDETERMINATE_STATUSES = new Set(['enviando', 'resultado_indeterminado']);

type ManifestationStatus = 'registrada' | 'registrada_sem_vinculo' | 'rejeitada' | 'falha_local' | 'resultado_indeterminado' | 'enviando';

@Injectable()
export class NfeManifestacaoService {
  private readonly logger = new Logger(NfeManifestacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    @Inject(NFE_MANIFESTACAO_CLIENT) private readonly manifestacaoClient: NfeManifestacaoClient
  ) {}

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
        status: true,
        cStat: true,
        xMotivo: true,
        nProt: true,
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
    const status = document.xmlCompletoDisponivel
      ? 'xml_completo_disponivel'
      : hasAcceptedManifestation
        ? 'aguardando_disponibilizacao'
        : document.resumoDisponivel
          ? 'resumo_disponivel'
          : 'sem_xml';

    return {
      documentoId: document.id,
      status,
      modelo: document.modelo,
      tipoRelacao: document.tipoRelacao,
      resumoDisponivel: document.resumoDisponivel,
      xmlCompletoDisponivel: document.xmlCompletoDisponivel,
      historico: mergedHistory.map((item) => ({ ...item, xMotivo: this.sanitizeSefazText(item.xMotivo) }))
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
    if (importedEvents.some((item) => item.status === 'resultado_indeterminado')) {
      throw new ConflictException('Existe evento de manifestação distribuído cujo resultado não pôde ser confirmado. Verifique-o no portal oficial antes de enviar outro evento.');
    }
    this.assertNoManifestationInProgress(existingAttempts);

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

    try {
      const response = await this.manifestacaoClient.sendManifestacao({
        cnpjConsulta: actor,
        chaveAcesso: document.chaveAcesso,
        tipo: dto.tipo,
        sequencia: sequence,
        justificativa: dto.tipo === 'operacao_nao_realizada' ? dto.justificativa!.trim() : undefined,
        ambiente: document.ambiente,
        certificateId: certificate.id
      });
      const accepted = response.statusCode === 200 && response.cStat === '128' && ['135', '136'].includes(response.eventCStat || '');
      const status: ManifestationStatus = accepted
        ? response.eventCStat === '135' ? 'registrada' : 'registrada_sem_vinculo'
        : 'rejeitada';
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
      this.logSafeResult(dto.tipo, document.ambiente, response.statusCode, response.cStat, response.eventCStat, status, response.eventXMotivo ?? response.xMotivo);
      return this.toPublicResult(updated);
    } catch (error) {
      const message = this.toSafeErrorMessage(error);
      const status: ManifestationStatus = error instanceof NfeManifestacaoClientError && !error.requestMayHaveBeenSent
        ? 'falha_local'
        : 'resultado_indeterminado';
      const updated = await this.prisma.nfeManifestacao.update({
        where: { id: attempt.id },
        data: {
          status,
          xMotivo: message,
          processadoEm: new Date()
        }
      });
      this.logSafeResult(dto.tipo, document.ambiente, null, null, null, status, message);
      return this.toPublicResult(updated);
    }
  }

  private async getDocumentOrThrow(documentId: string, clienteId: string) {
    const document = await this.prisma.nfeDocumento.findFirst({
      where: { id: documentId, clienteId },
      include: {
        estabelecimento: { select: { id: true, clienteId: true, cnpj: true, ativo: true } }
      }
    });
    if (!document) {
      throw new NotFoundException('NF-e nao encontrada.');
    }
    return document;
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
    if (!document.estabelecimento.ativo || document.estabelecimento.clienteId !== document.clienteId) {
      throw new BadRequestException('Estabelecimento inativo ou fora do escopo do cliente.');
    }
    if (!this.isValidAccessKey(document.chaveAcesso)) {
      throw new BadRequestException('A chave armazenada da NF-e e invalida.');
    }
  }

  private async findCertificate(clienteId: string, estabelecimentoId: string, actor: string) {
    const now = new Date();
    const certificates = await this.prisma.certificado.findMany({
      where: {
        ativo: true,
        cnpjTitular: actor,
        OR: [
          { clienteId, estabelecimentoId },
          { clienteId, estabelecimentoId: null }
        ],
        AND: [{ OR: [{ validadeFim: null }, { validadeFim: { gt: now } }] }]
      },
      orderBy: [{ estabelecimentoId: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, arquivoCriptografadoPath: true }
    });
    for (const certificate of certificates) {
      if (await this.storage.hasObject(certificate.arquivoCriptografadoPath)) {
        return certificate;
      }
    }
    return null;
  }

  private async loadImportedManifestations(documentId: string): Promise<Array<{
    id: string;
    tipoEvento: string;
    dataEvento: Date | null;
    createdAt: Date;
    nSeqEvento: number | null;
    cStat: string | null;
    xMotivo: string | null;
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

  private assertNoManifestationInProgress(attempts: Array<{ tipoEvento: string; status: string }>): void {
    if (attempts.some((item) => INDETERMINATE_STATUSES.has(item.status))) {
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
      autorizacaoExpressaEm: item.autorizacaoExpressaEm,
      enviadoEm: item.enviadoEm,
      processadoEm: item.processadoEm
    };
  }

  private sanitizeSefazText(value?: string | null): string | null {
    if (!value) return null;
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
