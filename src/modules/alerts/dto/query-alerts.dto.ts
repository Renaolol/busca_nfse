import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryAlertsDto {
  @ApiPropertyOptional({ description: 'Filtra alertas por cliente' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ enum: ['Todos', 'Aberto', 'Resolvido'], default: 'Todos' })
  @IsOptional()
  @IsIn(['Todos', 'Aberto', 'Resolvido'])
  status?: 'Todos' | 'Aberto' | 'Resolvido';
}
