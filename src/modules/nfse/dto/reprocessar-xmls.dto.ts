import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReprocessarXmlsDto {
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
    description: 'Quantidade maxima de XMLs processados por chamada',
    default: 200,
    minimum: 1,
    maximum: 5000
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Quando true, processa apenas documentos com campos principais faltando',
    default: true
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  somenteIncompletos?: boolean;

  @ApiPropertyOptional({
    description: 'Quando true, regenera DANFSE durante o reprocessamento',
    default: true
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  regenerarDanfse?: boolean;
}

