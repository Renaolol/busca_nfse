import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { NfeAmbiente } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class QueryCteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpjEmitente?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpjDestinatario?: string;

  @ApiPropertyOptional({ description: 'CNPJ base para consultar emitidos/recebidos (14 digitos)' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;

  @ApiPropertyOptional({ enum: ['ambas', 'emitidos', 'recebidos'], default: 'ambas' })
  @IsOptional()
  @IsIn(['ambas', 'emitidos', 'recebidos'])
  tipoRelacao?: 'ambas' | 'emitidos' | 'recebidos';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dataInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dataFim?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  schemaDoc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroCte?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(44, 44)
  chaveAcesso?: string;

  @ApiPropertyOptional({ enum: NfeAmbiente })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  somenteXmlCompleto?: boolean;
}
