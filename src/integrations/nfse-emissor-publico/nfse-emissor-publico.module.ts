import { Module } from '@nestjs/common';
import { StorageModule } from '../../modules/storage/storage.module';
import { FakeNfseEmissorPublicoClient } from './fake-nfse-emissor-publico.client';
import { RealNfseEmissorPublicoClient } from './real-nfse-emissor-publico.client';
import { NFSE_EMISSOR_PUBLICO_CLIENT } from './nfse-emissor-publico.types';

@Module({
  imports: [StorageModule],
  providers: [
    FakeNfseEmissorPublicoClient,
    RealNfseEmissorPublicoClient,
    {
      provide: NFSE_EMISSOR_PUBLICO_CLIENT,
      useFactory: (
        fakeClient: FakeNfseEmissorPublicoClient,
        realClient: RealNfseEmissorPublicoClient
      ) => (process.env.NFSE_ADN_CLIENT_MODE === 'real' ? realClient : fakeClient),
      inject: [FakeNfseEmissorPublicoClient, RealNfseEmissorPublicoClient]
    }
  ],
  exports: [NFSE_EMISSOR_PUBLICO_CLIENT, FakeNfseEmissorPublicoClient, RealNfseEmissorPublicoClient]
})
export class NfseEmissorPublicoModule {}
