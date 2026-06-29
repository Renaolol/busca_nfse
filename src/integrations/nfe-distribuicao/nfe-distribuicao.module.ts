import { Module } from '@nestjs/common';
import { FakeNfeDistribuicaoClient } from './fake-nfe-distribuicao.client';
import { NFE_DISTRIBUICAO_CLIENT } from './nfe-distribuicao.types';
import { RealNfeDistribuicaoClient } from './real-nfe-distribuicao.client';

@Module({
  providers: [
    FakeNfeDistribuicaoClient,
    RealNfeDistribuicaoClient,
    {
      provide: NFE_DISTRIBUICAO_CLIENT,
      useFactory: (
        fakeClient: FakeNfeDistribuicaoClient,
        realClient: RealNfeDistribuicaoClient
      ) => (process.env.NFE_DISTRIBUICAO_CLIENT_MODE === 'real' ? realClient : fakeClient),
      inject: [FakeNfeDistribuicaoClient, RealNfeDistribuicaoClient]
    }
  ],
  exports: [NFE_DISTRIBUICAO_CLIENT, FakeNfeDistribuicaoClient, RealNfeDistribuicaoClient]
})
export class NfeDistribuicaoModule {}
