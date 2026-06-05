import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReprocessarDanfsesDto {
  @ApiPropertyOptional({ description: 'Filtra por cliente' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'Filtra por estabelecimento' })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'] })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiPropertyOptional({
    description: 'Quantidade maxima total de documentos processados. Quando ausente, processa todos os elegiveis.',
    minimum: 1,
    maximum: 100000
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Quantidade de documentos buscados por lote interno',
    default: 100,
    minimum: 1,
    maximum: 500
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  lote?: number;

  @ApiPropertyOptional({
    description: 'Quando true, regenera apenas DANFSE ausente ou PDF legado',
    default: true
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  somenteLegadas?: boolean;
}

class ReprocessarDanfsesErroDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiProperty()
  erro!: string;
}

export class ReprocessarDanfsesResponseDto {
  @ApiProperty({ type: Object })
  filtros!: Record<string, unknown>;

  @ApiProperty()
  processados!: number;

  @ApiProperty()
  regeneradas!: number;

  @ApiProperty()
  ignoradas!: number;

  @ApiProperty()
  falhas!: number;

  @ApiProperty({ type: [ReprocessarDanfsesErroDto] })
  erros!: ReprocessarDanfsesErroDto[];
}
