import { Module } from '@nestjs/common';
import { StorageModule } from '../../modules/storage/storage.module';
import { FakeNfeDistribuicaoClient } from './fake-nfe-distribuicao.client';
import { NFE_DISTRIBUICAO_CLIENT } from './nfe-distribuicao.types';
import { FakeNfeManifestacaoClient } from './fake-nfe-manifestacao.client';
import { NFE_MANIFESTACAO_CLIENT } from './nfe-manifestacao.types';
import { RealNfeDistribuicaoClient } from './real-nfe-distribuicao.client';

@Module({
  imports: [StorageModule],
  providers: [
    FakeNfeDistribuicaoClient,
    FakeNfeManifestacaoClient,
    RealNfeDistribuicaoClient,
    {
      provide: NFE_DISTRIBUICAO_CLIENT,
      useFactory: (
        fakeClient: FakeNfeDistribuicaoClient,
        realClient: RealNfeDistribuicaoClient
      ) => (process.env.NODE_ENV !== 'test' && process.env.NFE_DISTRIBUICAO_CLIENT_MODE === 'real' ? realClient : fakeClient),
      inject: [FakeNfeDistribuicaoClient, RealNfeDistribuicaoClient]
    },
    {
      provide: NFE_MANIFESTACAO_CLIENT,
      useFactory: (fakeClient: FakeNfeManifestacaoClient, realClient: RealNfeDistribuicaoClient) =>
        process.env.NODE_ENV !== 'test' && process.env.NFE_DISTRIBUICAO_CLIENT_MODE === 'real' ? realClient : fakeClient,
      inject: [FakeNfeManifestacaoClient, RealNfeDistribuicaoClient]
    }
  ],
  exports: [NFE_DISTRIBUICAO_CLIENT, NFE_MANIFESTACAO_CLIENT, FakeNfeDistribuicaoClient, FakeNfeManifestacaoClient, RealNfeDistribuicaoClient]
})
export class NfeDistribuicaoModule {}
