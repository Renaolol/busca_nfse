import { ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class RunSefazCpfImportDto {
  @ApiPropertyOptional({ description: 'Controle CPF que identifica o produtor selecionado no painel.' })
  @IsOptional()
  @IsUUID()
  controleId?: string;

  @ApiPropertyOptional({ description: 'Usa este certificado ativo do produtor para a consulta SEFAZ.' })
  @IsOptional()
  @IsUUID()
  certificadoId?: string;

  @ApiPropertyOptional({ description: 'Filtra os controles CPF por cliente; omitido consulta todos os produtores elegiveis.' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional({ enum: NfeAmbiente, description: 'Filtra o ambiente da consulta.' })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional({ description: 'Data inicial de emissao para importacao manual historica.' })
  @IsOptional()
  @IsDateString()
  dataEmissaoInicio?: string;

  @ApiPropertyOptional({ description: 'Data final de emissao para importacao manual historica.' })
  @IsOptional()
  @IsDateString()
  dataEmissaoFim?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 5000, description: 'Quantidade maxima de controles CPF a processar.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limitControles?: number;
}
