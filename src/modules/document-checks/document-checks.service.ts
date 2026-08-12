import { Injectable } from '@nestjs/common';
import { DocumentoConferenciaTipo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { ListDocumentChecksQueryDto } from './dto/list-document-checks-query.dto';
import { UpdateDocumentCheckDto } from './dto/update-document-check.dto';

@Injectable()
export class DocumentChecksService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(authUser: AuthenticatedUser, query: ListDocumentChecksQueryDto) {
    const rows = await this.prisma.documentoConferencia.findMany({
      where: {
        usuarioId: authUser.userId,
        tipoDocumento: query.tipo as DocumentoConferenciaTipo,
        conferido: true,
        ...(query.documentoIds?.length ? { documentoId: { in: query.documentoIds } } : {})
      },
      orderBy: { updatedAt: 'desc' },
      take: query.documentoIds?.length ? Math.min(query.documentoIds.length, 1000) : 1000
    });

    return rows.map((row) => ({
      tipo: row.tipoDocumento,
      documentoId: row.documentoId,
      conferido: row.conferido,
      clienteId: row.clienteId,
      conferidoEm: row.conferidoEm?.toISOString() ?? null
    }));
  }

  async updateForUser(authUser: AuthenticatedUser, dto: UpdateDocumentCheckDto) {
    if (!dto.conferido) {
      await this.prisma.documentoConferencia.deleteMany({
        where: {
          usuarioId: authUser.userId,
          tipoDocumento: dto.tipo as DocumentoConferenciaTipo,
          documentoId: dto.documentoId
        }
      });

      return {
        tipo: dto.tipo,
        documentoId: dto.documentoId,
        conferido: false,
        clienteId: dto.clienteId ?? null,
        conferidoEm: null
      };
    }

    const row = await this.prisma.documentoConferencia.upsert({
      where: {
        usuarioId_tipoDocumento_documentoId: {
          usuarioId: authUser.userId,
          tipoDocumento: dto.tipo as DocumentoConferenciaTipo,
          documentoId: dto.documentoId
        }
      },
      update: {
        clienteId: dto.clienteId ?? null,
        conferido: true,
        conferidoEm: new Date()
      },
      create: {
        usuarioId: authUser.userId,
        clienteId: dto.clienteId ?? null,
        tipoDocumento: dto.tipo as DocumentoConferenciaTipo,
        documentoId: dto.documentoId,
        conferido: true,
        conferidoEm: new Date()
      }
    });

    return {
      tipo: row.tipoDocumento,
      documentoId: row.documentoId,
      conferido: row.conferido,
      clienteId: row.clienteId,
      conferidoEm: row.conferidoEm?.toISOString() ?? null
    };
  }
}
