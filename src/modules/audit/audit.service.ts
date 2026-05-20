import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { clienteId?: string; acao?: string }) {
    const where: Prisma.AuditoriaUsuarioWhereInput = {};

    if (filters.clienteId) {
      where.clienteId = filters.clienteId;
    }

    if (filters.acao) {
      where.acao = filters.acao;
    }

    return this.prisma.auditoriaUsuario.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500
    });
  }

  async create(data: {
    usuarioId?: string;
    clienteId?: string;
    acao: string;
    entidade: string;
    entidadeId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.auditoriaUsuario.create({
      data
    });
  }
}
