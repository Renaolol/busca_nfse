import { Injectable } from '@nestjs/common';
import { SyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReprocessarErrosJob {
  static readonly jobName = 'reprocessar_erros';

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ reativados: number }> {
    const now = new Date();
    const updated = await this.prisma.nfseSyncControle.updateMany({
      where: {
        status: SyncStatus.erro_api,
        OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }]
      },
      data: {
        status: SyncStatus.ativo,
        proximaExecucao: null,
        ultimaMensagem: 'Controle reativado automaticamente para nova tentativa'
      }
    });

    return { reativados: updated.count };
  }
}
