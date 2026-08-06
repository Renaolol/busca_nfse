import { Module } from '@nestjs/common';
import { NfseModule } from '../nfse/nfse.module';
import { StorageModule } from '../storage/storage.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [StorageModule, NfseModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService]
})
export class AlertsModule {}
