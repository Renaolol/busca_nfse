import { Module } from '@nestjs/common';
import { StorageModule } from '../../modules/storage/storage.module';
import { FakeNfseAdnClient } from './fake-nfse-adn.client';
import { RealNfseAdnClient } from './real-nfse-adn.client';
import { NFSE_ADN_CLIENT } from './nfse-adn.types';

@Module({
  imports: [StorageModule],
  providers: [
    FakeNfseAdnClient,
    RealNfseAdnClient,
    {
      provide: NFSE_ADN_CLIENT,
      useFactory: (
        fakeClient: FakeNfseAdnClient,
        realClient: RealNfseAdnClient
      ) => (process.env.NFSE_ADN_CLIENT_MODE === 'real' ? realClient : fakeClient),
      inject: [FakeNfseAdnClient, RealNfseAdnClient]
    }
  ],
  exports: [NFSE_ADN_CLIENT, FakeNfseAdnClient, RealNfseAdnClient]
})
export class NfseAdnModule {}
