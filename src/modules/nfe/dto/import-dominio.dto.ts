import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min
} from 'class-validator';

export class ImportNfeFromDominioDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({ description: 'Importa somente para um estabelecimento especifico' })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ enum: NfeAmbiente, default: NfeAmbiente.producao })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional({ description: 'Quantidade maxima de XMLs trazidos da Dominio', default: 200, minimum: 1, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filtro inicial da data de emissao (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dataEmissaoInicio?: string;

  @ApiPropertyOptional({ description: 'Filtro final da data de emissao (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dataEmissaoFim?: string;

  @ApiPropertyOptional({ description: 'Lista opcional de chaves para importacao pontual', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(44, 44, { each: true })
  @Matches(/^\d{44}$/, { each: true })
  chavesAcesso?: string[];

  @ApiPropertyOptional({ description: 'Lista opcional de IDs de catalogo da Dominio para importacao pontual', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  catalogoIds?: number[];
}
