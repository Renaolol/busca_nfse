import { Injectable } from '@nestjs/common';
import { SyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VerificarCertificadosJob {
  static readonly jobName = 'verificar_certificados';

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{
    controlsProcessed: number;
    controlsMarkedError: number;
    controlsReactivated: number;
    expiredCertificatesDeactivated: number;
  }> {
    const now = new Date();
    const expiredCertificates = await this.prisma.certificado.updateMany({
      where: {
        ativo: true,
        validadeFim: {
          lt: now
        }
      },
      data: {
        ativo: false
      }
    });

    const controls = await this.prisma.nfseSyncControle.findMany({
      where: {
        status: {
          in: [SyncStatus.ativo, SyncStatus.erro_certificado]
        }
      },
      select: {
        id: true,
        clienteId: true,
        estabelecimentoId: true,
        status: true
      }
    });

    let controlsMarkedError = 0;
    let controlsReactivated = 0;

    for (const control of controls) {
      const cert = await this.prisma.certificado.findFirst({
        where: {
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ativo: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      const hasUsableCertificate = Boolean(
        cert && (!cert.validadeFim || cert.validadeFim.getTime() >= Date.now())
      );

      if (!hasUsableCertificate) {
        if (control.status !== SyncStatus.erro_certificado) {
          await this.prisma.nfseSyncControle.update({
            where: { id: control.id },
            data: {
              status: SyncStatus.erro_certificado,
              ultimaMensagem: 'Nenhum certificado ativo valido para o estabelecimento'
            }
          });
          controlsMarkedError += 1;
        }
        continue;
      }

      if (control.status === SyncStatus.erro_certificado) {
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            status: SyncStatus.ativo,
            ultimaMensagem: 'Controle reativado apos validacao automatica de certificado',
            proximaExecucao: null
          }
        });
        controlsReactivated += 1;
      }
    }

    return {
      controlsProcessed: controls.length,
      controlsMarkedError,
      controlsReactivated,
      expiredCertificatesDeactivated: expiredCertificates.count
    };
  }
}
