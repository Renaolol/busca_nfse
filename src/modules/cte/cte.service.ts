import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LocalStorageService } from '../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardCteStatsQueryDto } from './dto/dashboard-stats.dto';
import { QueryCteDto } from './dto/query-cte.dto';

@Injectable()
export class CteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService
  ) {}

  async findAll(query: QueryCteDto) {
    const where = this.buildBaseWhere(query);
    const cnpjConsulta = this.normalizeCnpj(query.cnpjConsulta);
    const andConditions = this.getAndConditions(where);

    if (cnpjConsulta) {
      const tipoRelacao = query.tipoRelacao ?? 'ambas';

      if (tipoRelacao === 'emitidos') {
        andConditions.push({ cnpjEmitente: cnpjConsulta });
      } else if (tipoRelacao === 'recebidos') {
        andConditions.push({ cnpjDestinatario: cnpjConsulta });
      } else {
        andConditions.push({
          OR: [{ cnpjEmitente: cnpjConsulta }, { cnpjDestinatario: cnpjConsulta }]
        });
      }
    }

    return this.prisma.nfeDocumento.findMany({
      where,
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: 500
    });
  }

  async getDashboardStats(query: DashboardCteStatsQueryDto) {
    const where = this.createCteWhere();
    const andConditions = this.getAndConditions(where);
    if (query.clienteId) {
      andConditions.push({ clienteId: query.clienteId });
    }

    const xmlCompletoWhere: Prisma.NfeDocumentoWhereInput = {
      ...where,
      AND: [...andConditions, { xmlCompletoDisponivel: true }]
    };

    const [totalCte, xmlsCompletos, totalByClientRows, completosByClientRows] = await Promise.all([
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

    const byClient = new Map<string, { clienteId: string; totalCte: number; xmlsCompletos: number }>();

    totalByClientRows.forEach((row) => {
      byClient.set(row.clienteId, {
        clienteId: row.clienteId,
        totalCte: row._count._all,
        xmlsCompletos: 0
      });
    });

    completosByClientRows.forEach((row) => {
      const current = byClient.get(row.clienteId) ?? {
        clienteId: row.clienteId,
        totalCte: 0,
        xmlsCompletos: 0
      };
      current.xmlsCompletos = row._count._all;
      byClient.set(row.clienteId, current);
    });

    return {
      totalCte,
      xmlsCompletos,
      byClient: Array.from(byClient.values()).sort(
        (left, right) =>
          right.totalCte - left.totalCte ||
          right.xmlsCompletos - left.xmlsCompletos ||
          left.clienteId.localeCompare(right.clienteId)
      )
    };
  }

  async findOne(id: string, clienteId: string) {
    const found = await this.prisma.nfeDocumento.findUnique({ where: { id } });
    if (!found || !this.isCteDocument(found)) {
      throw new NotFoundException('CT-e nao encontrado');
    }
    this.assertClientScope(found.clienteId, clienteId);
    return found;
  }

  async getXml(id: string, clienteId: string) {
    const doc = await this.findOne(id, clienteId);
    const key = doc.xmlCompletoPath ?? doc.xmlResumoPath;
    if (!key) {
      throw new NotFoundException('XML nao disponivel para este CT-e');
    }

    const xmlBuffer = await this.storage.getObject(key);
    const xml = xmlBuffer.toString('utf8');

    return {
      id: doc.id,
      chaveAcesso: doc.chaveAcesso,
      fileName: `CTE-${doc.chaveAcesso}.xml`,
      contentType: 'application/xml',
      contentBase64: xmlBuffer.toString('base64'),
      xml
    };
  }

  private buildBaseWhere(query: QueryCteDto): Prisma.NfeDocumentoWhereInput {
    const where = this.createCteWhere();
    const andConditions = this.getAndConditions(where);

    if (query.clienteId) {
      andConditions.push({ clienteId: query.clienteId });
    }

    const cnpjEmitente = this.normalizeCnpj(query.cnpjEmitente);
    if (cnpjEmitente) {
      andConditions.push({ cnpjEmitente });
    }

    const cnpjDestinatario = this.normalizeCnpj(query.cnpjDestinatario);
    if (cnpjDestinatario) {
      andConditions.push({ cnpjDestinatario });
    }

    if (query.status) {
      andConditions.push({ status: query.status });
    }

    if (query.schemaDoc) {
      andConditions.push({ schemaDoc: query.schemaDoc });
    }

    if (query.numeroCte) {
      andConditions.push({
        numeroNfe: {
          contains: query.numeroCte
        }
      });
    }

    if (query.chaveAcesso) {
      andConditions.push({
        chaveAcesso: {
          contains: query.chaveAcesso
        }
      });
    }

    if (query.ambiente) {
      andConditions.push({ ambiente: query.ambiente });
    }

    if (query.dataInicio || query.dataFim) {
      andConditions.push({
        dataEmissao: {
          gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
          lte: query.dataFim ? new Date(query.dataFim) : undefined
        }
      });
    }

    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      andConditions.push({
        valorTotal: {
          gte: query.valorMin,
          lte: query.valorMax
        }
      });
    }

    if (query.somenteXmlCompleto) {
      andConditions.push({ xmlCompletoDisponivel: true });
    }

    return where;
  }

  private createCteWhere(): Prisma.NfeDocumentoWhereInput {
    return {
      AND: [
        {
          OR: [
            { modelo: '57' },
            { schemaDoc: { startsWith: 'CTe' } },
            { schemaDoc: { startsWith: 'cteProc' } },
            { schemaDoc: { startsWith: 'resCTe' } }
          ]
        }
      ]
    };
  }

  private getAndConditions(where: Prisma.NfeDocumentoWhereInput): Prisma.NfeDocumentoWhereInput[] {
    if (Array.isArray(where.AND)) {
      return where.AND;
    }

    if (where.AND) {
      return [where.AND];
    }

    const andConditions: Prisma.NfeDocumentoWhereInput[] = [];
    where.AND = andConditions;
    return andConditions;
  }

  private isCteDocument(doc: Pick<Prisma.NfeDocumentoUncheckedCreateInput, 'modelo' | 'schemaDoc'>): boolean {
    return doc.modelo === '57' || ['CTe', 'cteProc', 'resCTe'].some((prefix) => String(doc.schemaDoc || '').startsWith(prefix));
  }

  private assertClientScope(ownerClientId: string, requestedClientId: string) {
    if (ownerClientId !== requestedClientId) {
      throw new NotFoundException('CT-e nao encontrado');
    }
  }

  private normalizeCnpj(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }
}
