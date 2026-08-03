import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class RunNfeSyncDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({ enum: NfeAmbiente })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({
    description: 'Data inicial para varrer o catalogo Dominio no download manual por chave (YYYY-MM-DD). Padrao: 2026-01-02'
  })
  @IsOptional()
  @IsDateString()
  dataEmissaoInicio?: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limitControles?: number;
}
