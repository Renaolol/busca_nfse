import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

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

  @ApiPropertyOptional({
    description: 'CPF (11 digitos) ou CNPJ (14 digitos) explicito. Quando omitido usa o identificador do estabelecimento.',
    minLength: 11,
    maxLength: 14,
    pattern: '^(?:\\d{11}|\\d{14})$'
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{11}|\d{14})$/)
  cnpjConsulta?: string;
}
