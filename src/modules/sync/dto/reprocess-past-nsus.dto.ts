import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ReprocessPastNsusDto {
  @ApiPropertyOptional({
    description: 'Quando informado, limita a recuperacao aos controles deste cliente'
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
