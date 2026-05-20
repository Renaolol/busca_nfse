import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class TestSingleNsuDto {
  @ApiProperty({ description: 'ID do cliente' })
  @IsUUID()
  clienteId!: string;

  @ApiProperty({ description: 'ID do estabelecimento' })
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ description: 'NSU numerico para teste' })
  @IsString()
  @Matches(/^\d+$/)
  nsu!: string;

  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'], default: 'producao' })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';
}
