import { Module } from '@nestjs/common';
import { FakeNfeScClient } from '../../integrations/nfe-sc/fake-nfe-sc.client';
import { NFE_SC_CLIENT } from '../../integrations/nfe-sc/nfe-sc.types';
import { RealNfeScClient } from '../../integrations/nfe-sc/real-nfe-sc.client';
import { StorageModule } from '../storage/storage.module';
import { NfeModule } from '../nfe/nfe.module';
import { NfeScController } from './nfe-sc.controller';
import { NfeScService } from './nfe-sc.service';

@Module({
  imports: [StorageModule, NfeModule],
  controllers: [NfeScController],
  providers: [
    NfeScService,
    FakeNfeScClient,
    RealNfeScClient,
    {
      provide: NFE_SC_CLIENT,
      useFactory: (fake: FakeNfeScClient, real: RealNfeScClient) =>
        process.env.NODE_ENV !== 'test' && process.env.NFE_SC_CLIENT_MODE === 'real' ? real : fake,
      inject: [FakeNfeScClient, RealNfeScClient]
    }
  ]
})
export class NfeScModule {}
