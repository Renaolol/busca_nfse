import { Module } from '@nestjs/common';
import { CompareSpedController } from './compare-sped.controller';
import { CompareSpedService } from './compare-sped.service';

@Module({
  controllers: [CompareSpedController],
  providers: [CompareSpedService],
  exports: [CompareSpedService]
})
export class CompareSpedModule {}
