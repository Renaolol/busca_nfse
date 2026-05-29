import { Injectable } from '@nestjs/common';
import { SyncService } from '../modules/sync/sync.service';

@Injectable()
export class SyncNfseAdnJob {
  static readonly jobName = 'sync_nfse_adn';

  constructor(private readonly syncService: SyncService) {}

  async run(): Promise<{ processed: number; documentsSaved: number }> {
    return this.syncService.runNow();
  }
}
