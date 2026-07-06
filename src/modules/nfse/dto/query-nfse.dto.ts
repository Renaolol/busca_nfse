import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryNfseDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpjPrestador?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpjTomador?: string;

  @ApiPropertyOptional({ description: 'CNPJ base para consultar emitidas/tomadas (14 digitos)' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;

  @ApiPropertyOptional({ enum: ['ambas', 'emitidas', 'tomadas'], default: 'ambas' })
  @IsOptional()
  @IsIn(['ambas', 'emitidas', 'tomadas'])
  tipoRelacao?: 'ambas' | 'emitidas' | 'tomadas';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dataInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dataFim?: string;

  @ApiPropertyOptional({ description: 'Formato YYYY-MM' })
  @IsOptional()
  @IsString()
  competencia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

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
  @IsString()
  cnpj?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroNfse?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  municipio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  downloadInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  downloadFim?: string;

  @ApiPropertyOptional({ enum: ['Armazenado', 'Pendente', 'Erro'] })
  @IsOptional()
  @IsIn(['Armazenado', 'Pendente', 'Erro'])
  statusArmazenamento?: 'Armazenado' | 'Pendente' | 'Erro';
}
