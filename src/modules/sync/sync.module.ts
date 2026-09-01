import { Module } from '@nestjs/common';
import { NfseAdnModule } from '../../integrations/nfse-adn/nfse-adn.module';
import { CteModule } from '../cte/cte.module';
import { NfeModule } from '../nfe/nfe.module';
import { NfseModule } from '../nfse/nfse.module';
import { StorageModule } from '../storage/storage.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [NfseAdnModule, StorageModule, NfseModule, NfeModule, CteModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
