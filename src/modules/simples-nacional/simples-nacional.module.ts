import { Module } from '@nestjs/common';
import { SimplesNacionalPlanilhaParserService } from './simples-nacional-planilha-parser.service';
import { SimplesNacionalController } from './simples-nacional.controller';
import { SimplesNacionalService } from './simples-nacional.service';

@Module({
  controllers: [SimplesNacionalController],
  providers: [SimplesNacionalService, SimplesNacionalPlanilhaParserService],
  exports: [SimplesNacionalService]
})
export class SimplesNacionalModule {}
