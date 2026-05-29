import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class StartSyncDto {
  @ApiPropertyOptional({
    enum: ['historico', 'diario'],
    default: 'historico',
    description: 'Modo de inicializacao da sincronizacao'
  })
  @IsOptional()
  @IsIn(['historico', 'diario'])
  modo?: 'historico' | 'diario';
}
