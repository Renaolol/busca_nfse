import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';

class RecuperarNfseLacunaDto {
  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'] })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiPropertyOptional({ description: 'Serie/DPS associada a lacuna detectada.' })
  @IsOptional()
  @IsString()
  serie?: string | null;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numeroInicial!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numeroFinal!: number;
}

export class RecuperarNfseLacunasDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({
    description: 'Estabelecimento a ser usado no certificado. Quando omitido, sera resolvido por cliente + cnpjConsulta.'
  })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ description: 'CNPJ emissor usado para localizar o estabelecimento automaticamente.' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;

  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'], default: 'producao' })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiPropertyOptional({ description: 'Municipio IBGE da prestacao. Quando omitido, o backend tenta inferir a partir dos documentos vizinhos.' })
  @IsOptional()
  @IsString()
  @Length(7, 7)
  municipioPrestacaoCodigo?: string;

  @ApiPropertyOptional({ default: 100, description: 'Limite de numeros faltantes a tentar nesta execucao.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limitDocuments?: number;

  @ApiProperty({ type: [RecuperarNfseLacunaDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecuperarNfseLacunaDto)
  lacunas!: RecuperarNfseLacunaDto[];
}
