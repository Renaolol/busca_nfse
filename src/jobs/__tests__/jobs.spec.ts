import { SyncStatus } from '@prisma/client';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaService } from '../../prisma/prisma.service';
import { NfseService } from '../../modules/nfse/nfse.service';
import { SyncService } from '../../modules/sync/sync.service';
import { GerarDanfsePendenteJob } from '../gerar-danfse-pendente.job';
import { LimparTemporariosJob } from '../limpar-temporarios.job';
import { ReprocessarErrosJob } from '../reprocessar-erros.job';
import { SyncNfseAdnJob } from '../sync-nfse-adn.job';
import { VerificarCertificadosJob } from '../verificar-certificados.job';

describe('Jobs', () => {
  it('SyncNfseAdnJob executa runNow no SyncService', async () => {
    const syncService = {
      runNow: jest.fn().mockResolvedValue({ processed: 3, documentsSaved: 2 })
    } as unknown as SyncService;

    const job = new SyncNfseAdnJob(syncService);
    const result = await job.run();

    expect(syncService.runNow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 3, documentsSaved: 2 });
  });

  it('GerarDanfsePendenteJob chama reprocessarXmls com defaults idempotentes', async () => {
    const nfseService = {
      reprocessarXmls: jest.fn().mockResolvedValue({
        filtros: {
          clienteId: null,
          estabelecimentoId: null,
          ambiente: null,
          somenteIncompletos: true,
          regenerarDanfse: true,
          limit: 200
        },
        totalSelecionados: 0,
        processados: 0,
        atualizados: 0,
        falhas: 0,
        erros: []
      })
    } as unknown as NfseService;

    const job = new GerarDanfsePendenteJob(nfseService);
    const result = await job.run();

    expect(nfseService.reprocessarXmls).toHaveBeenCalledWith({
      clienteId: undefined,
      somenteIncompletos: true,
      regenerarDanfse: true,
      limit: 200
    });
    expect(result.processados).toBe(0);
  });

  it('ReprocessarErrosJob reativa controles em erro_api quando elegiveis', async () => {
    const prisma = {
      nfseSyncControle: {
        updateMany: jest.fn().mockResolvedValue({ count: 4 })
      }
    } as unknown as PrismaService;

    const job = new ReprocessarErrosJob(prisma);
    const result = await job.run();

    expect(prisma.nfseSyncControle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: SyncStatus.erro_api
        }),
        data: expect.objectContaining({
          status: SyncStatus.ativo
        })
      })
    );
    expect(result).toEqual({ reativados: 4 });
  });

  it('VerificarCertificadosJob marca erro de certificado e reativa controles quando aplicavel', async () => {
    const prisma = {
      certificado: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'cert-ok', validadeFim: null })
      },
      nfseSyncControle: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ctrl-1',
            clienteId: 'cliente-1',
            estabelecimentoId: 'estab-1',
            status: SyncStatus.ativo
          },
          {
            id: 'ctrl-2',
            clienteId: 'cliente-2',
            estabelecimentoId: 'estab-2',
            status: SyncStatus.erro_certificado
          }
        ]),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as unknown as PrismaService;

    const job = new VerificarCertificadosJob(prisma);
    const result = await job.run();

    expect(prisma.nfseSyncControle.update).toHaveBeenCalledTimes(2);
    expect(prisma.nfseSyncControle.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'ctrl-1' },
        data: expect.objectContaining({
          status: SyncStatus.erro_certificado
        })
      })
    );
    expect(prisma.nfseSyncControle.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'ctrl-2' },
        data: expect.objectContaining({
          status: SyncStatus.ativo
        })
      })
    );
    expect(result).toEqual({
      controlsProcessed: 2,
      controlsMarkedError: 1,
      controlsReactivated: 1,
      expiredCertificatesDeactivated: 1
    });
  });

  it('LimparTemporariosJob remove apenas diretorios temporarios antigos', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'nfse-job-test-'));
    const oldDir = join(baseDir, 'nfse-cert-old');
    const newDir = join(baseDir, 'nfse-mtls-new');
    const unrelatedDir = join(baseDir, 'other-dir');

    try {
      await mkdir(oldDir);
      await mkdir(newDir);
      await mkdir(unrelatedDir);

      const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
      await utimes(oldDir, oldDate, oldDate);

      const job = new LimparTemporariosJob();
      const result = await job.run({ olderThanHours: 1, baseTempPath: baseDir });

      expect(result.scanned).toBe(2);
      expect(result.removed).toBe(1);
      expect(result.kept).toBe(1);
      expect(result.errors).toBe(0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
