import { forwardRef, Module } from '@nestjs/common';
import { CteConsultaModule } from '../../integrations/cte-consulta/cte-consulta.module';
import { NfeModule } from '../nfe/nfe.module';
import { StorageModule } from '../storage/storage.module';
import { CteXmlParserService } from './cte-xml-parser.service';
import { CteController } from './cte.controller';
import { CteService } from './cte.service';

@Module({
  imports: [StorageModule, forwardRef(() => NfeModule), CteConsultaModule],
  controllers: [CteController],
  providers: [CteService, CteXmlParserService],
  exports: [CteService]
})
export class CteModule {}
