import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CteXmlParserService } from './cte-xml-parser.service';
import { CteController } from './cte.controller';
import { CteService } from './cte.service';

@Module({
  imports: [StorageModule],
  controllers: [CteController],
  providers: [CteService, CteXmlParserService],
  exports: [CteService]
})
export class CteModule {}
