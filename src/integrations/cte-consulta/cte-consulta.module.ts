import { Module } from '@nestjs/common';
import { StorageModule } from '../../modules/storage/storage.module';
import { CTE_CONSULTA_CLIENT } from './cte-consulta.types';
import { FakeCteConsultaClient } from './fake-cte-consulta.client';
import { RealCteConsultaClient } from './real-cte-consulta.client';

@Module({
  imports: [StorageModule],
  providers: [
    FakeCteConsultaClient,
    RealCteConsultaClient,
    {
      provide: CTE_CONSULTA_CLIENT,
      useFactory: (fakeClient: FakeCteConsultaClient, realClient: RealCteConsultaClient) =>
        process.env.CTE_CONSULTA_CLIENT_MODE === 'real' ? realClient : fakeClient,
      inject: [FakeCteConsultaClient, RealCteConsultaClient]
    }
  ],
  exports: [CTE_CONSULTA_CLIENT, FakeCteConsultaClient, RealCteConsultaClient]
})
export class CteConsultaModule {}
