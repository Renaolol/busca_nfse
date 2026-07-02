import { Module } from '@nestjs/common';
import { DOMINIO_NFE_XML_SOURCE } from './dominio-nfe.types';
import { FakeDominioNfeClient } from './fake-dominio-nfe.client';
import { RealDominioNfeClient } from './real-dominio-nfe.client';

@Module({
  providers: [
    FakeDominioNfeClient,
    RealDominioNfeClient,
    {
      provide: DOMINIO_NFE_XML_SOURCE,
      useFactory: (fakeClient: FakeDominioNfeClient, realClient: RealDominioNfeClient) =>
        process.env.DOMINIO_NFE_SOURCE_MODE === 'real' ? realClient : fakeClient,
      inject: [FakeDominioNfeClient, RealDominioNfeClient]
    }
  ],
  exports: [DOMINIO_NFE_XML_SOURCE, FakeDominioNfeClient, RealDominioNfeClient]
})
export class DominioNfeModule {}
