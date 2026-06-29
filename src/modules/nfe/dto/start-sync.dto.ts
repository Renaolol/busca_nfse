import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class StartNfeSyncDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ enum: NfeAmbiente, default: NfeAmbiente.producao })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional({ description: 'NSU inicial apenas para novos controles', example: '1' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  nsuInicial?: string;

  @ApiPropertyOptional({ description: 'CNPJ de consulta explicito. Quando omitido usa o CNPJ do estabelecimento.' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;
}
