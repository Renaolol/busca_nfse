import { forwardRef, Module } from '@nestjs/common';
import { CteModule } from '../cte/cte.module';
import { DominioNfeModule } from '../../integrations/dominio-nfe/dominio-nfe.module';
import { NfeDistribuicaoModule } from '../../integrations/nfe-distribuicao/nfe-distribuicao.module';
import { NfseModule } from '../nfse/nfse.module';
import { StorageModule } from '../storage/storage.module';
import { NfeController } from './nfe.controller';
import { NfeService } from './nfe.service';
import { NfeXmlParserService } from './nfe-xml-parser.service';

@Module({
  imports: [StorageModule, NfeDistribuicaoModule, DominioNfeModule, NfseModule, forwardRef(() => CteModule)],
  controllers: [NfeController],
  providers: [NfeService, NfeXmlParserService],
  exports: [NfeService, NfeXmlParserService]
})
export class NfeModule {}
