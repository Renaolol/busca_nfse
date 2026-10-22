import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { NfeAmbiente } from '@prisma/client';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

function parseOptionalBoolean(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export class QueryNfeDto extends PaginationQueryDto {
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

  @ApiPropertyOptional({
    description: 'CPF (11 digitos) ou CNPJ (14 digitos) para consultar emitidas/recebidas',
    minLength: 11,
    maxLength: 14,
    pattern: '^(?:\\d{11}|\\d{14})$'
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{11}|\d{14})$/)
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

  @ApiPropertyOptional({ description: 'Modelo fiscal do documento (por exemplo, 55 para NF-e e 65 para NFC-e)' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  modelo?: string;

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

  @ApiPropertyOptional({ description: 'Sem outro filtro, a listagem normal retorna apenas XMLs completos. Envie false para incluir resumos junto com XMLs completos.' })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  somenteXmlCompleto?: boolean;

  @ApiPropertyOptional({ description: 'Retorna apenas registros identificados como resumos resNFe pendentes; nunca os contabiliza como XML completo.' })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value))
  @IsBoolean()
  somenteResumos?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpj?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroNfe?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(44, 44)
  chaveAcesso?: string;

  @ApiPropertyOptional({ enum: NfeAmbiente })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional({
    description: 'Quando true, ignora page/pageSize e retorna todos os registros de NF-e que casam com o filtro, sem aplicar limite de seguranca.'
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  all?: boolean;
}
