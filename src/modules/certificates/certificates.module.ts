import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { SharedModule } from '../shared/shared.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [StorageModule, SharedModule],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService]
})
export class CertificatesModule {}
