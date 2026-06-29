import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class QueryNfeDto {
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

  @ApiPropertyOptional({ description: 'CNPJ base para consultar emitidas/recebidas (14 digitos)' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;

  @ApiPropertyOptional({ enum: ['ambas', 'emitidas', 'recebidas'], default: 'ambas' })
  @IsOptional()
  @IsIn(['ambas', 'emitidas', 'recebidas'])
  tipoRelacao?: 'ambas' | 'emitidas' | 'recebidas';

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
