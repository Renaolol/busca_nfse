import { Module } from '@nestjs/common';
import { DocumentChecksController } from './document-checks.controller';
import { DocumentChecksService } from './document-checks.service';

@Module({
  controllers: [DocumentChecksController],
  providers: [DocumentChecksService],
  exports: [DocumentChecksService]
})
export class DocumentChecksModule {}
