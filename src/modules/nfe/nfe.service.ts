import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Certificado,
  NfeAmbiente,
  NfeDocumentoOrigem,
  NfeSyncStatus,
  NfeTipoRelacao,
  Prisma
} from '@prisma/client';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NFE_DISTRIBUICAO_CLIENT,
  NfeDistribuicaoClient,
  NfeDistribuicaoDocument
} from '../../integrations/nfe-distribuicao/nfe-distribuicao.types';
import { DashboardNfeStatsQueryDto } from './dto/dashboard-stats.dto';
import { ImportNfeXmlDto } from './dto/import-xml.dto';
import { PauseNfeSyncDto } from './dto/pause-sync.dto';
import { QueryNfeDto } from './dto/query-nfe.dto';
import { RunNfeSyncDto } from './dto/run-sync.dto';
import { StartNfeSyncDto } from './dto/start-sync.dto';
import { NfeXmlParserService, ParsedNfe } from './nfe-xml-parser.service';

@Injectable()
export class NfeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: NfeXmlParserService,
    private readonly storage: LocalStorageService,
    @Inject(NFE_DISTRIBUICAO_CLIENT) private readonly distribuicaoClient: NfeDistribuicaoClient
  ) {}

  async findAll(query: QueryNfeDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidas') {
        where.cnpjEmitente = cnpjConsulta;
      } else if (tipoRelacao === 'recebidas') {
        where.cnpjDestinatario = cnpjConsulta;
      } else {
        where.OR = [{ cnpjEmitente: cnpjConsulta }, { cnpjDestinatario: cnpjConsulta }];
      }
    }

    return this.prisma.nfeDocumento.findMany({
      where,
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: 500
    });
  }

  async getDashboardStats(query: DashboardNfeStatsQueryDto) {
    const where: Prisma.NfeDocumentoWhereInput = {};
    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const xmlCompletoWhere: Prisma.NfeDocumentoWhereInput = {
      ...where,
      xmlCompletoDisponivel: true
    };

    const [totalNfe, xmlsCompletos, totalByClientRows, completosByClientRows] = await Promise.all([
      this.prisma.nfeDocumento.count({ where }),
      this.prisma.nfeDocumento.count({ where: xmlCompletoWhere }),
      this.prisma.nfeDocumento.groupBy({
        by: ['clienteId'],
        where,
        _count: { _all: true }
      }),
      this.prisma.nfeDocumento.groupBy({
        by: ['clienteId'],
        where: xmlCompletoWhere,
        _count: { _all: true }
      })
    ]);

    const byClient = new Map<string, { clienteId: string; totalNfe: number; xmlsCompletos: number }>();

    totalByClientRows.forEach((row) => {
      byClient.set(row.clienteId, {
        clienteId: row.clienteId,
        totalNfe: row._count._all,
        xmlsCompletos: 0
      });
    });

    completosByClientRows.forEach((row) => {
      const current = byClient.get(row.clienteId) ?? {
        clienteId: row.clienteId,
        totalNfe: 0,
        xmlsCompletos: 0
      };
      current.xmlsCompletos = row._count._all;
      byClient.set(row.clienteId, current);
    });

    return {
      totalNfe,
      xmlsCompletos,
      byClient: Array.from(byClient.values()).sort(
        (left, right) =>
          right.totalNfe - left.totalNfe ||
          right.xmlsCompletos - left.xmlsCompletos ||
          left.clienteId.localeCompare(right.clienteId)
      )
    };
  }

  async findOne(id: string, clienteId: string) {
    const found = await this.prisma.nfeDocumento.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('NF-e nao encontrada');
    }
    this.assertClientScope(found.clienteId, clienteId);
    return found;
  }

  async getXml(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
    const key = doc.xmlCompletoPath ?? doc.xmlResumoPath;
    if (!key) {
      throw new NotFoundException('XML nao disponivel para esta NF-e');
    }

    const xmlBuffer = await this.storage.getObject(key);
    const xml = xmlBuffer.toString('utf8');

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      fileName: `NFE-${doc.chaveAcesso}.xml`,
      contentType: 'application/xml',
      contentBase64: xmlBuffer.toString('base64'),
      xml
    };
  }

  async importXml(dto: ImportNfeXmlDto) {
    await this.ensureClient(dto.clienteId);
    await this.ensureEstablishment(dto.estabelecimentoId, dto.clienteId);

    const xml = Buffer.from(dto.xmlBase64, 'base64').toString('utf8');
    const persisted = await this.persistDocument({
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente: dto.ambiente,
      cnpjConsulta: dto.cnpjConsulta,
      document: {
        schema: 'importacao_xml',
        xml
      },
      origem: NfeDocumentoOrigem.importacao_xml,
      tipoRelacaoForcada: dto.tipoRelacao
    });

    return persisted;
  }

  async iniciarSync(dto: StartNfeSyncDto): Promise<{ controlesCriadosOuAtualizados: number }> {
    await this.ensureClient(dto.clienteId);
    const ambiente = dto.ambiente ?? NfeAmbiente.producao;
    const controls = await this.resolveTargetEstablishments(dto.clienteId, dto.estabelecimentoId);
    const nsuInicial = dto.nsuInicial ? BigInt(dto.nsuInicial) : 1n;
    let count = 0;

    for (const establishment of controls) {
      const cnpjConsulta = this.normalizeCnpj(dto.cnpjConsulta) ?? establishment.cnpj;
      await this.findActiveCertificateOrThrow(dto.clienteId, establishment.id, cnpjConsulta);

      await this.prisma.nfeSyncControle.upsert({
        where: {
          clienteId_cnpjConsulta_ambiente: {
            clienteId: dto.clienteId,
            cnpjConsulta,
            ambiente
          }
        },
        update: {
          status: NfeSyncStatus.ativo,
          ultimaMensagem: 'Busca de NF-e habilitada'
        },
        create: {
          clienteId: dto.clienteId,
          estabelecimentoId: establishment.id,
          cnpjConsulta,
          ambiente,
          ultimoNsuConsultado: nsuInicial > 0n ? nsuInicial - 1n : 0n,
          status: NfeSyncStatus.ativo,
          ultimaMensagem: 'Busca de NF-e habilitada'
        }
      });
      count += 1;
    }

    return { controlesCriadosOuAtualizados: count };
  }

  async pausarSync(dto: PauseNfeSyncDto): Promise<{ total: number }> {
    await this.ensureClient(dto.clienteId);
    const result = await this.prisma.nfeSyncControle.updateMany({
      where: {
        clienteId: dto.clienteId,
        ...(dto.ambiente ? { ambiente: dto.ambiente } : {})
      },
      data: {
        status: NfeSyncStatus.pausado,
        ultimaMensagem: 'Busca de NF-e pausada manualmente'
      }
    });

    return { total: result.count };
  }

  async statusSync(clienteId: string) {
    await this.ensureClient(clienteId);
    return this.prisma.nfeSyncControle.findMany({
      where: { clienteId },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async runNow(dto: RunNfeSyncDto): Promise<{ processed: number; documentsSaved: number }> {
    await this.ensureClient(dto.clienteId);

    const controls = await this.prisma.nfeSyncControle.findMany({
      where: {
        clienteId: dto.clienteId,
        status: NfeSyncStatus.ativo,
        ...(dto.ambiente ? { ambiente: dto.ambiente } : {}),
        ...(dto.estabelecimentoId ? { estabelecimentoId: dto.estabelecimentoId } : {})
      },
      orderBy: { updatedAt: 'asc' },
      take: dto.limitControles ?? 10
    });

    let documentsSaved = 0;

    for (const control of controls) {
      const certificate = await this.findActiveCertificateOrThrow(
        control.clienteId,
        control.estabelecimentoId,
        control.cnpjConsulta
      );
      const result = await this.distribuicaoClient.distribuirPorNsu({
        cnpjConsulta: control.cnpjConsulta,
        ultNsu: control.ultimoNsuConsultado,
        ambiente: control.ambiente,
        certificateId: certificate.id
      });

      if (result.statusCode !== 200) {
        await this.prisma.nfeSyncControle.update({
          where: { id: control.id },
          data: {
            status: NfeSyncStatus.erro_api,
            ultimaExecucao: new Date(),
            ultimaMensagem: result.xMotivo ?? `Falha na distribuicao NF-e. HTTP ${result.statusCode}.`
          }
        });
        continue;
      }

      let highestDocumentNsu = control.ultimoNsuDistribuido;
      for (const document of result.documents) {
        await this.persistDocument({
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          document,
          origem: NfeDocumentoOrigem.distribuicao_nsu
        });
        documentsSaved += 1;
        if (document.nsu && document.nsu > highestDocumentNsu) {
          highestDocumentNsu = document.nsu;
        }
      }

      await this.prisma.nfeSyncControle.update({
        where: { id: control.id },
        data: {
          status: NfeSyncStatus.ativo,
          ultimoNsuConsultado: result.ultNsu,
          ultimoNsuDistribuido: highestDocumentNsu,
          maxNsu: result.maxNsu,
          ultimaExecucao: new Date(),
          ultimaMensagem: result.xMotivo ?? 'Distribuicao NF-e executada com sucesso',
          totalDocumentosBaixados: {
            increment: result.documents.length
          }
        }
      });
    }

    return {
      processed: controls.length,
      documentsSaved
    };
  }

  private async persistDocument(params: {
    clienteId: string;
    estabelecimentoId: string;
    ambiente: NfeAmbiente;
    cnpjConsulta?: string;
    document: NfeDistribuicaoDocument;
    origem: NfeDocumentoOrigem;
    tipoRelacaoForcada?: NfeTipoRelacao;
  }) {
    const parsed = this.parser.parse(params.document.xml);
    const existing = await this.prisma.nfeDocumento.findUnique({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: parsed.chaveAcesso
        }
      }
    });

    const cnpjConsulta = this.normalizeCnpj(params.cnpjConsulta);
    const tipoRelacao =
      params.tipoRelacaoForcada ??
      this.resolveTipoRelacao(cnpjConsulta, parsed) ??
      existing?.tipoRelacao ??
      null;

    const dataReferencia = parsed.dataEmissao ?? parsed.dataAutorizacao ?? new Date();
    const year = dataReferencia.getUTCFullYear();
    const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
    const cnpjPasta = parsed.cnpjEmitente ?? parsed.cnpjDestinatario ?? cnpjConsulta ?? 'sem-cnpj';
    const storagePrefix = `nfe/${params.ambiente}/${cnpjPasta}/${year}/${month}`;
    const fileName = `${parsed.chaveAcesso}.xml`;
    const isFull = parsed.contentType === 'completo';
    const storageKey = `${storagePrefix}/${isFull ? 'xml' : 'resumos'}/${fileName}`;
    await this.storage.putObject(storageKey, params.document.xml);
    const hash = this.parser.getHash(params.document.xml);

    const updateData: Prisma.NfeDocumentoUncheckedUpdateInput = {
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      nsu: params.document.nsu,
      numeroNfe: parsed.numeroNfe,
      serie: parsed.serie,
      modelo: parsed.modelo ?? '55',
      dataEmissao: parsed.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao,
      status: parsed.status,
      tipoRelacao,
      schemaDoc: params.document.schema || parsed.schemaDoc,
      cnpjEmitente:
        parsed.cnpjEmitente ?? (tipoRelacao === NfeTipoRelacao.emitida ? cnpjConsulta : existing?.cnpjEmitente),
      razaoSocialEmitente: parsed.razaoSocialEmitente,
      cnpjDestinatario:
        parsed.cnpjDestinatario ?? (tipoRelacao === NfeTipoRelacao.recebida ? cnpjConsulta : existing?.cnpjDestinatario),
      razaoSocialDestinatario: parsed.razaoSocialDestinatario,
      valorTotal: this.toDecimal(parsed.valorTotal),
      origem: params.origem,
      updatedAt: new Date(),
      ...(isFull
        ? {
            xmlCompletoDisponivel: true,
            xmlCompletoPath: storageKey,
            hashXmlCompleto: hash
          }
        : {
            resumoDisponivel: true,
            xmlResumoPath: storageKey,
            hashResumo: hash
          })
    };

    const createData: Prisma.NfeDocumentoUncheckedCreateInput = {
      clienteId: params.clienteId,
      estabelecimentoId: params.estabelecimentoId,
      ambiente: params.ambiente,
      nsu: params.document.nsu,
      chaveAcesso: parsed.chaveAcesso,
      numeroNfe: parsed.numeroNfe,
      serie: parsed.serie,
      modelo: parsed.modelo ?? '55',
      dataEmissao: parsed.dataEmissao,
      dataAutorizacao: parsed.dataAutorizacao,
      status: parsed.status,
      tipoRelacao,
      schemaDoc: params.document.schema || parsed.schemaDoc,
      resumoDisponivel: !isFull,
      xmlCompletoDisponivel: isFull,
      cnpjEmitente: parsed.cnpjEmitente ?? (tipoRelacao === NfeTipoRelacao.emitida ? cnpjConsulta : undefined),
      razaoSocialEmitente: parsed.razaoSocialEmitente,
      cnpjDestinatario:
        parsed.cnpjDestinatario ?? (tipoRelacao === NfeTipoRelacao.recebida ? cnpjConsulta : undefined),
      razaoSocialDestinatario: parsed.razaoSocialDestinatario,
      valorTotal: this.toDecimal(parsed.valorTotal),
      xmlResumoPath: isFull ? undefined : storageKey,
      xmlCompletoPath: isFull ? storageKey : undefined,
      hashResumo: isFull ? undefined : hash,
      hashXmlCompleto: isFull ? hash : undefined,
      origem: params.origem
    };

    return this.prisma.nfeDocumento.upsert({
      where: {
        ambiente_chaveAcesso: {
          ambiente: params.ambiente,
          chaveAcesso: parsed.chaveAcesso
        }
      },
      update: updateData,
      create: createData
    });
  }

  private buildBaseWhere(query: QueryNfeDto): Prisma.NfeDocumentoWhereInput {
    const where: Prisma.NfeDocumentoWhereInput = {};

    if (query.clienteId) {
      where.clienteId = query.clienteId;
    }

    const cnpjEmitente = this.normalizeCnpj(query.cnpjEmitente);
    if (cnpjEmitente) {
      where.cnpjEmitente = cnpjEmitente;
    }

    const cnpjDestinatario = this.normalizeCnpj(query.cnpjDestinatario);
    if (cnpjDestinatario) {
      where.cnpjDestinatario = cnpjDestinatario;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.schemaDoc) {
      where.schemaDoc = query.schemaDoc;
    }

    if (query.dataInicio || query.dataFim) {
      where.dataEmissao = {
        gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
        lte: query.dataFim ? new Date(query.dataFim) : undefined
      };
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      where.valorTotal = {
        gte: query.valorMin,
        lte: query.valorMax
      };
    }

    if (query.somenteXmlCompleto) {
      where.xmlCompletoDisponivel = true;
    }

    return where;
  }

  private resolveTipoRelacao(cnpjConsulta: string | undefined, parsed: ParsedNfe): NfeTipoRelacao | undefined {
    if (!cnpjConsulta) {
      return undefined;
    }

    if (parsed.cnpjEmitente === cnpjConsulta) {
      return NfeTipoRelacao.emitida;
    }

    if (parsed.cnpjDestinatario === cnpjConsulta) {
      return NfeTipoRelacao.recebida;
    }

    return undefined;
  }

  private async ensureClient(clienteId: string): Promise<void> {
    const found = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!found) {
      throw new NotFoundException('Cliente nao encontrado');
    }
  }

  private async ensureEstablishment(estabelecimentoId: string, clienteId: string): Promise<void> {
    const found = await this.prisma.clienteEstabelecimento.findUnique({ where: { id: estabelecimentoId } });
    if (!found || found.clienteId !== clienteId) {
      throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
    }
  }

  private async resolveTargetEstablishments(clienteId: string, estabelecimentoId?: string) {
    if (estabelecimentoId) {
      const found = await this.prisma.clienteEstabelecimento.findUnique({ where: { id: estabelecimentoId } });
      if (!found || found.clienteId !== clienteId) {
        throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
      }
      return [found];
    }

    const found = await this.prisma.clienteEstabelecimento.findMany({
      where: { clienteId, ativo: true },
      orderBy: { createdAt: 'asc' }
    });

    if (found.length === 0) {
      throw new BadRequestException('Cliente nao possui estabelecimentos ativos para busca de NF-e');
    }

    return found;
  }

  private async findActiveCertificateOrThrow(
    clienteId: string,
    estabelecimentoId: string,
    cnpjConsulta: string
  ): Promise<Pick<Certificado, 'id'>> {
    const now = new Date();
    const certificate = await this.prisma.certificado.findFirst({
      where: {
        ativo: true,
        AND: [
          {
            OR: [
              {
                clienteId,
                estabelecimentoId
              },
              {
                clienteId,
                estabelecimentoId: null,
                cnpjTitular: cnpjConsulta
              }
            ]
          },
          {
            OR: [{ validadeFim: null }, { validadeFim: { gt: now } }]
          }
        ]
      },
      select: { id: true }
    });

    if (!certificate) {
      throw new BadRequestException(`Nenhum certificado ativo e valido encontrado para o CNPJ ${cnpjConsulta}`);
    }

    return certificate;
  }

  private assertClientScope(documentClientId: string, clienteId: string): void {
    if (documentClientId !== clienteId) {
      throw new NotFoundException('NF-e nao encontrada para o cliente informado');
    }
  }

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private toDecimal(value?: string): Prisma.Decimal | undefined {
    if (!value) {
      return undefined;
    }

    return new Prisma.Decimal(value.replace(',', '.'));
  }
}
