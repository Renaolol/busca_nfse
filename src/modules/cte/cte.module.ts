import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CteController } from './cte.controller';
import { CteService } from './cte.service';

@Module({
  imports: [StorageModule],
  controllers: [CteController],
  providers: [CteService],
  exports: [CteService]
})
export class CteModule {}
