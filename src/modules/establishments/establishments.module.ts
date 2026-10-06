import { Module } from '@nestjs/common';
import { CEP_LOOKUP_CLIENT } from '../../integrations/cep-lookup/cep-lookup.types';
import { RealCepLookupClient } from '../../integrations/cep-lookup/real-cep-lookup.client';
import { EstablishmentsController } from './establishments.controller';
import { EstablishmentsService } from './establishments.service';

@Module({
  controllers: [EstablishmentsController],
  providers: [EstablishmentsService, { provide: CEP_LOOKUP_CLIENT, useClass: RealCepLookupClient }],
  exports: [EstablishmentsService]
})
export class EstablishmentsModule {}
