import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryNfceScStoredDocumentsDto extends PaginationQueryDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({ enum: ['ambas', 'emitidas', 'recebidas'] })
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
  @MaxLength(20)
  cnpj?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numeroNfce?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(44)
  chaveAcesso?: string;
}
