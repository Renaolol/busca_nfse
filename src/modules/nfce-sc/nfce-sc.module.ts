import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { NfeModule } from '../nfe/nfe.module';
import { FakeNfceScClient } from '../../integrations/nfce-sc/fake-nfce-sc.client';
import { RealNfceScClient } from '../../integrations/nfce-sc/real-nfce-sc.client';
import { NFCE_SC_CLIENT } from '../../integrations/nfce-sc/nfce-sc.types';
import { NfceScController } from './nfce-sc.controller';
import { NfceScService } from './nfce-sc.service';

@Module({
  imports: [StorageModule, NfeModule],
  controllers: [NfceScController],
  providers: [
    NfceScService,
    FakeNfceScClient,
    RealNfceScClient,
    {
      provide: NFCE_SC_CLIENT,
      useFactory: (fake: FakeNfceScClient, real: RealNfceScClient) =>
        process.env.NFCE_SC_CLIENT_MODE === 'real' ? real : fake,
      inject: [FakeNfceScClient, RealNfceScClient]
    }
  ]
})
export class NfceScModule {}
