import { Module } from '@nestjs/common';
import { NfseAdnModule } from '../../integrations/nfse-adn/nfse-adn.module';
import { NfseModule } from '../nfse/nfse.module';
import { StorageModule } from '../storage/storage.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [NfseAdnModule, StorageModule, NfseModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService]
})
export class SyncModule {}
