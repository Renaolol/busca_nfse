import { Module } from '@nestjs/common';
import { DANFE_PDF_GENERATOR } from './danfe.types';
import { RealDanfePdfGenerator } from './real-danfe-pdf.generator';

@Module({
  providers: [
    RealDanfePdfGenerator,
    {
      provide: DANFE_PDF_GENERATOR,
      useExisting: RealDanfePdfGenerator
    }
  ],
  exports: [DANFE_PDF_GENERATOR, RealDanfePdfGenerator]
})
export class DanfeModule {}
