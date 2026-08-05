import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';

class RecuperarNfsePorDpsGapDto {
  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'], description: 'Ambiente especifico da lacuna.' })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiPropertyOptional({ description: 'Serie fiscal associada a lacuna.', nullable: true })
  @IsOptional()
  @IsString()
  serie?: string | null;

  @ApiProperty({ description: 'Primeiro numero faltante da faixa.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numeroInicial!: number;

  @ApiProperty({ description: 'Ultimo numero faltante da faixa.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numeroFinal!: number;
}

export class RecuperarNfsePorDpsDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({
    description: 'Estabelecimento a ser usado no certificado. Quando omitido, sera resolvido por cliente + cnpjConsulta.'
  })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ description: 'CNPJ base da busca emitida, usado para localizar o estabelecimento automaticamente.' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;

  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'], default: 'producao' })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiProperty({
    type: [RecuperarNfsePorDpsGapDto],
    description: 'Faixas de numeracao pulada a recuperar automaticamente via DPS.'
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecuperarNfsePorDpsGapDto)
  lacunas!: RecuperarNfsePorDpsGapDto[];
}
