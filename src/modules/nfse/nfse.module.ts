import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { NfseController } from './nfse.controller';
import { NfseDanfseService } from './nfse-danfse.service';
import { NfseService } from './nfse.service';
import { NfseXmlParserService } from './nfse-xml-parser.service';

@Module({
  imports: [StorageModule],
  controllers: [NfseController],
  providers: [NfseService, NfseXmlParserService, NfseDanfseService],
  exports: [NfseService, NfseDanfseService, NfseXmlParserService]
})
export class NfseModule {}
