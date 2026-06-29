import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { NfeAmbiente, NfeTipoRelacao } from '@prisma/client';

export class ImportNfeXmlDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ enum: NfeAmbiente })
  @IsEnum(NfeAmbiente)
  ambiente!: NfeAmbiente;

  @ApiProperty({ description: 'XML da NF-e em Base64' })
  @IsBase64()
  xmlBase64!: string;

  @ApiPropertyOptional({ enum: NfeTipoRelacao })
  @IsOptional()
  @IsEnum(NfeTipoRelacao)
  tipoRelacao?: NfeTipoRelacao;

  @ApiPropertyOptional({ description: 'CNPJ usado como referencia para inferir relacao de emitida/recebida' })
  @IsOptional()
  @IsString()
  cnpjConsulta?: string;
}
