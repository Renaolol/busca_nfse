import { Module } from '@nestjs/common';
import { NfeModule } from '../nfe/nfe.module';
import { StorageModule } from '../storage/storage.module';
import { CteXmlParserService } from './cte-xml-parser.service';
import { CteController } from './cte.controller';
import { CteService } from './cte.service';

@Module({
  imports: [StorageModule, NfeModule],
  controllers: [CteController],
  providers: [CteService, CteXmlParserService],
  exports: [CteService]
})
export class CteModule {}
