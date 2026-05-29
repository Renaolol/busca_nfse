import { Injectable } from '@nestjs/common';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

@Injectable()
export class LimparTemporariosJob {
  static readonly jobName = 'limpar_temporarios';

  constructor(private readonly baseTempPath = tmpdir()) {}

  async run(options?: { olderThanHours?: number }): Promise<{
    scanned: number;
    removed: number;
    kept: number;
    errors: number;
  }> {
    const olderThanHours = options?.olderThanHours ?? 1;
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;

    const entries = await readdir(this.baseTempPath, { withFileTypes: true });
    const candidates = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.startsWith('nfse-cert-') || entry.name.startsWith('nfse-mtls-'))
    );

    let removed = 0;
    let kept = 0;
    let errors = 0;

    for (const entry of candidates) {
      const targetPath = join(this.baseTempPath, entry.name);
      try {
        const fileStat = await stat(targetPath);
        if (fileStat.mtimeMs > cutoff) {
          kept += 1;
          continue;
        }

        await rm(targetPath, { recursive: true, force: true });
        removed += 1;
      } catch {
        errors += 1;
      }
    }

    return {
      scanned: candidates.length,
      removed,
      kept,
      errors
    };
  }
}
