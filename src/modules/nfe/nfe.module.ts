import { Module } from '@nestjs/common';
import { NfeDistribuicaoModule } from '../../integrations/nfe-distribuicao/nfe-distribuicao.module';
import { StorageModule } from '../storage/storage.module';
import { NfeController } from './nfe.controller';
import { NfeService } from './nfe.service';
import { NfeXmlParserService } from './nfe-xml-parser.service';

@Module({
  imports: [StorageModule, NfeDistribuicaoModule],
  controllers: [NfeController],
  providers: [NfeService, NfeXmlParserService],
  exports: [NfeService, NfeXmlParserService]
})
export class NfeModule {}
