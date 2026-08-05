import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Ambiente, DocumentoOrigem, NfseDocumento, Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import {
  NFSE_EMISSOR_PUBLICO_CLIENT,
  NfseEmissorPublicoClient
} from '../../integrations/nfse-emissor-publico/nfse-emissor-publico.types';
import { MAX_UNPAGINATED_RESULTS } from '../../common/dto/pagination-query.dto';
import { NFSE_ADN_CLIENT, NfseAdnClient } from '../../integrations/nfse-adn/nfse-adn.types';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats.dto';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { DanfseRenderInput, NfseDanfseService } from './nfse-danfse.service';
import { ImportXmlDto } from './dto/import-xml.dto';
import { ListNfseGapAuditsQueryDto } from './dto/list-gap-audits.dto';
import {
  CreateNfseNumeracaoExcecaoDto,
  ListNfseNumeracaoExcecoesQueryDto
} from './dto/numeracao-excecao.dto';
import { QueryNfseDto } from './dto/query-nfse.dto';
import { RecuperarNfsePorDpsDto } from './dto/recuperar-por-dps.dto';
import { RecuperarNfsePorChaveDto } from './dto/recuperar-por-chave.dto';
import { ReprocessarDanfsesDto } from './dto/reprocessar-danfses.dto';
import { ReprocessarXmlsDto } from './dto/reprocessar-xmls.dto';
import { SincronizarNfseEventosDto } from './dto/sincronizar-eventos.dto';
import { UpdateNfseDocumentNumberingValidationDto } from './dto/update-document-numbering-validation.dto';
import { NfseXmlParserService, ParsedNfse, ParsedNfseEvento } from './nfse-xml-parser.service';

type NfseNumeracaoGap = {
  ambiente: Ambiente;
  serie: string | null;
  numeroInicial: number;
  numeroFinal: number;
  quantidade: number;
};

type NfseNumeracaoValidation = {
  aplicada: boolean;
  motivo?: 'requer_consulta_emitidas' | 'filtros_incompativeis';
  cnpjPrestador: string | null;
  totalDocumentosAnalisados: number;
  totalNumerosValidos: number;
  totalFaixasLacuna: number;
  totalNumerosPulados: number;
  possuiNumeracaoPulada: boolean;
  lacunas: NfseNumeracaoGap[];
};

type NfseDocumentoNumeracaoProjection = Pick<NfseDocumento, 'ambiente' | 'serie' | 'numeroNfse' | 'ignorarNumeracaoValidacao'>;
type NfseNumeracaoExcecaoProjection = {
  ambiente: Ambiente;
  numeroNfse: number;
};

type RecuperacaoDpsGap = {
  ambiente: Ambiente;
  serie: string | null;
  numeroInicial: number;
  numeroFinal: number;
};

type RecuperacaoDpsDetail = {
  ambiente: 'producao' | 'producao_restrita';
  serie: string | null;
  numeroDps: string;
  dpsId: string | null;
  chaveAcesso: string | null;
  status: 'recuperada' | 'falha';
  mensagem: string;
  documentoId?: string;
};

type DocumentoRecoveryNeighbor = Pick<
  NfseDocumento,
  'ambiente' | 'serie' | 'numeroNfse' | 'chaveAcesso' | 'cnpjPrestador' | 'municipioPrestacaoCodigo' | 'xmlPath'
>;

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);
  private readonly eventRequestIntervalMs = process.env.NODE_ENV === 'test' ? 0 : this.readPositiveNumberEnv('NFSE_EVENTOS_REQUEST_INTERVAL_MS', 5000);
  private readonly eventRateLimitRetryCount =
    process.env.NODE_ENV === 'test' ? 0 : this.readBoundedIntegerEnv('NFSE_EVENTOS_RATE_LIMIT_RETRY_COUNT', 2, 0, 5);
  private readonly eventRateLimitRetryDelayMs =
    process.env.NODE_ENV === 'test' ? 0 : this.readPositiveNumberEnv('NFSE_EVENTOS_RATE_LIMIT_RETRY_DELAY_MS', 15000);
  private lastEventRequestAtMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: NfseXmlParserService,
    private readonly storage: LocalStorageService,
    private readonly danfse: NfseDanfseService,
    @Inject(NFSE_ADN_CLIENT) private readonly adnClient: NfseAdnClient,
    @Inject(NFSE_EMISSOR_PUBLICO_CLIENT) private readonly emissorPublicoClient: NfseEmissorPublicoClient
  ) {}

  async findAll(query: QueryNfseDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    const { page, pageSize, skip } = this.resolvePagination(query);
    const shouldValidateNumbering = this.shouldValidateEmitidasNumbering(query, cnpjConsulta);

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidas') {
        where.cnpjPrestador = cnpjConsulta;
      } else if (tipoRelacao === 'tomadas') {
        where.cnpjTomador = cnpjConsulta;
      } else {
        where.OR = [{ cnpjPrestador: cnpjConsulta }, { cnpjTomador: cnpjConsulta }];
      }
    }

    if (query.all) {
      const rawItems = await this.prisma.nfseDocumento.findMany({
        where,
        orderBy: { dataEmissao: 'desc' },
        skip,
        take: pageSize,
        include: this.nfseDocumentoInclude()
      });
      const { items: uniqueItems, duplicatesRemoved } = this.deduplicateDocumentosForList(rawItems);
      if (duplicatesRemoved > 0) {
        this.logger.warn(`Listagem de NFS-e ocultou ${duplicatesRemoved} duplicata(s) legada(s) por ambiente + chave_acesso.`);
      }

      const total = uniqueItems.length;
      const items = await Promise.all(uniqueItems.map((item) => this.enrichDocumentoSummary(item)));
      const validacaoNumeracao = shouldValidateNumbering
        ? await this.resolveEmitidasNumberingValidation(query, cnpjConsulta)
        : this.buildSkippedNumberingValidationNotApplied(query, cnpjConsulta);

      return {
        items,
        total,
        page,
        pageSize,
        totalPages: 1,
        validacaoNumeracao
      };
    }

    const [total, rawItems] = await Promise.all([
      this.prisma.nfseDocumento.count({ where }),
      this.prisma.nfseDocumento.findMany({
        where,
        orderBy: { dataEmissao: 'desc' },
        skip,
        take: pageSize,
        include: this.nfseDocumentoInclude()
      })
    ]);
    const { items: uniqueItems, duplicatesRemoved } = this.deduplicateDocumentosForList(rawItems);
    if (duplicatesRemoved > 0) {
      this.logger.warn(`Listagem de NFS-e ocultou ${duplicatesRemoved} duplicata(s) legada(s) por ambiente + chave_acesso.`);
    }

    const items = await Promise.all(uniqueItems.map((item) => this.enrichDocumentoSummary(item)));
    const validacaoNumeracao = shouldValidateNumbering
      ? await this.resolveEmitidasNumberingValidation(query, cnpjConsulta)
      : this.buildSkippedNumberingValidationNotApplied(query, cnpjConsulta);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      validacaoNumeracao
    };
  }

  async getDashboardStats(query: DashboardStatsQueryDto) {
    const where: Prisma.NfseDocumentoWhereInput = {};

    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const storedXmlWhere: Prisma.NfseDocumentoWhereInput = {
      ...where,
      xmlPath: {
        not: null
      }
    };

    const [totalNfse, storedXmls, totalByClientRows, storedByClientRows] = await Promise.all([
      this.prisma.nfseDocumento.count({ where }),
      this.prisma.nfseDocumento.count({ where: storedXmlWhere }),
      this.prisma.nfseDocumento.groupBy({
        by: ['clienteId'],
        where,
        _count: {
          _all: true
        }
      }),
      this.prisma.nfseDocumento.groupBy({
        by: ['clienteId'],
        where: storedXmlWhere,
        _count: {
          _all: true
        }
      })
    ]);

    const byClient = new Map<string, { clienteId: string; totalNfse: number; storedXmls: number }>();

    totalByClientRows.forEach((row) => {
      if (!row.clienteId) {
        return;
      }

      byClient.set(row.clienteId, {
        clienteId: row.clienteId,
        totalNfse: row._count._all,
        storedXmls: 0
      });
    });

    storedByClientRows.forEach((row) => {
      if (!row.clienteId) {
        return;
      }

      const current = byClient.get(row.clienteId) ?? {
        clienteId: row.clienteId,
        totalNfse: 0,
        storedXmls: 0
      };

      current.storedXmls = row._count._all;
      byClient.set(row.clienteId, current);
    });

    return {
      totalNfse,
      storedXmls,
      byClient: Array.from(byClient.values()).sort(
        (left, right) =>
          right.totalNfse - left.totalNfse ||
          right.storedXmls - left.storedXmls ||
          left.clienteId.localeCompare(right.clienteId)
      )
    };
  }

  async findSeparated(query: QueryNfseDto) {
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    if (!cnpjConsulta) {
      throw new BadRequestException('Informe cnpjConsulta com 14 digitos para separar emitidas e tomadas.');
    }
    const shouldValidateNumbering = this.shouldValidateEmitidasNumbering(query, cnpjConsulta);

    const baseWhere = this.buildBaseWhere(query);
    delete baseWhere.cnpjPrestador;
    delete baseWhere.cnpjTomador;
    delete baseWhere.OR;

    const [emitidas, tomadas] = await Promise.all([
      this.prisma.nfseDocumento.findMany({
        where: {
          ...baseWhere,
          cnpjPrestador: cnpjConsulta
        },
        orderBy: { dataEmissao: 'desc' },
        take: 500,
        include: this.nfseDocumentoInclude()
      }),
      this.prisma.nfseDocumento.findMany({
        where: {
          ...baseWhere,
          cnpjTomador: cnpjConsulta
        },
        orderBy: { dataEmissao: 'desc' },
        take: 500,
        include: this.nfseDocumentoInclude()
      })
    ]);

    const validacaoNumeracaoEmitidas = shouldValidateNumbering
      ? await this.loadGeneralEmitidasNumberingValidation(query.clienteId, cnpjConsulta)
      : this.buildSkippedNumberingValidationNotApplied(query, cnpjConsulta);

    return {
      cnpjConsulta,
      totais: {
        emitidas: emitidas.length,
        tomadas: tomadas.length
      },
      validacaoNumeracaoEmitidas,
      emitidas,
      tomadas
    };
  }

  async listGapAudits(query: ListNfseGapAuditsQueryDto = {}) {
    const clients = await this.prisma.cliente.findMany({
      where: query.clienteId ? { id: query.clienteId } : undefined,
      select: {
        id: true,
        razaoSocial: true,
        cnpj: true
      },
      orderBy: { razaoSocial: 'asc' }
    });

    if (clients.length === 0) {
      return [];
    }

    const documents = await this.prisma.nfseDocumento.findMany({
      where: {
        clienteId: { in: clients.map((client) => client.id) },
        xmlPath: { not: null },
        numeroNfse: { not: null }
      },
      select: {
        id: true,
        clienteId: true,
        ambiente: true,
        chaveAcesso: true,
        hashXml: true,
        numeroNfse: true,
        serie: true,
        dataEmissao: true,
        cnpjPrestador: true,
        razaoSocialPrestador: true,
        cnpjTomador: true,
        razaoSocialTomador: true,
        valorServico: true,
        xmlPath: true,
        danfsePath: true,
        ignorarNumeracaoValidacao: true,
        createdAt: true,
        updatedAt: true
      }
    });
    const numberingExceptions = await this.prisma.nfseNumeracaoExcecao.findMany({
      where: {
        clienteId: { in: clients.map((client) => client.id) }
      },
      select: {
        clienteId: true,
        cnpjConsulta: true,
        ambiente: true,
        numeroNfse: true
      }
    });

    return clients
      .map((client) => {
        const cnpjConsulta = this.normalizeCnpj(client.cnpj);
        const filteredDocuments = documents
          .filter((document) => document.clienteId === client.id)
          .filter((document) => !cnpjConsulta || document.cnpjPrestador === cnpjConsulta);
        const { items: uniqueDocuments } = this.deduplicateDocumentosForList(filteredDocuments);
        const visibleDocuments = uniqueDocuments
          .map((document) => ({
            ambiente: document.ambiente,
            serie: document.serie,
            numeroNfse: document.numeroNfse,
            ignorarNumeracaoValidacao: document.ignorarNumeracaoValidacao
          }));
        const ignoredNumbers = numberingExceptions
          .filter((item) => item.clienteId === client.id)
          .filter((item) => !cnpjConsulta || item.cnpjConsulta === cnpjConsulta)
          .map((item) => ({
            ambiente: item.ambiente,
            numeroNfse: item.numeroNfse
          }));

        const validation = this.buildNfseNumberingValidation(visibleDocuments, cnpjConsulta, ignoredNumbers);
        return {
          clienteId: client.id,
          razaoSocial: client.razaoSocial,
          cnpjConsulta: cnpjConsulta ?? '',
          totalDocumentosAnalisados: validation.totalDocumentosAnalisados,
          totalNumerosValidos: validation.totalNumerosValidos,
          totalFaixasLacuna: validation.totalFaixasLacuna,
          totalNumerosPulados: validation.totalNumerosPulados,
          lacunas: validation.lacunas
        };
      })
      .filter((row) => row.totalFaixasLacuna > 0);
  }

  async listNumberingExceptions(query: ListNfseNumeracaoExcecoesQueryDto = {}) {
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    return this.prisma.nfseNumeracaoExcecao.findMany({
      where: {
        ...(query.clienteId ? { clienteId: query.clienteId } : {}),
        ...(cnpjConsulta ? { cnpjConsulta } : {})
      },
      orderBy: [{ ambiente: 'asc' }, { numeroNfse: 'asc' }]
    });
  }

  async createNumberingException(dto: CreateNfseNumeracaoExcecaoDto) {
    const cnpjConsulta = this.normalizeCnpj(dto.cnpjConsulta);
    if (!cnpjConsulta) {
      throw new BadRequestException('Informe cnpjConsulta com 14 digitos para registrar a excecao de numeracao.');
    }

    return this.prisma.nfseNumeracaoExcecao.upsert({
      where: {
        clienteId_cnpjConsulta_ambiente_numeroNfse: {
          clienteId: dto.clienteId,
          cnpjConsulta,
          ambiente: dto.ambiente,
          numeroNfse: dto.numeroNfse
        }
      },
      create: {
        clienteId: dto.clienteId,
        cnpjConsulta,
        ambiente: dto.ambiente,
        numeroNfse: dto.numeroNfse,
        tipo: dto.tipo,
        observacao: dto.observacao?.trim() || null
      },
      update: {
        tipo: dto.tipo,
        observacao: dto.observacao?.trim() || null
      }
    });
  }

  async deleteNumberingException(id: string, clienteId: string) {
    const found = await this.prisma.nfseNumeracaoExcecao.findUnique({
      where: { id }
    });
    if (!found || found.clienteId !== clienteId) {
      throw new NotFoundException('Excecao de numeracao nao encontrada para o cliente informado.');
    }

    return this.prisma.nfseNumeracaoExcecao.delete({
      where: { id }
    });
  }

  async updateDocumentNumberingValidation(id: string, dto: UpdateNfseDocumentNumberingValidationDto) {
    const found = await this.prisma.nfseDocumento.findUnique({
      where: { id },
      select: {
        id: true,
        clienteId: true
      }
    });

    if (!found || found.clienteId !== dto.clienteId) {
      throw new NotFoundException('Documento NFS-e nao encontrado para o cliente informado.');
    }

    return this.prisma.nfseDocumento.update({
      where: { id },
      data: {
        ignorarNumeracaoValidacao: dto.ignorar,
        ignorarNumeracaoObservacao: dto.ignorar ? dto.observacao?.trim() || 'Documento desconsiderado na validacao de numeracao.' : null
      }
    });
  }

  private nfseDocumentoInclude(): Prisma.NfseDocumentoInclude {
    return {
      eventos: {
        orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
      }
    };
  }

  private deduplicateDocumentosForList<
    T extends Pick<
      NfseDocumento,
      | 'ambiente'
      | 'chaveAcesso'
      | 'hashXml'
      | 'numeroNfse'
      | 'serie'
      | 'dataEmissao'
      | 'cnpjPrestador'
      | 'razaoSocialPrestador'
      | 'cnpjTomador'
      | 'razaoSocialTomador'
      | 'valorServico'
      | 'xmlPath'
      | 'danfsePath'
      | 'createdAt'
      | 'updatedAt'
    > & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
    }
  >(documents: T[]): { items: T[]; duplicatesRemoved: number } {
    const selected: T[] = [];
    const keyToIndex = new Map<string, number>();

    for (const document of documents) {
      const candidateKeys = this.buildNfseDuplicateKeys(document);
      const existingIndex = candidateKeys
        .map((key) => keyToIndex.get(key))
        .find((index): index is number => index !== undefined);

      if (existingIndex === undefined) {
        const nextIndex = selected.push(document) - 1;
        candidateKeys.forEach((key) => keyToIndex.set(key, nextIndex));
        continue;
      }

      const current = selected[existingIndex];
      if (this.isPreferredListDocumento(document, current)) {
        selected[existingIndex] = document;
      }

      candidateKeys.forEach((key) => keyToIndex.set(key, existingIndex));
      this.buildNfseDuplicateKeys(selected[existingIndex]).forEach((key) => keyToIndex.set(key, existingIndex));
    }

    const items = selected.sort((left, right) => {
      const emissaoDiff = this.toTimestamp(right.dataEmissao) - this.toTimestamp(left.dataEmissao);
      if (emissaoDiff !== 0) {
        return emissaoDiff;
      }

      const updatedDiff = this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt);
      if (updatedDiff !== 0) {
        return updatedDiff;
      }

      return this.toTimestamp(right.createdAt) - this.toTimestamp(left.createdAt);
    });

    return {
      items,
      duplicatesRemoved: documents.length - items.length
    };
  }

  private buildNfseDuplicateKeys(
    document: Pick<
      NfseDocumento,
      | 'ambiente'
      | 'chaveAcesso'
      | 'hashXml'
      | 'numeroNfse'
      | 'serie'
      | 'dataEmissao'
      | 'cnpjPrestador'
      | 'cnpjTomador'
      | 'valorServico'
    >
  ): string[] {
    const keys = new Set<string>();
    const ambiente = String(document.ambiente || '');
    const chaveAcesso = String(document.chaveAcesso || '').trim();
    const hashXml = String(document.hashXml || '').trim();
    const emissao = this.toDateKey(document.dataEmissao);
    const valor = document.valorServico?.toString?.() ?? '';

    if (ambiente && chaveAcesso) {
      keys.add(`chave:${ambiente}:${chaveAcesso}`);
    }

    if (chaveAcesso) {
      keys.add(`chave-global:${chaveAcesso}`);
    }

    if (ambiente && hashXml) {
      keys.add(`hash:${ambiente}:${hashXml}`);
    }

    if (hashXml) {
      keys.add(`hash-global:${hashXml}`);
    }

    const snapshot = [
      ambiente,
      String(document.numeroNfse || '').trim(),
      String(document.serie || '').trim(),
      emissao,
      String(document.cnpjPrestador || '').trim(),
      String(document.cnpjTomador || '').trim(),
      valor
    ].join(':');

    if (snapshot.replace(/:/g, '').trim()) {
      keys.add(`snapshot:${snapshot}`);
    }

    const globalSnapshot = [
      String(document.numeroNfse || '').trim(),
      String(document.serie || '').trim(),
      emissao,
      String(document.cnpjPrestador || '').trim(),
      String(document.cnpjTomador || '').trim(),
      valor
    ].join(':');

    if (globalSnapshot.replace(/:/g, '').trim()) {
      keys.add(`snapshot-global:${globalSnapshot}`);
    }

    return Array.from(keys);
  }

  private isPreferredListDocumento(
    candidate: Pick<
      NfseDocumento,
      | 'xmlPath'
      | 'danfsePath'
      | 'numeroNfse'
      | 'serie'
      | 'dataEmissao'
      | 'cnpjPrestador'
      | 'razaoSocialPrestador'
      | 'cnpjTomador'
      | 'razaoSocialTomador'
      | 'updatedAt'
      | 'createdAt'
    >,
    current: Pick<
      NfseDocumento,
      | 'xmlPath'
      | 'danfsePath'
      | 'numeroNfse'
      | 'serie'
      | 'dataEmissao'
      | 'cnpjPrestador'
      | 'razaoSocialPrestador'
      | 'cnpjTomador'
      | 'razaoSocialTomador'
      | 'updatedAt'
      | 'createdAt'
    >
  ): boolean {
    const scoreDiff = this.scoreListDocumento(candidate) - this.scoreListDocumento(current);
    if (scoreDiff !== 0) {
      return scoreDiff > 0;
    }

    const updatedDiff = this.toTimestamp(candidate.updatedAt) - this.toTimestamp(current.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff > 0;
    }

    return this.toTimestamp(candidate.createdAt) > this.toTimestamp(current.createdAt);
  }

  private scoreListDocumento(
    document: Pick<
      NfseDocumento,
      'xmlPath' | 'danfsePath' | 'numeroNfse' | 'serie' | 'dataEmissao' | 'cnpjPrestador' | 'razaoSocialPrestador' | 'cnpjTomador' | 'razaoSocialTomador'
    >
  ): number {
    return [
      Boolean(document.xmlPath),
      Boolean(document.danfsePath),
      Boolean(document.numeroNfse),
      Boolean(document.serie),
      Boolean(document.dataEmissao),
      Boolean(document.cnpjPrestador),
      Boolean(document.razaoSocialPrestador),
      Boolean(document.cnpjTomador),
      Boolean(document.razaoSocialTomador)
    ].filter(Boolean).length;
  }

  private buildEventoSyncWhere(dto: SincronizarNfseEventosDto): Prisma.NfseDocumentoWhereInput {
    const where: Prisma.NfseDocumentoWhereInput = {
      clienteId: dto.clienteId
    };

    if (Array.isArray(dto.documentoIds) && dto.documentoIds.length > 0) {
      where.id = {
        in: dto.documentoIds
      };
    }

    if (dto.estabelecimentoId) {
      where.estabelecimentoId = dto.estabelecimentoId;
    }

    if (dto.ambiente) {
      where.ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    }

    if (dto.chaveAcesso) {
      where.chaveAcesso = dto.chaveAcesso;
    }

    if (dto.somenteSemEventos ?? true) {
      where.eventos = {
        none: {}
      };
    }

    return where;
  }

  private buildBaseWhere(query: QueryNfseDto): Prisma.NfseDocumentoWhereInput {
    const where: Prisma.NfseDocumentoWhereInput = { AND: [] };
    const andConditions = this.getAndConditions(where);

    if (query.clienteId) {
      andConditions.push({ clienteId: query.clienteId });
    }

    const cnpjPrestador = this.normalizeCnpj(query.cnpjPrestador);
    if (cnpjPrestador) {
      andConditions.push({ cnpjPrestador });
    }

    const cnpjTomador = this.normalizeCnpj(query.cnpjTomador);
    if (cnpjTomador) {
      andConditions.push({ cnpjTomador });
    }

    const cnpj = this.normalizeCnpj(query.cnpj);
    if (cnpj) {
      andConditions.push({
        OR: [{ cnpjPrestador: cnpj }, { cnpjTomador: cnpj }]
      });
    }

    if (query.status) {
      andConditions.push({ status: query.status });
    }

    if (query.dataInicio || query.dataFim) {
      andConditions.push({
        dataEmissao: {
          gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
          lte: query.dataFim ? new Date(query.dataFim) : undefined
        }
      });
    }

    if (query.competencia) {
      const [year, month] = query.competencia.split('-').map((v) => Number(v));
      if (year && month) {
        andConditions.push({
          competencia: new Date(Date.UTC(year, month - 1, 1))
        });
      }
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      andConditions.push({
        valorServico: {
          gte: query.valorMin,
          lte: query.valorMax
        }
      });
    }

    if (query.numeroNfse) {
      andConditions.push({
        numeroNfse: {
          contains: query.numeroNfse
        }
      });
    }

    if (query.municipio) {
      andConditions.push({ municipioPrestacaoNome: query.municipio });
    }

    if (query.downloadInicio || query.downloadFim) {
      andConditions.push({
        updatedAt: {
          gte: query.downloadInicio ? new Date(query.downloadInicio) : undefined,
          lte: query.downloadFim ? new Date(query.downloadFim) : undefined
        }
      });
    }

    if (query.statusArmazenamento === 'Armazenado') {
      andConditions.push({
        xmlPath: {
          not: null
        }
      });
    } else if (query.statusArmazenamento === 'Erro') {
      andConditions.push({ xmlPath: null });
    } else if (query.statusArmazenamento === 'Pendente') {
      andConditions.push({ id: '__no-match__' });
    }

    return where;
  }

  private getAndConditions(where: Prisma.NfseDocumentoWhereInput): Prisma.NfseDocumentoWhereInput[] {
    if (Array.isArray(where.AND)) {
      return where.AND;
    }

    if (where.AND) {
      return [where.AND];
    }

    const andConditions: Prisma.NfseDocumentoWhereInput[] = [];
    where.AND = andConditions;
    return andConditions;
  }

  private resolvePagination(query: QueryNfseDto): { page: number; pageSize: number; skip: number } {
    if (query.all) {
      return { page: 1, pageSize: MAX_UNPAGINATED_RESULTS, skip: 0 };
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(200, query.pageSize ?? 100));
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize
    };
  }

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private normalizeSearchText(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private toTimestamp(value?: Date | null): number {
    return value instanceof Date ? value.getTime() : 0;
  }

  private toDateKey(value?: Date | null): string {
    return value instanceof Date ? value.toISOString() : '';
  }

  private shouldValidateEmitidasNumbering(query: QueryNfseDto, cnpjConsulta?: string): boolean {
    return Boolean(cnpjConsulta) && (query.tipoRelacao ?? 'ambas') === 'emitidas';
  }

  private async resolveEmitidasNumberingValidation(
    query: QueryNfseDto,
    cnpjConsulta: string | undefined
  ): Promise<NfseNumeracaoValidation> {
    if (!cnpjConsulta) {
      return this.buildSkippedNumberingValidationNotApplied(query, cnpjConsulta);
    }

    return this.loadGeneralEmitidasNumberingValidation(query.clienteId, cnpjConsulta);
  }

  private async loadGeneralEmitidasNumberingValidation(
    clienteId?: string,
    cnpjConsulta?: string
  ): Promise<NfseNumeracaoValidation> {
    if (!cnpjConsulta) {
      return {
        aplicada: false,
        motivo: 'requer_consulta_emitidas',
        cnpjPrestador: null,
        totalDocumentosAnalisados: 0,
        totalNumerosValidos: 0,
        totalFaixasLacuna: 0,
        totalNumerosPulados: 0,
        possuiNumeracaoPulada: false,
        lacunas: []
      };
    }

    const [documents, numeracaoExcecoes] = await Promise.all([
      this.prisma.nfseDocumento.findMany({
        where: {
          ...(clienteId ? { clienteId } : {}),
          cnpjPrestador: cnpjConsulta,
          xmlPath: { not: null },
          numeroNfse: { not: null }
        },
        select: {
          ambiente: true,
          chaveAcesso: true,
          hashXml: true,
          numeroNfse: true,
          serie: true,
          dataEmissao: true,
          cnpjPrestador: true,
          razaoSocialPrestador: true,
          cnpjTomador: true,
          razaoSocialTomador: true,
          valorServico: true,
          xmlPath: true,
          danfsePath: true,
          createdAt: true,
          updatedAt: true,
          ignorarNumeracaoValidacao: true
        }
      }),
      this.loadNumberingExceptionsForValidation(clienteId, cnpjConsulta)
    ]);

    const { items: uniqueDocuments } = this.deduplicateDocumentosForList(documents);
    return this.buildNfseNumberingValidation(uniqueDocuments, cnpjConsulta, numeracaoExcecoes);
  }

  private buildSkippedNumberingValidationNotApplied(
    query: QueryNfseDto,
    cnpjConsulta?: string
  ): NfseNumeracaoValidation {
    return {
      aplicada: false,
      motivo: 'requer_consulta_emitidas',
      cnpjPrestador: cnpjConsulta ?? null,
      totalDocumentosAnalisados: 0,
      totalNumerosValidos: 0,
      totalFaixasLacuna: 0,
      totalNumerosPulados: 0,
      possuiNumeracaoPulada: false,
      lacunas: []
    };
  }

  private buildNfseNumberingValidation(
    documents: NfseDocumentoNumeracaoProjection[],
    cnpjConsulta?: string,
    ignoredNumbers: NfseNumeracaoExcecaoProjection[] = []
  ): NfseNumeracaoValidation {
    const documentsForValidation = documents.filter((document) => !document.ignorarNumeracaoValidacao);
    const groupedNumbers = new Map<string, { ambiente: Ambiente; serie: string | null; numbers: Set<number> }>();
    const ignoredNumberSet = this.buildIgnoredNumberSet(ignoredNumbers);
    let totalNumerosValidos = 0;

    for (const document of documentsForValidation) {
      const numero = this.parseNumeroNfse(document.numeroNfse);
      if (numero === null) {
        continue;
      }

      totalNumerosValidos += 1;
      const groupKey = String(document.ambiente);
      const current =
        groupedNumbers.get(groupKey) ??
        {
          ambiente: document.ambiente,
          serie: null,
          numbers: new Set<number>()
        };

      current.numbers.add(numero);
      groupedNumbers.set(groupKey, current);
    }

    const lacunas: NfseNumeracaoGap[] = [];

    groupedNumbers.forEach((group) => {
      const orderedNumbers = Array.from(group.numbers).sort((left, right) => left - right);

      for (let index = 1; index < orderedNumbers.length; index += 1) {
        const anterior = orderedNumbers[index - 1];
        const atual = orderedNumbers[index];
        const quantidade = atual - anterior - 1;

        if (quantidade <= 0) {
          continue;
        }

        lacunas.push(
          ...this.buildNumberingGapsExcludingIgnored(group.ambiente, group.serie, anterior + 1, atual - 1, ignoredNumberSet)
        );
      }
    });

    lacunas.sort((left, right) => {
      const ambienteDiff = String(left.ambiente).localeCompare(String(right.ambiente));
      if (ambienteDiff !== 0) {
        return ambienteDiff;
      }

      return left.numeroInicial - right.numeroInicial;
    });

    const totalNumerosPulados = lacunas.reduce((total, lacuna) => total + lacuna.quantidade, 0);

    return {
      aplicada: true,
      cnpjPrestador: cnpjConsulta ?? null,
      totalDocumentosAnalisados: documentsForValidation.length,
      totalNumerosValidos,
      totalFaixasLacuna: lacunas.length,
      totalNumerosPulados,
      possuiNumeracaoPulada: lacunas.length > 0,
      lacunas
    };
  }

  private async loadNumberingExceptionsForValidation(
    clienteId?: string,
    cnpjConsulta?: string
  ): Promise<NfseNumeracaoExcecaoProjection[]> {
    if (!clienteId || !cnpjConsulta) {
      return [];
    }

    return this.prisma.nfseNumeracaoExcecao.findMany({
      where: {
        clienteId,
        cnpjConsulta
      },
      select: {
        ambiente: true,
        numeroNfse: true
      }
    });
  }

  private buildIgnoredNumberSet(ignoredNumbers: NfseNumeracaoExcecaoProjection[]): Set<string> {
    return new Set(
      ignoredNumbers
        .map((item) => {
          const numero = Number(item?.numeroNfse || 0);
          if (!numero) {
            return '';
          }

          return `${String(item.ambiente)}:${numero}`;
        })
        .filter(Boolean)
    );
  }

  private buildNumberingGapsExcludingIgnored(
    ambiente: Ambiente,
    serie: string | null,
    numeroInicial: number,
    numeroFinal: number,
    ignoredNumberSet: Set<string>
  ): NfseNumeracaoGap[] {
    const lacunas: NfseNumeracaoGap[] = [];
    let rangeStart: number | null = null;

    for (let numero = numeroInicial; numero <= numeroFinal; numero += 1) {
      const ignored = ignoredNumberSet.has(`${String(ambiente)}:${numero}`);
      if (ignored) {
        if (rangeStart !== null) {
          lacunas.push({
            ambiente,
            serie,
            numeroInicial: rangeStart,
            numeroFinal: numero - 1,
            quantidade: numero - rangeStart
          });
          rangeStart = null;
        }
        continue;
      }

      if (rangeStart === null) {
        rangeStart = numero;
      }
    }

    if (rangeStart !== null) {
      lacunas.push({
        ambiente,
        serie,
        numeroInicial: rangeStart,
        numeroFinal,
        quantidade: numeroFinal - rangeStart + 1
      });
    }

    return lacunas;
  }

  private parseNumeroNfse(value?: string | null): number | null {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  private normalizeSerie(value?: string | null): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private async enrichDocumentoSummary(
    doc: NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
    }
  ) {
    const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
      municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo,
      municipioPrestacaoNome: doc.municipioPrestacaoNome,
      cnpjPrestador: doc.cnpjPrestador
    });

    if (!doc.xmlPath) {
      return {
        ...doc,
        municipioPrestacaoNome: municipioPrestacaoNome ?? doc.municipioPrestacaoNome
      };
    }

    try {
      const xml = (await this.storage.getObject(doc.xmlPath)).toString('utf8');
      const parsed = this.parser.parse(xml);
      const municipioPrestacaoNomeEnriquecido = await this.resolveMunicipioPrestacaoNome({
        municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo ?? parsed.municipioPrestacaoCodigo,
        municipioPrestacaoNome: doc.municipioPrestacaoNome ?? parsed.municipioPrestacaoNome,
        cnpjPrestador: doc.cnpjPrestador ?? parsed.cnpjPrestador
      });

      return {
        ...doc,
        ambiente: this.resolveNfseAmbienteFromParsed(parsed, doc.ambiente),
        razaoSocialPrestador: doc.razaoSocialPrestador ?? parsed.razaoSocialPrestador ?? null,
        razaoSocialTomador: doc.razaoSocialTomador ?? parsed.razaoSocialTomador ?? null,
        municipioPrestacaoNome: municipioPrestacaoNomeEnriquecido ?? doc.municipioPrestacaoNome ?? parsed.municipioPrestacaoNome ?? null
      };
    } catch (error) {
      this.logger.warn(`Falha ao enriquecer listagem da NFS-e ${doc.id}: ${this.toErrorMessage(error)}`);
      return {
        ...doc,
        municipioPrestacaoNome: municipioPrestacaoNome ?? doc.municipioPrestacaoNome
      };
    }
  }

  private async enrichDocumentoDetails(
    doc: NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
    }
  ): Promise<
    NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
      retencaoIss?: string | null;
    }
  > {
    if (!doc.xmlPath) {
      const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
        municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo,
        municipioPrestacaoNome: doc.municipioPrestacaoNome,
        cnpjPrestador: doc.cnpjPrestador
      });
      return {
        ...doc,
        municipioPrestacaoNome: municipioPrestacaoNome ?? doc.municipioPrestacaoNome
      };
    }

    try {
      const xml = (await this.storage.getObject(doc.xmlPath)).toString('utf8');
      const parsed = this.parser.parse(xml);
      const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
        municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo ?? parsed.municipioPrestacaoCodigo,
        municipioPrestacaoNome: doc.municipioPrestacaoNome ?? parsed.municipioPrestacaoNome,
        cnpjPrestador: doc.cnpjPrestador ?? parsed.cnpjPrestador
      });

      return {
        ...doc,
        ambiente: this.resolveNfseAmbienteFromParsed(parsed, doc.ambiente),
        razaoSocialPrestador: doc.razaoSocialPrestador ?? parsed.razaoSocialPrestador ?? null,
        razaoSocialTomador: doc.razaoSocialTomador ?? parsed.razaoSocialTomador ?? null,
        municipioPrestacaoNome: municipioPrestacaoNome ?? doc.municipioPrestacaoNome ?? parsed.municipioPrestacaoNome ?? null,
        retencaoIss: parsed.retencaoIss ?? null
      };
    } catch (error) {
      this.logger.warn(`Falha ao enriquecer detalhes da NFS-e ${doc.id}: ${this.toErrorMessage(error)}`);
      const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
        municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo,
        municipioPrestacaoNome: doc.municipioPrestacaoNome,
        cnpjPrestador: doc.cnpjPrestador
      });
      return {
        ...doc,
        municipioPrestacaoNome: municipioPrestacaoNome ?? doc.municipioPrestacaoNome
      };
    }
  }

  async findOne(id: string, clienteId: string) {
    const found = await this.prisma.nfseDocumento.findUnique({
      where: { id },
      include: this.nfseDocumentoInclude()
    });
    if (!found) {
      throw new NotFoundException('NFS-e nao encontrada');
    }
    this.assertNfseClientScope(found, clienteId);

    return this.enrichDocumentoDetails(found);
  }

  async getXml(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
    if (!doc.xmlPath) {
      throw new NotFoundException('XML nao disponivel para esta NFS-e');
    }

    const xml = await this.storage.getObject(doc.xmlPath);
    const xmlUtf8 = xml.toString('utf8');
    const fileName = `NFSE-${doc.chaveAcesso}.xml`;

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      fileName,
      contentType: 'application/xml',
      contentBase64: xml.toString('base64'),
      xml: xmlUtf8
    };
  }

  async getDanfse(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
    const { danfsePath, pdf } = await this.ensureDanfseFile(doc);

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      danfsePath,
      fileName: `DANFSE-${doc.chaveAcesso}.pdf`,
      contentType: 'application/pdf',
      contentBase64: pdf.toString('base64')
    };
  }

  async importXml(dto: ImportXmlDto) {
    return this.importXmlWithOrigin(dto, DocumentoOrigem.importacao_xml);
  }

  private importXmlWithOrigin(dto: ImportXmlDto, origem: DocumentoOrigem) {
    const parsedXml = this.parser.parseAny(dto.xml);

    if (parsedXml.kind === 'evento') {
      return this.importEventoXml(dto, parsedXml.evento);
    }

    return this.importNfseXml(dto, parsedXml.nfse, origem);
  }

  async recuperarPorChave(dto: RecuperarNfsePorChaveDto) {
    const chavesAcesso = this.normalizeUniqueChavesAcesso(dto.chavesAcesso);
    if (chavesAcesso.length === 0) {
      throw new BadRequestException('Informe ao menos uma chave de acesso valida para recuperar as NFS-e faltantes.');
    }

    const estabelecimento = await this.resolveRecoveryEstablishment(dto);
    const certificate = await this.findUsableCertificate(dto.clienteId, estabelecimento.id);
    const ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    const detalhes: Array<{
      chaveAcesso: string;
      status: 'recuperada' | 'falha';
      mensagem: string;
      documentoId?: string;
    }> = [];
    let documentsRecovered = 0;
    let failures = 0;

    for (const chaveAcesso of chavesAcesso) {
      const response = await this.emissorPublicoClient.getNfseByChave({
        chaveAcesso,
        ambiente: this.toExternalAmbiente(ambiente),
        certificateId: certificate.id
      });

      if (response.statusCode !== 200 || !response.xml) {
        failures += 1;
        detalhes.push({
          chaveAcesso,
          status: 'falha',
          mensagem: response.message ?? `Falha ao recuperar NFS-e por chave. HTTP ${response.statusCode}.`
        });
        continue;
      }

      try {
        const persisted = await this.importXmlWithOrigin(
          {
            clienteId: dto.clienteId,
            estabelecimentoId: estabelecimento.id,
            ambiente: this.toDtoAmbiente(ambiente),
            xml: response.xml
          },
          DocumentoOrigem.consulta_chave
        );
        documentsRecovered += 1;
        detalhes.push({
          chaveAcesso,
          status: 'recuperada',
          mensagem: 'NFS-e recuperada no Emissor Publico e armazenada com sucesso.',
          documentoId: persisted.id
        });
      } catch (error) {
        failures += 1;
        detalhes.push({
          chaveAcesso,
          status: 'falha',
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      clienteId: dto.clienteId,
      estabelecimentoId: estabelecimento.id,
      cnpjConsulta: estabelecimento.cnpj,
      ambiente: this.toDtoAmbiente(ambiente),
      requestedKeys: chavesAcesso.length,
      processedKeys: detalhes.length,
      documentsRecovered,
      failures,
      detalhes
    };
  }

  async recuperarPorDps(dto: RecuperarNfsePorDpsDto) {
    const lacunas = this.normalizeRecoveryGaps(dto.lacunas, dto.ambiente);
    if (lacunas.length === 0) {
      throw new BadRequestException('Informe ao menos uma faixa de lacuna valida para recuperar as NFS-e por DPS.');
    }

    const estabelecimento = await this.resolveRecoveryEstablishment(dto);
    const certificate = await this.findUsableCertificate(dto.clienteId, estabelecimento.id);
    const cnpjConsulta = this.normalizeCnpj(dto.cnpjConsulta ?? estabelecimento.cnpj);
    if (!cnpjConsulta) {
      throw new BadRequestException('Nao foi possivel identificar o CNPJ emissor para recuperar as NFS-e por DPS.');
    }

    const indexedDocs = await this.loadRecoveryDocsByDps(dto.clienteId, cnpjConsulta, lacunas);
    const detalhes: RecuperacaoDpsDetail[] = [];
    let documentsRecovered = 0;
    let failures = 0;
    let requestedDps = 0;

    for (const lacuna of lacunas) {
      for (let numero = lacuna.numeroInicial; numero <= lacuna.numeroFinal; numero += 1) {
        requestedDps += 1;
        const inferred = await this.inferDpsLookupContext(indexedDocs, lacuna, numero, cnpjConsulta);
        if (!inferred.ok) {
          failures += 1;
          detalhes.push({
            ambiente: this.toDtoAmbiente(lacuna.ambiente),
            serie: lacuna.serie,
            numeroDps: String(numero),
            dpsId: inferred.dpsId,
            chaveAcesso: null,
            status: 'falha',
            mensagem: inferred.message
          });
          continue;
        }

        const response = await this.emissorPublicoClient.getNfseByDpsId({
          dpsId: inferred.dpsId,
          ambiente: this.toExternalAmbiente(lacuna.ambiente),
          certificateId: certificate.id
        });

        if (response.statusCode !== 200 || !response.xml) {
          failures += 1;
          detalhes.push({
            ambiente: this.toDtoAmbiente(lacuna.ambiente),
            serie: lacuna.serie,
            numeroDps: String(numero),
            dpsId: inferred.dpsId,
            chaveAcesso: response.chaveAcesso ?? null,
            status: 'falha',
            mensagem: response.message ?? `Falha ao recuperar NFS-e pela DPS ${inferred.dpsId}. HTTP ${response.statusCode}.`
          });
          continue;
        }

        try {
          const persisted = await this.importXmlWithOrigin(
            {
              clienteId: dto.clienteId,
              estabelecimentoId: estabelecimento.id,
              ambiente: this.toDtoAmbiente(lacuna.ambiente),
              xml: response.xml
            },
            DocumentoOrigem.consulta_dps
          );
          documentsRecovered += 1;
          detalhes.push({
            ambiente: this.toDtoAmbiente(lacuna.ambiente),
            serie: lacuna.serie,
            numeroDps: String(numero),
            dpsId: inferred.dpsId,
            chaveAcesso: persisted.chaveAcesso,
            status: 'recuperada',
            mensagem: 'NFS-e recuperada no Emissor Publico a partir da DPS e armazenada com sucesso.',
            documentoId: persisted.id
          });
        } catch (error) {
          failures += 1;
          detalhes.push({
            ambiente: this.toDtoAmbiente(lacuna.ambiente),
            serie: lacuna.serie,
            numeroDps: String(numero),
            dpsId: inferred.dpsId,
            chaveAcesso: null,
            status: 'falha',
            mensagem: this.toErrorMessage(error)
          });
        }
      }
    }

    return {
      clienteId: dto.clienteId,
      estabelecimentoId: estabelecimento.id,
      cnpjConsulta: estabelecimento.cnpj,
      requestedDps,
      processedDps: detalhes.length,
      documentsRecovered,
      failures,
      detalhes
    };
  }

  async sincronizarEventos(dto: SincronizarNfseEventosDto) {
    const limit = dto.limit ?? 100;
    const documents = await this.findManyDocumentosForEventoSync({
      where: this.buildEventoSyncWhere(dto),
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });
    const certificateByEstablishment = new Map<string, { id: string }>();
    const detalhes: Array<{
      documentoId: string;
      chaveAcesso: string;
      estabelecimentoId: string;
      ambiente: 'producao' | 'producao_restrita';
      status: 'sincronizado' | 'sem_eventos' | 'nao_localizado_endpoint_eventos' | 'falha_api' | 'falha_certificado';
      eventosEncontrados: number;
      eventosImportados: number;
      mensagem?: string;
      diagnostico?: Record<string, unknown>;
    }> = [];
    let documentosComEventos = 0;
    let eventosEncontrados = 0;
    let eventosImportados = 0;
    let falhas = 0;

    for (const document of documents) {
      try {
        const effectiveDocument = await this.reconcileDocumentAmbienteBeforeEventSync(document);

        let certificate = certificateByEstablishment.get(effectiveDocument.estabelecimentoId);
        if (!certificate) {
          certificate = await this.findUsableCertificate(dto.clienteId, effectiveDocument.estabelecimentoId);
          certificateByEstablishment.set(effectiveDocument.estabelecimentoId, certificate);
        }

        const response = await this.fetchEventosByChaveWithRetry({
          chaveAcesso: effectiveDocument.chaveAcesso,
          ambiente: this.toExternalAmbiente(effectiveDocument.ambiente),
          certificateId: certificate.id
        });
        const statusCode = this.extractStatusCode(response);
        if (this.isNotFoundEventoSyncStatus(statusCode) && this.isAdnSemEventosResponse(response)) {
          detalhes.push({
            documentoId: effectiveDocument.id,
            chaveAcesso: effectiveDocument.chaveAcesso,
            estabelecimentoId: effectiveDocument.estabelecimentoId,
            ambiente: this.toDtoAmbiente(effectiveDocument.ambiente),
            status: 'sem_eventos',
            eventosEncontrados: 0,
            eventosImportados: 0,
            mensagem: 'Nenhum evento encontrado no ADN'
          });
          continue;
        }

        if (this.isNotFoundEventoSyncStatus(statusCode)) {
          const diagnostico = this.buildEventoEndpointDiagnosticWithDocument(response, effectiveDocument);
          this.logger.warn(
            `Consulta de eventos ADN retornou 404 para a chave ${effectiveDocument.chaveAcesso}: ${JSON.stringify(diagnostico)}`
          );
          detalhes.push({
            documentoId: effectiveDocument.id,
            chaveAcesso: effectiveDocument.chaveAcesso,
            estabelecimentoId: effectiveDocument.estabelecimentoId,
            ambiente: this.toDtoAmbiente(effectiveDocument.ambiente),
            status: 'nao_localizado_endpoint_eventos',
            eventosEncontrados: 0,
            eventosImportados: 0,
            mensagem: this.buildEventoEndpointNotFoundMessage(response),
            diagnostico
          });
          continue;
        }

        if (statusCode !== undefined && statusCode !== 200) {
          falhas += 1;
          detalhes.push({
            documentoId: effectiveDocument.id,
            chaveAcesso: effectiveDocument.chaveAcesso,
            estabelecimentoId: effectiveDocument.estabelecimentoId,
            ambiente: this.toDtoAmbiente(effectiveDocument.ambiente),
            status: 'falha_api',
            eventosEncontrados: 0,
            eventosImportados: 0,
            mensagem: this.extractSyncMessage(response) ?? `Consulta de eventos retornou HTTP ${statusCode}.`
          });
          continue;
        }

        const xmls = this.extractEventoImportXmls(response, effectiveDocument.chaveAcesso);
        const importedBefore = eventosImportados;
        for (const xml of xmls) {
          await this.importXml({
            clienteId: dto.clienteId,
            estabelecimentoId: effectiveDocument.estabelecimentoId,
            ambiente: this.toDtoAmbiente(effectiveDocument.ambiente),
            xml
          });
          eventosImportados += 1;
        }

        if (xmls.length > 0) {
          documentosComEventos += 1;
        }
        eventosEncontrados += xmls.length;
        detalhes.push({
          documentoId: effectiveDocument.id,
          chaveAcesso: effectiveDocument.chaveAcesso,
          estabelecimentoId: effectiveDocument.estabelecimentoId,
          ambiente: this.toDtoAmbiente(effectiveDocument.ambiente),
          status: xmls.length > 0 ? 'sincronizado' : 'sem_eventos',
          eventosEncontrados: xmls.length,
          eventosImportados: eventosImportados - importedBefore,
          mensagem: xmls.length > 0 ? undefined : 'Nenhum evento encontrado no ADN'
        });
      } catch (error) {
        falhas += 1;
        detalhes.push({
          documentoId: document.id,
          chaveAcesso: document.chaveAcesso,
          estabelecimentoId: document.estabelecimentoId,
          ambiente: this.toDtoAmbiente(document.ambiente),
          status: this.isCertificateError(error) ? 'falha_certificado' : 'falha_api',
          eventosEncontrados: 0,
          eventosImportados: 0,
          mensagem: this.toErrorMessage(error)
        });
      }
    }

    return {
      documentosAnalisados: documents.length,
      documentosComEventos,
      eventosEncontrados,
      eventosImportados,
      falhas,
      detalhes
    };
  }

  private async findManyDocumentosForEventoSync(args: Prisma.NfseDocumentoFindManyArgs) {
    try {
      return await this.prisma.nfseDocumento.findMany(args);
    } catch (error) {
      if (!this.isEventosSchemaUnavailable(error)) {
        throw error;
      }

      this.logger.warn(
        'Tabela nfse_eventos indisponivel durante sincronizacao de eventos de NFS-e; repetindo consulta sem filtro relacional.'
      );
      const { where, ...rest } = args;
      return this.prisma.nfseDocumento.findMany({
        ...rest,
        where: this.removeNfseEventosRelationFilter(where)
      });
    }
  }

  private async importNfseXml(dto: ImportXmlDto, parsed: ParsedNfse, origem: DocumentoOrigem) {
    const hash = this.parser.getHash(dto.xml);
    const ambienteSolicitado = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    const ambiente = this.resolveNfseAmbienteFromParsed(parsed, ambienteSolicitado);
    const existing = await this.findDocumentoByChaveAnyAmbiente(parsed.chaveAcesso, ambiente);
    const existingId = existing?.id;
    const previousAmbiente = existing?.ambiente;
    if (existingId && previousAmbiente && previousAmbiente !== ambiente) {
      this.logger.warn(
        `NFS-e ${parsed.chaveAcesso} importada com tpAmb=${parsed.tpAmb ?? 'desconhecido'}; corrigindo ambiente de ${previousAmbiente} para ${ambiente}.`
      );
    }
    const existingWithEventos = existingId
      ? await this.prisma.nfseDocumento.findUnique({
          where: { id: existingId },
          include: {
            eventos: true
          }
        })
      : null;
    const existingResolved = existingWithEventos && previousAmbiente && previousAmbiente !== ambiente
      ? await this.reclassifyDocumentoAmbiente(existingWithEventos, ambiente)
      : existingWithEventos;
    const existingForUpdate = existingResolved ?? existingWithEventos;
    const cancelamentoDate = this.resolveCancelamentoDate(existingForUpdate);
    const hasCancelamento = this.hasCancelamento(existingForUpdate);

    const date = parsed.dataEmissao ?? new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const cnpj = parsed.cnpjPrestador ?? parsed.cnpjTomador ?? 'desconhecido';
    const status = hasCancelamento ? 'cancelada' : this.normalizeStatus(parsed.status) ?? 'autorizada';

    const xmlKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/xml/${parsed.chaveAcesso}.xml`;
    await this.storage.putObject(xmlKey, dto.xml);
    const danfseKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/danfse/${parsed.chaveAcesso}.pdf`;
    const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
      municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
      municipioPrestacaoNome: parsed.municipioPrestacaoNome,
      cnpjPrestador: parsed.cnpjPrestador
    });
    const municipioFallback = await this.buildDanfseMunicipioFallback({
      cnpjPrestador: parsed.cnpjPrestador,
      cnpjTomador: parsed.cnpjTomador,
      municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
      municipioPrestacaoNome
    });
    const danfsePdf = this.danfse.generateFromXml(dto.xml, {
      chaveAcesso: parsed.chaveAcesso,
      numeroNfse: parsed.numeroNfse,
      dataEmissao: parsed.dataEmissao,
      status,
      cnpjPrestador: parsed.cnpjPrestador,
      razaoSocialPrestador: parsed.razaoSocialPrestador,
      cnpjTomador: parsed.cnpjTomador,
      razaoSocialTomador: parsed.razaoSocialTomador,
      ...municipioFallback,
      valorServico: parsed.valorServico,
      descricaoServico: parsed.descricaoServico
    });
    await this.storage.putObject(danfseKey, danfsePdf);

    const competencia = parsed.competencia ?? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

    const nfse = existingId
      ? await this.prisma.nfseDocumento.update({
          where: { id: existingId },
          data: {
            clienteId: dto.clienteId,
            estabelecimentoId: dto.estabelecimentoId,
            ambiente,
            nsu: null,
            numeroNfse: parsed.numeroNfse,
            serie: parsed.serie,
            dataEmissao: parsed.dataEmissao,
            status,
            dataCancelamento: cancelamentoDate ?? undefined,
            cnpjPrestador: parsed.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador,
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
            municipioPrestacaoNome,
            valorServico: this.toDecimal(parsed.valorServico),
            valorDeducoes: this.toDecimal(parsed.valorDeducoes),
            valorIss: this.toDecimal(parsed.valorIss),
            aliquotaIss: this.toDecimal(parsed.aliquotaIss),
            codigoServicoNacional: parsed.codigoServicoNacional,
            itemListaServico: parsed.itemListaServico,
            descricaoServico: parsed.descricaoServico,
            xmlPath: xmlKey,
            danfsePath: danfseKey,
            hashXml: hash,
            competencia,
            origem
          }
        })
      : await this.prisma.nfseDocumento.create({
          data: {
            clienteId: dto.clienteId,
            estabelecimentoId: dto.estabelecimentoId,
            ambiente,
            nsu: null,
            chaveAcesso: parsed.chaveAcesso,
            numeroNfse: parsed.numeroNfse,
            serie: parsed.serie,
            dataEmissao: parsed.dataEmissao,
            status,
            dataCancelamento: cancelamentoDate ?? undefined,
            cnpjPrestador: parsed.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador,
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo,
            municipioPrestacaoNome,
            valorServico: this.toDecimal(parsed.valorServico),
            valorDeducoes: this.toDecimal(parsed.valorDeducoes),
            valorIss: this.toDecimal(parsed.valorIss),
            aliquotaIss: this.toDecimal(parsed.aliquotaIss),
            codigoServicoNacional: parsed.codigoServicoNacional,
            itemListaServico: parsed.itemListaServico,
            descricaoServico: parsed.descricaoServico,
            xmlPath: xmlKey,
            danfsePath: danfseKey,
            hashXml: hash,
            competencia,
            origem
          }
        });

    return {
      id: nfse.id,
      chaveAcesso: nfse.chaveAcesso,
      tipo: 'nfse',
      origem: nfse.origem,
      xmlPath: nfse.xmlPath,
      danfsePath: nfse.danfsePath
    };
  }

  private async upsertDocumentoForEvento(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: Ambiente;
    evento: ParsedNfseEvento;
    origem: DocumentoOrigem;
  }) {
    const cancelamentoData = this.buildCancelamentoDocumentoData(params.evento);

    return this.prisma.nfseDocumento.upsert({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: params.evento.chaveAcesso
        }
      },
      update: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        nsu: null,
        ...cancelamentoData
      },
      create: {
        clienteId: params.clienteId,
        estabelecimentoId: params.estabelecimentoId,
        ambiente: params.ambiente,
        nsu: null,
        chaveAcesso: params.evento.chaveAcesso,
        ...cancelamentoData,
        origem: params.origem
      }
    });
  }

  private async findDocumentoForEvento(params: {
    clienteId: string;
    chaveAcesso: string;
    ambientePreferencial: Ambiente;
  }): Promise<NfseDocumento | null> {
    const candidates = await this.prisma.nfseDocumento.findMany({
      where: {
        clienteId: params.clienteId,
        chaveAcesso: params.chaveAcesso
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 10
    });

    return this.chooseDocumentoForEvento(candidates, params.ambientePreferencial);
  }

  private chooseDocumentoForEvento(candidates: NfseDocumento[], ambientePreferencial: Ambiente): NfseDocumento | null {
    const exactWithXml = candidates.find(
      (doc) => doc.ambiente === ambientePreferencial && this.hasDocumentoFiscalData(doc)
    );
    if (exactWithXml) {
      return exactWithXml;
    }

    const anyWithXml = candidates.find((doc) => this.hasDocumentoFiscalData(doc));
    if (anyWithXml) {
      return anyWithXml;
    }

    return candidates.find((doc) => doc.ambiente === ambientePreferencial) ?? candidates[0] ?? null;
  }

  private hasDocumentoFiscalData(doc: Pick<NfseDocumento, 'xmlPath' | 'numeroNfse' | 'dataEmissao'>): boolean {
    return Boolean(doc.xmlPath || doc.numeroNfse || doc.dataEmissao);
  }

  private async upsertEvento(
    nfseDocumentoId: string,
    evento: ParsedNfseEvento,
    xmlPath: string,
    hashXml: string
  ) {
    const tipoEvento = evento.tipoEvento || 'evento';
    const dataEvento = evento.dataEvento ?? new Date(0);

    return this.prisma.nfseEvento.upsert({
      where: {
        chaveAcesso_tipoEvento_dataEvento_hashXml: {
          chaveAcesso: evento.chaveAcesso,
          tipoEvento,
          dataEvento,
          hashXml
        }
      },
      update: {
        nfseDocumentoId,
        descricao: evento.descricao,
        xmlPath
      },
      create: {
        nfseDocumentoId,
        chaveAcesso: evento.chaveAcesso,
        tipoEvento,
        dataEvento,
        descricao: evento.descricao,
        xmlPath,
        hashXml
      }
    });
  }

  private buildCancelamentoDocumentoData(
    evento: ParsedNfseEvento
  ): { status?: string; dataCancelamento?: Date; danfsePath?: string | null } {
    if (!this.isEventoCancelamento(evento)) {
      return {};
    }

    return {
      status: 'cancelada',
      dataCancelamento: evento.dataEvento ?? new Date(),
      danfsePath: null
    };
  }

  private hasCancelamento(
    doc:
      | {
          status?: string | null;
          dataCancelamento?: Date | null;
          eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
        }
      | null
      | undefined
  ): boolean {
    if (!doc) {
      return false;
    }

    return (
      this.normalizeStatus(doc.status ?? undefined) === 'cancelada' ||
      Boolean(doc.dataCancelamento) ||
      (doc.eventos ?? []).some((evento) => this.isEventoCancelamento(evento))
    );
  }

  private resolveCancelamentoDate(
    doc:
      | {
          dataCancelamento?: Date | null;
          eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
        }
      | null
      | undefined
  ): Date | undefined {
    return (
      doc?.dataCancelamento ??
      (doc?.eventos ?? []).find((evento) => this.isEventoCancelamento(evento))?.dataEvento ??
      undefined
    );
  }

  private isEventoCancelamento(evento: {
    tipoEvento?: string | null;
    descricao?: string | null;
    isCancelamento?: boolean;
  }): boolean {
    const tipoEvento = this.normalizeSearchText(evento.tipoEvento ?? undefined);
    const descricao = this.normalizeSearchText(evento.descricao ?? undefined);

    return (
      Boolean(evento.isCancelamento) ||
      tipoEvento === 'e101101' ||
      tipoEvento.includes('cancelamento') ||
      tipoEvento.includes('cancelada') ||
      descricao.includes('cancelamento') ||
      descricao.includes('cancelada')
    );
  }

  private async importEventoXml(dto: ImportXmlDto, evento: ParsedNfseEvento) {
    const ambienteDto = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;
    const hash = this.parser.getHash(dto.xml);
    const dataReferencia = evento.dataEvento ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const existing = await this.findDocumentoForEvento({
      clienteId: dto.clienteId,
      chaveAcesso: evento.chaveAcesso,
      ambientePreferencial: ambienteDto
    });
    const ambiente = existing?.ambiente ?? ambienteDto;
    const cnpj =
      this.normalizeCnpj(evento.cnpjAutor) ??
      this.normalizeCnpj(existing?.cnpjPrestador) ??
      this.normalizeCnpj(existing?.cnpjTomador) ??
      'desconhecido';
    const xmlKey = `nfse/${ambiente}/${cnpj}/${year}/${month}/eventos/${this.toSafeFileName(
      evento.chaveAcesso
    )}_${this.toSafeFileName(evento.tipoEvento)}.xml`;

    await this.storage.putObject(xmlKey, dto.xml);

    const nfse = await this.upsertDocumentoForEvento({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      evento,
      origem: DocumentoOrigem.importacao_xml
    });
    const eventoSalvo = await this.upsertEvento(nfse.id, evento, xmlKey, hash);

    return {
      id: nfse.id,
      chaveAcesso: nfse.chaveAcesso,
      tipo: 'evento',
      origem: nfse.origem,
      status: nfse.status,
      dataCancelamento: nfse.dataCancelamento,
      eventoId: eventoSalvo.id,
      tipoEvento: eventoSalvo.tipoEvento,
      eventoXmlPath: eventoSalvo.xmlPath,
      xmlPath: nfse.xmlPath,
      danfsePath: nfse.danfsePath
    };
  }

  async reprocessarXmls(dto: ReprocessarXmlsDto) {
    const limit = dto.limit ?? 200;
    const somenteIncompletos = dto.somenteIncompletos ?? true;
    const regenerarDanfse = dto.regenerarDanfse ?? true;

    const conditions: Prisma.NfseDocumentoWhereInput[] = [
      {
        xmlPath: {
          not: null
        }
      }
    ];

    if (dto.clienteId) {
      conditions.push({ clienteId: dto.clienteId });
    }

    if (dto.estabelecimentoId) {
      conditions.push({ estabelecimentoId: dto.estabelecimentoId });
    }

    if (dto.ambiente) {
      conditions.push({ ambiente: dto.ambiente === 'producao' ? Ambiente.producao : Ambiente.producao_restrita });
    }

    if (somenteIncompletos) {
      conditions.push({
        OR: [
          { numeroNfse: null },
          { dataEmissao: null },
          { cnpjPrestador: null },
          { razaoSocialPrestador: null },
          { cnpjTomador: null },
          { razaoSocialTomador: null },
          { valorServico: null },
          { descricaoServico: null },
          { codigoServicoNacional: null },
          { danfsePath: null }
        ]
      });
    }

    const where: Prisma.NfseDocumentoWhereInput =
      conditions.length === 1
        ? conditions[0]
        : {
            AND: conditions
          };

    const docs = await this.prisma.nfseDocumento.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      include: this.nfseDocumentoInclude()
    });

    let processados = 0;
    let atualizados = 0;
    let falhas = 0;
    const erros: Array<{ id: string; chaveAcesso: string; erro: string }> = [];

    for (const doc of docs) {
      processados += 1;

      try {
        if (!doc.xmlPath) {
          throw new Error('Documento sem xmlPath');
        }

        const xml = (await this.storage.getObject(doc.xmlPath)).toString('utf8');
        const parsed = this.parser.parse(xml);
        const hash = this.parser.getHash(xml);
        const hasCancelamento = this.hasCancelamento(doc);
        const cancelamentoDate = this.resolveCancelamentoDate(doc);
        const status = hasCancelamento ? 'cancelada' : this.normalizeStatus(parsed.status) ?? doc.status;
        const dataReferencia = parsed.dataEmissao ?? doc.dataEmissao ?? doc.createdAt ?? new Date();
        const competencia =
          parsed.competencia ??
          (parsed.dataEmissao ? new Date(Date.UTC(parsed.dataEmissao.getUTCFullYear(), parsed.dataEmissao.getUTCMonth(), 1)) : undefined);
        const cnpj =
          this.normalizeCnpj(parsed.cnpjPrestador) ??
          this.normalizeCnpj(parsed.cnpjTomador) ??
          this.normalizeCnpj(doc.cnpjPrestador) ??
          this.normalizeCnpj(doc.cnpjTomador) ??
          'desconhecido';
        const year = dataReferencia.getUTCFullYear();
        const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
        const danfseKey = `nfse/${doc.ambiente}/${cnpj}/${year}/${month}/danfse/${doc.chaveAcesso}.pdf`;

        if (regenerarDanfse) {
          const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo ?? doc.municipioPrestacaoCodigo,
            municipioPrestacaoNome: parsed.municipioPrestacaoNome ?? doc.municipioPrestacaoNome,
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador
          });
          const municipioFallback = await this.buildDanfseMunicipioFallback({
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo ?? doc.municipioPrestacaoCodigo,
            municipioPrestacaoNome
          });
          const pdf = this.danfse.generateFromXml(xml, {
            chaveAcesso: doc.chaveAcesso,
            numeroNfse: parsed.numeroNfse ?? doc.numeroNfse,
            dataEmissao: parsed.dataEmissao ?? doc.dataEmissao,
            status,
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador ?? doc.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador ?? doc.razaoSocialTomador,
            ...municipioFallback,
            valorServico: parsed.valorServico ?? doc.valorServico?.toString(),
            descricaoServico: parsed.descricaoServico ?? doc.descricaoServico
          });
          await this.storage.putObject(danfseKey, pdf);
        }

        const municipioPrestacaoNome = await this.resolveMunicipioPrestacaoNome({
          municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo ?? doc.municipioPrestacaoCodigo,
          municipioPrestacaoNome: parsed.municipioPrestacaoNome ?? doc.municipioPrestacaoNome,
          cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador
        });
        await this.prisma.nfseDocumento.update({
          where: { id: doc.id },
          data: {
            numeroNfse: parsed.numeroNfse ?? doc.numeroNfse,
            serie: parsed.serie ?? doc.serie,
            dataEmissao: parsed.dataEmissao ?? doc.dataEmissao,
            competencia: competencia ?? doc.competencia,
            status,
            dataCancelamento: cancelamentoDate ?? doc.dataCancelamento,
            cnpjPrestador: parsed.cnpjPrestador ?? doc.cnpjPrestador,
            razaoSocialPrestador: parsed.razaoSocialPrestador ?? doc.razaoSocialPrestador,
            cnpjTomador: parsed.cnpjTomador ?? doc.cnpjTomador,
            razaoSocialTomador: parsed.razaoSocialTomador ?? doc.razaoSocialTomador,
            municipioPrestacaoCodigo: parsed.municipioPrestacaoCodigo ?? doc.municipioPrestacaoCodigo,
            municipioPrestacaoNome: municipioPrestacaoNome ?? doc.municipioPrestacaoNome,
            valorServico: this.toDecimal(parsed.valorServico) ?? doc.valorServico,
            valorDeducoes: this.toDecimal(parsed.valorDeducoes) ?? doc.valorDeducoes,
            valorIss: this.toDecimal(parsed.valorIss) ?? doc.valorIss,
            aliquotaIss: this.toDecimal(parsed.aliquotaIss) ?? doc.aliquotaIss,
            codigoServicoNacional: parsed.codigoServicoNacional ?? doc.codigoServicoNacional,
            itemListaServico: parsed.itemListaServico ?? doc.itemListaServico,
            descricaoServico: parsed.descricaoServico ?? doc.descricaoServico,
            hashXml: hash,
            danfsePath: regenerarDanfse ? danfseKey : doc.danfsePath
          }
        });

        atualizados += 1;
      } catch (error) {
        falhas += 1;
        const message = error instanceof Error ? error.message : String(error);
        erros.push({
          id: doc.id,
          chaveAcesso: doc.chaveAcesso,
          erro: message
        });
      }
    }

    return {
      filtros: {
        clienteId: dto.clienteId ?? null,
        estabelecimentoId: dto.estabelecimentoId ?? null,
        ambiente: dto.ambiente ?? null,
        somenteIncompletos,
        regenerarDanfse,
        limit
      },
      totalSelecionados: docs.length,
      processados,
      atualizados,
      falhas,
      erros
    };
  }

  async reprocessarDanfses(dto: ReprocessarDanfsesDto) {
    const lote = dto.lote ?? 100;
    const somenteLegadas = dto.somenteLegadas ?? true;
    const limit = dto.limit;
    const where = this.buildReprocessarDanfsesWhere(dto);

    let lastId: string | undefined;
    let remaining = limit ?? Number.POSITIVE_INFINITY;
    let processados = 0;
    let regeneradas = 0;
    let ignoradas = 0;
    let falhas = 0;
    const erros: Array<{ id: string; chaveAcesso: string; erro: string }> = [];

    while (remaining > 0) {
      const take = Math.min(lote, remaining);
      const docs = await this.prisma.nfseDocumento.findMany({
        where: lastId
          ? {
              AND: [where, { id: { gt: lastId } }]
            }
          : where,
        orderBy: { id: 'asc' },
        take,
        include: this.nfseDocumentoInclude()
      });

      if (!docs.length) {
        break;
      }

      for (const doc of docs) {
        lastId = doc.id;
        processados += 1;
        remaining -= 1;

        try {
          const shouldRegenerate = await this.shouldRegenerateDanfse(doc, somenteLegadas);
          if (!shouldRegenerate) {
            ignoradas += 1;
            continue;
          }

          await this.regenerateDanfseFile(doc);
          regeneradas += 1;
        } catch (error) {
          falhas += 1;
          erros.push({
            id: doc.id,
            chaveAcesso: doc.chaveAcesso,
            erro: this.toErrorMessage(error)
          });
        }
      }

      if (docs.length < take) {
        break;
      }
    }

    return {
      filtros: {
        clienteId: dto.clienteId ?? null,
        estabelecimentoId: dto.estabelecimentoId ?? null,
        ambiente: dto.ambiente ?? null,
        somenteLegadas,
        limit: limit ?? null,
        lote
      },
      processados,
      regeneradas,
      ignoradas,
      falhas,
      erros
    };
  }

  async downloadLote(dto: DownloadLoteDto) {
    const uniqueIds = [...new Set(dto.ids)];
    const tipoArquivo = dto.tipoArquivo ?? 'ambos';

    const docs = await this.prisma.nfseDocumento.findMany({
      where: {
        id: {
          in: uniqueIds
        },
        clienteId: dto.clienteId ?? undefined
      },
      include: {
        eventos: {
          orderBy: [{ dataEvento: 'asc' }, { createdAt: 'asc' }]
        }
      }
    });

    if (docs.length === 0) {
      throw new NotFoundException('Nenhuma NFS-e encontrada para os IDs informados');
    }

    const docsById = new Set(docs.map((doc) => doc.id));
    const idsNaoEncontrados = uniqueIds.filter((id) => !docsById.has(id));
    const errors: Array<{ id: string; erro: string }> = [];
    const zip = new JSZip();
    let totalArquivosIncluidos = 0;

    for (const doc of docs) {
      if (tipoArquivo === 'ambos' || tipoArquivo === 'xml') {
        if (!doc.xmlPath) {
          errors.push({ id: doc.id, erro: 'XML nao disponivel para esta NFS-e' });
        } else {
          try {
            const xmlBuffer = await this.storage.getObject(doc.xmlPath);
            zip.file(`xml/NFSE-${this.toSafeFileName(doc.chaveAcesso)}.xml`, xmlBuffer);
            totalArquivosIncluidos += 1;
          } catch (error) {
            errors.push({ id: doc.id, erro: `Falha ao ler XML: ${this.toErrorMessage(error)}` });
          }
        }

        for (const evento of doc.eventos ?? []) {
          if (!evento.xmlPath) {
            continue;
          }

          try {
            const eventoXmlBuffer = await this.storage.getObject(evento.xmlPath);
            zip.file(this.buildEventoZipEntryPath(doc.chaveAcesso, evento), eventoXmlBuffer);
            totalArquivosIncluidos += 1;
          } catch (error) {
            errors.push({
              id: doc.id,
              erro: `Falha ao ler XML do evento ${evento.tipoEvento || evento.id}: ${this.toErrorMessage(error)}`
            });
          }
        }
      }

      if (tipoArquivo === 'ambos' || tipoArquivo === 'danfse') {
        try {
          const { pdf } = await this.ensureDanfseFile(doc);
          zip.file(`danfse/DANFSE-${this.toSafeFileName(doc.chaveAcesso)}.pdf`, pdf);
          totalArquivosIncluidos += 1;
        } catch (error) {
          errors.push({ id: doc.id, erro: `Falha ao obter DANFSE: ${this.toErrorMessage(error)}` });
        }
      }
    }

    if (totalArquivosIncluidos === 0) {
      throw new NotFoundException('Nenhum arquivo disponivel para os filtros informados');
    }

    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          geradoEm: new Date().toISOString(),
          tipoArquivo,
          totalSolicitados: uniqueIds.length,
          totalDocumentosEncontrados: docs.length,
          totalArquivosIncluidos,
          idsNaoEncontrados,
          erros: errors
        },
        null,
        2
      )
    );

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const fileName = `nfse-lote-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

    return {
      fileName,
      contentType: 'application/zip',
      contentBase64: zipBuffer.toString('base64'),
      totalSolicitados: uniqueIds.length,
      totalDocumentosEncontrados: docs.length,
      totalArquivosIncluidos,
      idsNaoEncontrados,
      erros: errors
    };
  }

  private buildReprocessarDanfsesWhere(dto: ReprocessarDanfsesDto): Prisma.NfseDocumentoWhereInput {
    const conditions: Prisma.NfseDocumentoWhereInput[] = [
      {
        xmlPath: {
          not: null
        }
      }
    ];

    if (dto.clienteId) {
      conditions.push({ clienteId: dto.clienteId });
    }

    if (dto.estabelecimentoId) {
      conditions.push({ estabelecimentoId: dto.estabelecimentoId });
    }

    if (dto.ambiente) {
      conditions.push({ ambiente: dto.ambiente === 'producao' ? Ambiente.producao : Ambiente.producao_restrita });
    }

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  private buildEventoZipEntryPath(
    chaveAcesso: string,
    evento: { id: string; tipoEvento?: string | null; dataEvento?: Date | null; xmlPath?: string | null }
  ): string {
    const tipoEvento = this.toSafeFileName((evento.tipoEvento ?? 'evento').trim() || 'evento');
    const dataEvento = evento.dataEvento ? evento.dataEvento.toISOString().replace(/[:.]/g, '-') : 'sem-data';
    const fallbackFileName = `NFSE-EVENTO-${this.toSafeFileName(chaveAcesso)}-${tipoEvento}-${dataEvento}.xml`;
    const originalFileName = evento.xmlPath?.split('/').filter(Boolean).pop();

    return `xml/eventos/${originalFileName ? this.toSafeFileName(originalFileName) : fallbackFileName}`;
  }

  private async ensureDanfseFile(
    doc: NfseDocumento & {
      eventos?: Array<{ tipoEvento?: string | null; descricao?: string | null; dataEvento?: Date | null }>;
      dataCancelamento?: Date | null;
      status?: string | null;
    }
  ): Promise<{ danfsePath: string; pdf: Buffer }> {
    if (this.hasCancelamento(doc)) {
      return this.regenerateDanfseFile(doc);
    }

    if (doc.danfsePath) {
      try {
        const existingPdf = await this.storage.getObject(doc.danfsePath);
        if (!this.isLegacyDanfse(existingPdf)) {
          return { danfsePath: doc.danfsePath, pdf: existingPdf };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('ENOENT')) {
          throw error;
        }
      }
    }

    return this.regenerateDanfseFile(doc);
  }

  private async shouldRegenerateDanfse(doc: NfseDocumento, somenteLegadas: boolean): Promise<boolean> {
    if (!somenteLegadas) {
      return true;
    }

    if (!doc.danfsePath) {
      return true;
    }

    try {
      const existingPdf = await this.storage.getObject(doc.danfsePath);
      return this.isLegacyDanfse(existingPdf);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        return true;
      }
      throw error;
    }
  }

  private async regenerateDanfseFile(doc: NfseDocumento): Promise<{ danfsePath: string; pdf: Buffer }> {
    if (!doc.xmlPath) {
      throw new NotFoundException('DANFSe nao disponivel para esta NFS-e');
    }

    let xmlBuffer: Buffer;
    try {
      xmlBuffer = await this.storage.getObject(doc.xmlPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        throw new NotFoundException('XML nao disponivel para gerar DANFSe');
      }
      throw error;
    }
    const xml = xmlBuffer.toString('utf8');
    const periodBaseDate = doc.dataEmissao ?? doc.createdAt ?? new Date();
    const year = periodBaseDate.getUTCFullYear();
    const month = String(periodBaseDate.getUTCMonth() + 1).padStart(2, '0');
    const cnpj =
      this.normalizeCnpj(doc.cnpjPrestador) ??
      this.normalizeCnpj(doc.cnpjTomador) ??
      'desconhecido';
    const danfseKey = `nfse/${doc.ambiente}/${cnpj}/${year}/${month}/danfse/${doc.chaveAcesso}.pdf`;

    const municipioFallback = await this.buildDanfseMunicipioFallback({
      cnpjPrestador: doc.cnpjPrestador,
      cnpjTomador: doc.cnpjTomador,
      municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo,
      municipioPrestacaoNome: await this.resolveMunicipioPrestacaoNome({
        municipioPrestacaoCodigo: doc.municipioPrestacaoCodigo,
        municipioPrestacaoNome: doc.municipioPrestacaoNome,
        cnpjPrestador: doc.cnpjPrestador
      })
    });
    const pdf = this.danfse.generateFromXml(xml, {
      chaveAcesso: doc.chaveAcesso,
      numeroNfse: doc.numeroNfse,
      dataEmissao: doc.dataEmissao,
      status: doc.status,
      cnpjPrestador: doc.cnpjPrestador,
      razaoSocialPrestador: doc.razaoSocialPrestador,
      cnpjTomador: doc.cnpjTomador,
      razaoSocialTomador: doc.razaoSocialTomador,
      ...municipioFallback,
      valorServico: doc.valorServico?.toString(),
      descricaoServico: doc.descricaoServico
    });

    await this.storage.putObject(danfseKey, pdf);

    if (doc.danfsePath !== danfseKey) {
      await this.prisma.nfseDocumento.update({
        where: { id: doc.id },
        data: { danfsePath: danfseKey }
      });
    }

    return { danfsePath: danfseKey, pdf };
  }

  private isLegacyDanfse(pdf: Buffer): boolean {
    if (!pdf.length) {
      return true;
    }

    return !pdf.includes(Buffer.from('DANFSE - pagina', 'utf8'));
  }

  private async buildDanfseMunicipioFallback(params: {
    cnpjPrestador?: string | null;
    cnpjTomador?: string | null;
    municipioPrestacaoCodigo?: string | null;
    municipioPrestacaoNome?: string | null;
  }): Promise<
    Pick<
      DanfseRenderInput,
      | 'municipioPrestador'
      | 'municipioTomador'
      | 'municipioPrestacaoCodigo'
      | 'municipioPrestacaoNome'
      | 'localPrestacao'
      | 'municipioIncidenciaIssqn'
    >
  > {
    const [municipioPrestador, municipioTomador] = await Promise.all([
      this.resolveMunicipioNomeByCnpj(params.cnpjPrestador),
      this.resolveMunicipioNomeByCnpj(params.cnpjTomador)
    ]);
    const municipioPrestacaoNome =
      (await this.resolveMunicipioPrestacaoNome({
        municipioPrestacaoCodigo: params.municipioPrestacaoCodigo,
        municipioPrestacaoNome: params.municipioPrestacaoNome,
        cnpjPrestador: params.cnpjPrestador
      })) ?? undefined;

    return {
      municipioPrestador: municipioPrestador ?? municipioPrestacaoNome,
      municipioTomador,
      municipioPrestacaoCodigo: params.municipioPrestacaoCodigo ?? undefined,
      municipioPrestacaoNome,
      localPrestacao: municipioPrestacaoNome,
      municipioIncidenciaIssqn: municipioPrestacaoNome
    };
  }

  private async resolveMunicipioPrestacaoNome(params: {
    municipioPrestacaoCodigo?: string | null;
    municipioPrestacaoNome?: string | null;
    cnpjPrestador?: string | null;
  }): Promise<string | undefined> {
    const municipioPrestacaoCodigo = this.normalizeMunicipioCodigoIbge(params.municipioPrestacaoCodigo);
    const municipioPrestacaoNome = params.municipioPrestacaoNome?.trim() || undefined;

    if (municipioPrestacaoNome && !this.looksLikeMunicipioCode(municipioPrestacaoNome, municipioPrestacaoCodigo)) {
      return municipioPrestacaoNome;
    }

    const resolvedByCode = await this.resolveMunicipioNomeByCodigoIbge(municipioPrestacaoCodigo);
    if (resolvedByCode) {
      return resolvedByCode;
    }

    const resolvedByCnpj = await this.resolveMunicipioNomeByCnpj(params.cnpjPrestador);
    if (resolvedByCnpj) {
      return resolvedByCnpj;
    }

    return municipioPrestacaoNome;
  }

  private async resolveMunicipioNomeByCnpj(cnpj?: string | null): Promise<string | undefined> {
    const normalizedCnpj = this.normalizeCnpj(cnpj);
    if (!normalizedCnpj) {
      return undefined;
    }

    const estabelecimento = await this.prisma.clienteEstabelecimento.findFirst({
      where: {
        cnpj: normalizedCnpj,
        municipioNome: {
          not: null
        }
      },
      select: {
        municipioNome: true
      }
    });

    const municipio = estabelecimento?.municipioNome?.trim();
    return municipio || undefined;
  }

  private async resolveMunicipioNomeByCodigoIbge(codigoIbge?: string | null): Promise<string | undefined> {
    const normalizedCodigoIbge = this.normalizeMunicipioCodigoIbge(codigoIbge);
    if (!normalizedCodigoIbge) {
      return undefined;
    }

    const estabelecimento = await this.prisma.clienteEstabelecimento.findFirst({
      where: {
        municipioCodigoIbge: normalizedCodigoIbge,
        municipioNome: {
          not: null
        }
      },
      select: {
        municipioNome: true
      }
    });

    const municipio = estabelecimento?.municipioNome?.trim();
    return municipio || undefined;
  }

  private normalizeMunicipioCodigoIbge(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits.length >= 6 ? digits : undefined;
  }

  private looksLikeMunicipioCode(value?: string | null, codigoIbge?: string | null): boolean {
    const trimmed = value?.trim();
    if (!trimmed) {
      return false;
    }

    const digits = trimmed.replace(/\D/g, '');
    const normalizedCodigoIbge = this.normalizeMunicipioCodigoIbge(codigoIbge);
    return /^\d{6,7}$/.test(digits) && (!normalizedCodigoIbge || digits === normalizedCodigoIbge);
  }

  private toDecimal(value?: string): Prisma.Decimal | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    const sanitized =
      normalized.includes(',') && normalized.includes('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(',', '.');

    if (!/^-?\d+(\.\d+)?$/.test(sanitized)) {
      return undefined;
    }

    return new Prisma.Decimal(sanitized);
  }

  private normalizeStatus(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (normalized === '100') {
      return 'autorizada';
    }

    if (normalized === '101') {
      return 'cancelada';
    }

    return normalized;
  }

  private toSafeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async fetchEventosByChaveWithRetry(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<unknown> {
    let attempt = 0;

    while (true) {
      await this.waitForEventRequestSlot();
      const response = await this.adnClient.getEventosByChave(params);
      const statusCode = this.extractStatusCode(response);
      if (statusCode !== 429 || attempt >= this.eventRateLimitRetryCount) {
        return response;
      }

      attempt += 1;
      await this.delay(this.eventRateLimitRetryDelayMs);
    }
  }

  private async waitForEventRequestSlot(): Promise<void> {
    if (this.eventRequestIntervalMs <= 0) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastEventRequestAtMs;
    if (elapsed < this.eventRequestIntervalMs) {
      await this.delay(this.eventRequestIntervalMs - elapsed);
    }

    this.lastEventRequestAtMs = Date.now();
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private readPositiveNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  private readBoundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, parsed));
  }

  private normalizeRecoveryGaps(
    gaps: Array<{ ambiente?: 'producao' | 'producao_restrita'; serie?: string | null; numeroInicial: number; numeroFinal: number }>,
    ambientePadrao?: 'producao' | 'producao_restrita'
  ): RecuperacaoDpsGap[] {
    const normalized: RecuperacaoDpsGap[] = [];

    for (const gap of gaps ?? []) {
      const numeroInicial = Math.trunc(Number(gap?.numeroInicial || 0));
      const numeroFinal = Math.trunc(Number(gap?.numeroFinal || 0));
      if (numeroInicial <= 0 || numeroFinal < numeroInicial) {
        continue;
      }

      const ambienteRaw = String(gap?.ambiente || ambientePadrao || 'producao').trim();
      normalized.push({
        ambiente: ambienteRaw === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao,
        serie: this.normalizeSerie(gap?.serie),
        numeroInicial,
        numeroFinal
      });
    }

    return normalized;
  }

  private async loadRecoveryDocsByDps(
    clienteId: string,
    cnpjPrestador: string,
    gaps: RecuperacaoDpsGap[]
  ): Promise<Map<string, DocumentoRecoveryNeighbor[]>> {
    const ambientes = [...new Set(gaps.map((gap) => gap.ambiente))];
    const docs = await this.prisma.nfseDocumento.findMany({
      where: {
        clienteId,
        cnpjPrestador,
        ambiente: { in: ambientes },
        numeroNfse: { not: null }
      },
      select: {
        ambiente: true,
        serie: true,
        numeroNfse: true,
        chaveAcesso: true,
        cnpjPrestador: true,
        municipioPrestacaoCodigo: true,
        xmlPath: true
      }
    });

    const index = new Map<string, DocumentoRecoveryNeighbor[]>();
    for (const doc of docs) {
      const key = `${doc.ambiente}:${this.normalizeSerie(doc.serie) ?? ''}`;
      const current = index.get(key) ?? [];
      current.push(doc);
      index.set(key, current);
    }

    for (const [key, docsByKey] of index.entries()) {
      docsByKey.sort(
        (left, right) => (this.parseNumeroNfse(left.numeroNfse) ?? 0) - (this.parseNumeroNfse(right.numeroNfse) ?? 0)
      );
      index.set(key, docsByKey);
    }

    return index;
  }

  private async inferDpsLookupContext(
    docsIndex: Map<string, DocumentoRecoveryNeighbor[]>,
    gap: RecuperacaoDpsGap,
    numeroNfse: number,
    inscricaoFederal: string
  ): Promise<{ ok: true; dpsId: string } | { ok: false; dpsId: string | null; message: string }> {
    const serie = this.normalizeSerie(gap.serie);
    const candidates = serie ? docsIndex.get(`${gap.ambiente}:${serie}`) ?? [] : [];
    const fallbackCandidates = candidates.length
      ? candidates
      : Array.from(docsIndex.entries())
          .filter(([key]) => key.startsWith(`${gap.ambiente}:`))
          .flatMap(([, docs]) => docs);

    const neighbors = this.pickRecoveryNeighbors(fallbackCandidates, numeroNfse);
    if (!neighbors.length) {
      return {
        ok: false,
        dpsId: null,
        message: `Nenhuma NFS-e vizinha foi encontrada no ambiente ${this.toDtoAmbiente(gap.ambiente)} para inferir a DPS da NFS-e ${numeroNfse}.`
      };
    }

    const previousNeighbors = neighbors.filter((neighbor) => (this.parseNumeroNfse(neighbor.numeroNfse) ?? 0) < numeroNfse);
    const nextNeighbors = neighbors.filter((neighbor) => (this.parseNumeroNfse(neighbor.numeroNfse) ?? 0) > numeroNfse);

    const inferredFromPrevious = await this.tryInferDpsFromNeighbors(previousNeighbors, numeroNfse);
    if (inferredFromPrevious) {
      return {
        ok: true,
        dpsId: inferredFromPrevious
      };
    }

    const inferredFromNext = await this.tryInferDpsFromNeighbors(nextNeighbors, numeroNfse);
    if (inferredFromNext) {
      return {
        ok: true,
        dpsId: inferredFromNext
      };
    }

    const fallbackNeighbor = neighbors[0];
    const codigoMunicipioEmissao =
      this.extractMunicipioCodigoFromChaveAcesso(fallbackNeighbor.chaveAcesso) ??
      this.normalizeMunicipioCodigo(fallbackNeighbor.municipioPrestacaoCodigo);
    if (!codigoMunicipioEmissao) {
      return {
        ok: false,
        dpsId: null,
        message: `Nao foi possivel inferir o municipio de emissao a partir da NFS-e vizinha ${fallbackNeighbor.numeroNfse ?? '-'}.`
      };
    }

    const serieFallback = serie ?? this.normalizeSerie(fallbackNeighbor.serie);
    if (!serieFallback) {
      return {
        ok: false,
        dpsId: null,
        message: `Nao foi possivel inferir a serie da DPS a partir da NFS-e vizinha ${fallbackNeighbor.numeroNfse ?? '-'}.`
      };
    }

    return {
      ok: true,
      dpsId: this.buildDpsId({
        codigoMunicipioEmissao,
        inscricaoFederal,
        serie: serieFallback,
        numeroDps: numeroNfse
      })
    };
  }

  private pickRecoveryNeighbors(candidates: DocumentoRecoveryNeighbor[], numeroNfse: number): DocumentoRecoveryNeighbor[] {
    if (!candidates.length) {
      return [];
    }

    return [...candidates].sort((left, right) => {
      const leftNumero = this.parseNumeroNfse(left.numeroNfse) ?? 0;
      const rightNumero = this.parseNumeroNfse(right.numeroNfse) ?? 0;
      const leftDistance = Math.abs(leftNumero - numeroNfse);
      const rightDistance = Math.abs(rightNumero - numeroNfse);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      const leftIsPrevious = leftNumero <= numeroNfse ? 0 : 1;
      const rightIsPrevious = rightNumero <= numeroNfse ? 0 : 1;
      if (leftIsPrevious !== rightIsPrevious) {
        return leftIsPrevious - rightIsPrevious;
      }

      return leftNumero - rightNumero;
    });
  }

  private async loadRecoveryDpsReference(neighbor: DocumentoRecoveryNeighbor): Promise<{
    dpsId: string;
    numeroDps: number;
    numeroNfse: number;
  } | null> {
    if (!neighbor.xmlPath) {
      return null;
    }

    try {
      const xml = (await this.storage.getObject(neighbor.xmlPath)).toString('utf8');
      const parsed = this.parser.parse(xml);
      const dpsId = this.normalizeDpsId(parsed.dpsId);
      const numeroDps = this.parseRecoveryDpsNumber(parsed.numeroDps) ?? this.parseRecoveryDpsNumberFromId(dpsId);
      const numeroNfse = this.parseNumeroNfse(parsed.numeroNfse) ?? this.parseNumeroNfse(neighbor.numeroNfse);
      if (!dpsId || !numeroDps || !numeroNfse) {
        return null;
      }

      return {
        dpsId,
        numeroDps,
        numeroNfse
      };
    } catch (error) {
      this.logger.warn(
        `Falha ao carregar XML da NFS-e vizinha ${neighbor.chaveAcesso} para inferir DPS: ${this.toErrorMessage(error)}`
      );
      return null;
    }
  }

  private async tryInferDpsFromNeighbors(
    neighbors: DocumentoRecoveryNeighbor[],
    numeroNfse: number
  ): Promise<string | null> {
    for (const neighbor of neighbors) {
      const reference = await this.loadRecoveryDpsReference(neighbor);
      if (!reference) {
        continue;
      }

      const delta = numeroNfse - reference.numeroNfse;
      const targetNumeroDps = reference.numeroDps + delta;
      if (targetNumeroDps <= 0) {
        continue;
      }

      return this.replaceDpsSequence(reference.dpsId, targetNumeroDps);
    }

    return null;
  }

  private parseRecoveryDpsNumber(value?: string | null): number | undefined {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) {
      return undefined;
    }

    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private parseRecoveryDpsNumberFromId(dpsId?: string | null): number | undefined {
    const normalized = this.normalizeDpsId(dpsId);
    if (!normalized) {
      return undefined;
    }

    return this.parseRecoveryDpsNumber(normalized.slice(-15));
  }

  private replaceDpsSequence(dpsId: string, numeroDps: number): string {
    const normalized = this.normalizeDpsId(dpsId);
    if (!normalized || normalized.length <= 15) {
      return dpsId;
    }

    const sequence = String(Math.trunc(numeroDps)).padStart(15, '0').slice(-15);
    return `${normalized.slice(0, -15)}${sequence}`;
  }

  private buildDpsId(params: {
    codigoMunicipioEmissao: string;
    inscricaoFederal: string;
    serie: string;
    numeroDps: number;
  }): string {
    const inscricaoFederal = params.inscricaoFederal.replace(/\D/g, '');
    const tipoInscricao = inscricaoFederal.length > 11 ? '2' : '1';
    const inscricaoNormalizada = inscricaoFederal.padStart(14, '0').slice(-14);
    const serie = params.serie.replace(/\D/g, '').padStart(5, '0').slice(-5);
    const numero = String(Math.trunc(params.numeroDps)).replace(/\D/g, '').padStart(15, '0').slice(-15);
    return `DPS${params.codigoMunicipioEmissao}${tipoInscricao}${inscricaoNormalizada}${serie}${numero}`;
  }

  private extractMunicipioCodigoFromChaveAcesso(chaveAcesso?: string | null): string | undefined {
    const normalized = this.normalizeChaveAcesso(chaveAcesso);
    if (!normalized || normalized.length < 7) {
      return undefined;
    }

    return normalized.slice(0, 7);
  }

  private normalizeMunicipioCodigo(value?: string | null): string | undefined {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 7 ? digits : undefined;
  }

  private normalizeDpsId(value?: string | null): string | undefined {
    const trimmed = String(value || '').trim().toUpperCase();
    if (!trimmed) {
      return undefined;
    }

    const exact = trimmed.match(/DPS\d{42}/);
    if (exact?.[0]) {
      return exact[0];
    }

    const digits = trimmed.replace(/\D/g, '');
    return digits.length === 42 ? `DPS${digits}` : undefined;
  }

  private toExternalAmbiente(ambiente: Ambiente): NfseAmbiente {
    return ambiente === Ambiente.producao_restrita ? NfseAmbiente.PRODUCAO_RESTRITA : NfseAmbiente.PRODUCAO;
  }

  private toDtoAmbiente(ambiente: Ambiente): 'producao' | 'producao_restrita' {
    return ambiente === Ambiente.producao_restrita ? 'producao_restrita' : 'producao';
  }

  private resolveNfseAmbienteFromParsed(parsed: Pick<ParsedNfse, 'tpAmb'>, fallback: Ambiente): Ambiente {
    if (parsed.tpAmb === '1') {
      return Ambiente.producao;
    }

    if (parsed.tpAmb === '2') {
      return Ambiente.producao_restrita;
    }

    return fallback;
  }

  private async reconcileDocumentAmbienteBeforeEventSync<
    T extends { id: string; chaveAcesso: string; estabelecimentoId: string; ambiente: Ambiente; xmlPath?: string | null }
  >(document: T): Promise<T> {
    if (!document.xmlPath) {
      return document;
    }

    try {
      const xml = (await this.storage.getObject(document.xmlPath)).toString('utf8');
      const parsed = this.parser.parse(xml);
      const ambienteCorrigido = this.resolveNfseAmbienteFromParsed(parsed, document.ambiente);
      if (ambienteCorrigido === document.ambiente) {
        return document;
      }

      await this.prisma.nfseDocumento.update({
        where: { id: document.id },
        data: {
          ambiente: ambienteCorrigido
        }
      });
      this.logger.warn(
        `NFS-e ${document.chaveAcesso} teve ambiente corrigido antes da consulta de eventos: ${document.ambiente} -> ${ambienteCorrigido}.`
      );

      return {
        ...document,
        ambiente: ambienteCorrigido
      };
    } catch (error) {
      this.logger.warn(
        `Falha ao reconciliar ambiente da NFS-e ${document.chaveAcesso} antes da consulta de eventos: ${this.toErrorMessage(error)}`
      );
      return document;
    }
  }

  private async findDocumentoByChaveAnyAmbiente(chaveAcesso: string, preferredAmbiente: Ambiente) {
    const preferred = await this.prisma.nfseDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: preferredAmbiente,
          chaveAcesso
        }
      }
    });
    if (preferred) {
      return preferred;
    }

    return this.prisma.nfseDocumento.findFirst({
      where: {
        chaveAcesso
      }
    });
  }

  private normalizeUniqueChavesAcesso(values: string[]): string[] {
    const keys = new Set<string>();

    for (const value of values) {
      const normalized = this.normalizeChaveAcesso(value);
      if (normalized) {
        keys.add(normalized);
      }
    }

    return Array.from(keys);
  }

  private normalizeChaveAcesso(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
      return undefined;
    }

    const exactKey = trimmed.match(/(\d{50})/);
    if (exactKey?.[1]) {
      return exactKey[1];
    }

    const digits = trimmed.replace(/\D/g, '');
    return digits.length === 50 ? digits : undefined;
  }

  private async resolveRecoveryEstablishment(
    dto: Pick<RecuperarNfsePorChaveDto | RecuperarNfsePorDpsDto, 'clienteId' | 'estabelecimentoId' | 'cnpjConsulta'>
  ): Promise<{ id: string; cnpj: string; municipioCodigoIbge?: string | null }> {
    if (dto.estabelecimentoId) {
      const estabelecimento = await this.prisma.clienteEstabelecimento.findFirst({
        where: {
          id: dto.estabelecimentoId,
          clienteId: dto.clienteId
        },
        select: {
          id: true,
          cnpj: true,
          municipioCodigoIbge: true
        }
      });

      if (!estabelecimento) {
        throw new BadRequestException('Estabelecimento nao encontrado para o cliente informado.');
      }

      return estabelecimento;
    }

    const cnpjConsulta = this.normalizeCnpj(dto.cnpjConsulta);
    if (!cnpjConsulta) {
      throw new BadRequestException('Informe cnpjConsulta ou estabelecimentoId para recuperar NFS-e.');
    }

    const estabelecimento = await this.prisma.clienteEstabelecimento.findFirst({
      where: {
        clienteId: dto.clienteId,
        cnpj: cnpjConsulta
      },
      select: {
        id: true,
        cnpj: true,
        municipioCodigoIbge: true
      }
    });

    if (!estabelecimento) {
      throw new BadRequestException(`Nenhum estabelecimento do cliente foi encontrado para o CNPJ ${cnpjConsulta}.`);
    }

    return estabelecimento;
  }

  private async reclassifyDocumentoAmbiente(
    document: Prisma.NfseDocumentoGetPayload<{ include: { eventos: true } }>,
    targetAmbiente: Ambiente
  ) {
    const conflicting = await this.prisma.nfseDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: targetAmbiente,
          chaveAcesso: document.chaveAcesso
        }
      },
      include: {
        eventos: true
      }
    });

    if (conflicting && conflicting.id !== document.id) {
      return conflicting;
    }

    return this.prisma.nfseDocumento.update({
      where: { id: document.id },
      data: {
        ambiente: targetAmbiente
      },
      include: {
        eventos: true
      }
    });
  }

  private async findUsableCertificate(clienteId: string, estabelecimentoId: string): Promise<{ id: string }> {
    const certificate = await this.prisma.certificado.findFirst({
      where: {
        clienteId,
        estabelecimentoId,
        ativo: true
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        validadeFim: true
      }
    });

    if (!certificate) {
      throw new BadRequestException('Nenhum certificado ativo para o estabelecimento');
    }

    if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
      throw new BadRequestException('Certificado vencido');
    }

    return { id: certificate.id };
  }

  private extractStatusCode(payload: unknown): number | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const candidate = (payload as { statusCode?: unknown; status?: unknown }).statusCode ?? (payload as { status?: unknown }).status;
    return typeof candidate === 'number' ? candidate : undefined;
  }

  private isNotFoundEventoSyncStatus(statusCode: number | undefined): boolean {
    return statusCode === 404;
  }

  private buildEventoEndpointNotFoundMessage(payload: unknown): string {
    const adnErrorDescription = this.extractAdnErrorDescription(payload);
    if (adnErrorDescription) {
      return adnErrorDescription;
    }

    const message = this.extractSyncMessage(payload);
    if (message && !/^not found$/i.test(message.trim())) {
      return message;
    }

    return 'Endpoint de eventos do ADN retornou HTTP 404 para a chave consultada.';
  }

  private isAdnSemEventosResponse(payload: unknown): boolean {
    const data = this.asRecord(this.extractResponseData(payload));
    if (!data) {
      return false;
    }

    const statusProcessamento = this.scalarToString(
      this.readRecordValue(data, ['StatusProcessamento', 'statusProcessamento'])
    );
    if (this.normalizeSearchText(statusProcessamento).includes('nenhumdocumentolocalizado')) {
      return true;
    }

    const errors = this.readRecordValue(data, ['Erros', 'erros']);
    if (!Array.isArray(errors)) {
      return false;
    }

    return errors.some((item) => {
      const record = this.asRecord(item);
      if (!record) {
        return false;
      }

      const codigo = this.scalarToString(this.readRecordValue(record, ['Codigo', 'codigo']));
      if (codigo?.trim().toUpperCase() === 'E2240') {
        return true;
      }

      const descricao = this.scalarToString(this.readRecordValue(record, ['Descricao', 'descricao']));
      return this.normalizeSearchText(descricao).includes('nenhumdocumentolocalizado');
    });
  }

  private buildEventoEndpointDiagnostic(payload: unknown): Record<string, unknown> {
    const headers = this.extractResponseHeaders(payload);

    return {
      statusCode: this.extractStatusCode(payload) ?? null,
      message: this.extractAdnErrorDescription(payload) ?? this.extractSyncMessage(payload) ?? null,
      contentType: this.extractHeaderValue(headers, 'content-type') ?? null,
      requestId:
        this.extractHeaderValue(headers, 'x-request-id') ??
        this.extractHeaderValue(headers, 'x-correlation-id') ??
        this.extractHeaderValue(headers, 'traceparent') ??
        null,
      rawBodyPreview: this.buildPayloadPreview(this.extractRawBody(payload), 1200),
      parsedDataPreview: this.buildPayloadPreview(this.extractResponseData(payload), 1200)
    };
  }

  private buildEventoEndpointDiagnosticWithDocument(
    payload: unknown,
    document: { ambiente: Ambiente; chaveAcesso: string; id: string }
  ): Record<string, unknown> {
    return {
      documentoId: document.id,
      chaveAcesso: document.chaveAcesso,
      ambienteDocumento: this.toDtoAmbiente(document.ambiente),
      ...this.buildEventoEndpointDiagnostic(payload)
    };
  }

  private extractSyncMessage(payload: unknown): string | undefined {
    const values = this.collectRecursiveValues(payload, 100);

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmed = value.trim();
      if (!trimmed || this.parser.isEventoXml(trimmed)) {
        continue;
      }

      const lower = trimmed.toLowerCase();
      if (
        lower.includes('sem evento') ||
        lower.includes('nenhum evento') ||
        lower.includes('mensagem') ||
        lower.includes('erro') ||
        lower.includes('falha')
      ) {
        return trimmed;
      }
    }

    return undefined;
  }

  private extractAdnErrorDescription(payload: unknown): string | undefined {
    const data = this.extractResponseData(payload);
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const errors = (data as { Erros?: unknown; erros?: unknown }).Erros ?? (data as { erros?: unknown }).erros;
    if (!Array.isArray(errors)) {
      return undefined;
    }

    for (const item of errors) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const descricao = (item as { Descricao?: unknown; descricao?: unknown }).Descricao ?? (item as { descricao?: unknown }).descricao;
      const codigo = (item as { Codigo?: unknown; codigo?: unknown }).Codigo ?? (item as { codigo?: unknown }).codigo;
      if (typeof descricao === 'string' && descricao.trim()) {
        const descricaoNormalizada = descricao.replace(/\s+/g, ' ').trim();
        if (typeof codigo === 'string' && codigo.trim()) {
          return `${codigo.trim()} - ${descricaoNormalizada}`;
        }

        return descricaoNormalizada;
      }
    }

    return undefined;
  }

  private extractResponseData(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    return (payload as { data?: unknown }).data;
  }

  private extractRawBody(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const rawBody = (payload as { rawBody?: unknown }).rawBody;
    return typeof rawBody === 'string' ? rawBody : undefined;
  }

  private extractResponseHeaders(payload: unknown): Record<string, unknown> | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const headers = (payload as { headers?: unknown }).headers;
    return headers && typeof headers === 'object' ? (headers as Record<string, unknown>) : undefined;
  }

  private extractHeaderValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
    if (!headers) {
      return undefined;
    }

    const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
    if (typeof value === 'string') {
      return value;
    }

    return Array.isArray(value) ? value.find((item) => typeof item === 'string') : undefined;
  }

  private buildPayloadPreview(payload: unknown, maxLength: number): string | null {
    if (payload === undefined || payload === null) {
      return null;
    }

    const serialized =
      typeof payload === 'string'
        ? payload
        : (() => {
            try {
              return JSON.stringify(payload);
            } catch {
              return String(payload);
            }
          })();
    const normalized = serialized.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  }

  private extractEventoXmls(payload: unknown): string[] {
    const values = this.collectRecursiveValues(payload, 300);
    const xmls: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmed = value.trim();
      if (!trimmed || !this.parser.isEventoXml(trimmed) || seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      xmls.push(trimmed);
    }

    return xmls;
  }

  private extractEventoImportXmls(payload: unknown, chaveAcessoFallback?: string): string[] {
    const xmls = this.extractEventoXmls(payload);
    const seen = new Set<string>();
    const signatures = new Set<string>();

    for (const xml of xmls) {
      seen.add(xml);
      signatures.add(this.buildEventoSignatureFromXml(xml));
    }

    for (const evento of this.extractStructuredEventos(payload, chaveAcessoFallback)) {
      const signature = this.buildEventoSignature(evento);
      if (signatures.has(signature)) {
        continue;
      }

      const xml = this.buildSyntheticEventoXml(evento);
      if (seen.has(xml)) {
        continue;
      }

      seen.add(xml);
      signatures.add(signature);
      xmls.push(xml);
    }

    return xmls;
  }

  private extractStructuredEventos(payload: unknown, chaveAcessoFallback?: string): ParsedNfseEvento[] {
    const values = this.collectRecursiveValues(payload, 300);
    const eventos: ParsedNfseEvento[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const evento = this.tryExtractStructuredEvento(value, chaveAcessoFallback);
      if (!evento) {
        continue;
      }

      const signature = this.buildEventoSignature(evento);
      if (seen.has(signature)) {
        continue;
      }

      seen.add(signature);
      eventos.push(evento);
    }

    return eventos;
  }

  private tryExtractStructuredEvento(payload: unknown, chaveAcessoFallback?: string): ParsedNfseEvento | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const nestedEventEntry = Object.entries(record).find(([key]) => /^e\d{6}$/i.test(key));
    const nestedEventRecord = this.asRecord(nestedEventEntry?.[1]);
    const explicitTipoEvento =
      nestedEventEntry?.[0] ??
      this.scalarToString(
        this.readRecordValue(record, [
          'tipoEvento',
          'tpEvento',
          'cEvento',
          'codigoEvento',
          'codigoTipoEvento',
          'eventoTipo'
        ])
      );
    const descricao =
      this.scalarToString(
        this.readRecordValue(nestedEventRecord, ['xDesc', 'descricao', 'descricaoEvento', 'descEvento'])
      ) ??
      this.scalarToString(
        this.readRecordValue(record, ['xDesc', 'descricao', 'descricaoEvento', 'descEvento', 'mensagem'])
      );
    const motivo =
      this.scalarToString(this.readRecordValue(nestedEventRecord, ['xMotivo', 'motivo', 'motivoEvento'])) ??
      this.scalarToString(this.readRecordValue(record, ['xMotivo', 'motivo', 'motivoEvento']));
    const chaveAcesso =
      this.normalizeChaveAcesso(
        this.scalarToString(this.readRecordValue(record, ['chNFSe', 'chNfse', 'chaveAcesso', 'chave', 'nfseChave']))
      ) ?? this.normalizeChaveAcesso(chaveAcessoFallback);
    const tipoEvento = this.normalizeStructuredTipoEvento(explicitTipoEvento, descricao, motivo);
    const dataEvento = this.parseUnknownDate(
      this.readRecordValue(nestedEventRecord, ['dhEvento', 'dhProc', 'dataEvento', 'dataHoraEvento']) ??
        this.readRecordValue(record, ['dhEvento', 'dhProc', 'dataEvento', 'dataHoraEvento', 'dhRegistro'])
    );
    const cnpjAutor = this.normalizeCnpj(
      this.scalarToString(this.readRecordValue(record, ['CNPJAutor', 'cnpjAutor', 'cnpjResponsavel']))
    );
    const numeroSequencial =
      this.scalarToString(this.readRecordValue(record, ['nSeqEvento', 'numSeqEvento', 'sequenciaEvento'])) ?? undefined;
    const idEvento =
      this.scalarToString(this.readRecordValue(record, ['idEvento', 'identificadorEvento', 'id'])) ?? undefined;
    const descricaoCompleta = [descricao, motivo].filter(Boolean).join(' - ') || undefined;
    const hasEventSignal = Boolean(tipoEvento || descricao || motivo || dataEvento || numeroSequencial || idEvento);

    if (!hasEventSignal || !chaveAcesso) {
      return null;
    }

    if (chaveAcessoFallback) {
      const normalizedFallback = this.normalizeChaveAcesso(chaveAcessoFallback);
      if (normalizedFallback && chaveAcesso !== normalizedFallback) {
        return null;
      }
    }

    const resolvedTipoEvento = tipoEvento ?? 'evento';

    return {
      chaveAcesso,
      tipoEvento: resolvedTipoEvento,
      dataEvento,
      descricao: descricaoCompleta,
      cnpjAutor,
      motivo,
      idEvento,
      numeroSequencial,
      isCancelamento: this.isEventoCancelamento({
        tipoEvento: resolvedTipoEvento,
        descricao: descricaoCompleta
      })
    };
  }

  private buildEventoSignatureFromXml(xml: string): string {
    try {
      return this.buildEventoSignature(this.parser.parseEvento(xml));
    } catch {
      return `xml:${xml}`;
    }
  }

  private buildEventoSignature(evento: ParsedNfseEvento): string {
    return [
      evento.chaveAcesso,
      (evento.tipoEvento || 'evento').trim().toLowerCase(),
      evento.dataEvento?.toISOString() ?? '',
      evento.numeroSequencial?.trim() ?? '',
      this.normalizeSearchText(evento.descricao ?? undefined)
    ].join('|');
  }

  private buildSyntheticEventoXml(evento: ParsedNfseEvento): string {
    const tipoEvento = this.resolveSyntheticTipoEventoTag(evento.tipoEvento);
    const descricao = this.escapeXml(evento.descricao ?? (evento.isCancelamento ? 'Cancelamento de NFS-e' : 'Evento de NFS-e'));
    const motivo = evento.motivo ? `<xMotivo>${this.escapeXml(evento.motivo)}</xMotivo>` : '';
    const dataEvento = evento.dataEvento?.toISOString() ?? new Date().toISOString();
    const numeroSequencial = evento.numeroSequencial
      ? `<nSeqEvento>${this.escapeXml(evento.numeroSequencial)}</nSeqEvento>`
      : '';
    const cnpjAutor = evento.cnpjAutor ? `<CNPJAutor>${this.escapeXml(evento.cnpjAutor)}</CNPJAutor>` : '';
    const idEvento = evento.idEvento ? ` Id="${this.escapeXml(evento.idEvento)}"` : '';
    const detalheEvento = /^e\d{6}$/i.test(tipoEvento)
      ? `<${tipoEvento}><xDesc>${descricao}</xDesc>${motivo}</${tipoEvento}>`
      : `<tpEvento>${this.escapeXml(tipoEvento)}</tpEvento><detEvento><xDesc>${descricao}</xDesc>${motivo}</detEvento>`;

    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">',
      `  <infEvento${idEvento}>`,
      `    <dhProc>${this.escapeXml(dataEvento)}</dhProc>`,
      '    <pedRegEvento versao="1.01">',
      '      <infPedReg>',
      `        <dhEvento>${this.escapeXml(dataEvento)}</dhEvento>`,
      cnpjAutor ? `        ${cnpjAutor}` : '',
      `        <chNFSe>${this.escapeXml(evento.chaveAcesso)}</chNFSe>`,
      numeroSequencial ? `        ${numeroSequencial}` : '',
      `        ${detalheEvento}`,
      '      </infPedReg>',
      '    </pedRegEvento>',
      '  </infEvento>',
      '</evento>'
    ]
      .filter(Boolean)
      .join('\n');
  }

  private resolveSyntheticTipoEventoTag(tipoEvento?: string): string {
    const normalized = this.normalizeStructuredTipoEvento(tipoEvento);
    return normalized ?? 'evento';
  }

  private normalizeStructuredTipoEvento(
    tipoEvento?: string,
    descricao?: string,
    motivo?: string
  ): string | undefined {
    const normalized = this.normalizeSearchText(tipoEvento);
    if (normalized) {
      if (/^e\d{6}$/.test(normalized)) {
        return normalized;
      }

      if (/^\d{6}$/.test(normalized)) {
        return `e${normalized}`;
      }
    }

    const descriptionText = [descricao, motivo].filter(Boolean).join(' ');
    if (this.isEventoCancelamento({ tipoEvento, descricao: descriptionText })) {
      return 'e101101';
    }

    return tipoEvento?.trim() || undefined;
  }

  private parseUnknownDate(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value;
    }

    const text = this.scalarToString(value);
    if (!text) {
      return undefined;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private scalarToString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return String(value);
    }

    return undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private readRecordValue(record: Record<string, unknown> | undefined, keys: string[]): unknown {
    if (!record) {
      return undefined;
    }

    const normalizedKeys = new Set(keys.map((key) => this.normalizeLookupKey(key)));
    for (const [key, value] of Object.entries(record)) {
      if (normalizedKeys.has(this.normalizeLookupKey(key))) {
        return value;
      }
    }

    return undefined;
  }

  private normalizeLookupKey(value: string): string {
    return this.normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private collectRecursiveValues(payload: unknown, maxItems: number): unknown[] {
    const values: unknown[] = [];
    const queue: unknown[] = [payload];
    const seen = new Set<object>();

    while (queue.length > 0 && values.length < maxItems) {
      const current = queue.shift();
      values.push(current);

      if (!current || typeof current !== 'object') {
        continue;
      }

      if (seen.has(current)) {
        continue;
      }

      seen.add(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      queue.push(...Object.values(current));
    }

    return values;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return String(error);
  }

  private assertNfseClientScope(doc: NfseDocumento, clienteId: string): void {
    if (!clienteId) {
      throw new BadRequestException('clienteId obrigatorio para operacao de NFS-e');
    }

    if (doc.clienteId !== clienteId) {
      throw new NotFoundException('NFS-e nao encontrada');
    }
  }

  private isCertificateError(error: unknown): boolean {
    return this.toErrorMessage(error).toLowerCase().includes('certificado');
  }

  private isEventosSchemaUnavailable(error: unknown): boolean {
    const message = this.toErrorMessage(error).toLowerCase();
    return (
      message.includes('nfse_eventos') &&
      (message.includes('does not exist') ||
        message.includes('relation') ||
        message.includes('table') ||
        message.includes('column') ||
        message.includes('p2021') ||
        message.includes('p2022'))
    );
  }

  private removeNfseEventosRelationFilter(
    where?: Prisma.NfseDocumentoWhereInput
  ): Prisma.NfseDocumentoWhereInput | undefined {
    if (!where) {
      return where;
    }

    const next: Prisma.NfseDocumentoWhereInput = { ...where };

    if ('eventos' in next) {
      delete next.eventos;
    }

    if (Array.isArray(next.AND)) {
      next.AND = next.AND
        .map((condition) => this.removeNfseEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfseDocumentoWhereInput => Boolean(condition));
      if (next.AND.length === 0) {
        delete next.AND;
      }
    } else if (next.AND) {
      const cleanedAnd = this.removeNfseEventosRelationFilter(next.AND);
      if (cleanedAnd) {
        next.AND = cleanedAnd;
      } else {
        delete next.AND;
      }
    }

    if (Array.isArray(next.OR)) {
      next.OR = next.OR
        .map((condition) => this.removeNfseEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfseDocumentoWhereInput => Boolean(condition));
      if (next.OR.length === 0) {
        delete next.OR;
      }
    }

    if (Array.isArray(next.NOT)) {
      next.NOT = next.NOT
        .map((condition) => this.removeNfseEventosRelationFilter(condition))
        .filter((condition): condition is Prisma.NfseDocumentoWhereInput => Boolean(condition));
      if (next.NOT.length === 0) {
        delete next.NOT;
      }
    } else if (next.NOT) {
      const cleanedNot = this.removeNfseEventosRelationFilter(next.NOT);
      if (cleanedNot) {
        next.NOT = cleanedNot;
      } else {
        delete next.NOT;
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }
}
