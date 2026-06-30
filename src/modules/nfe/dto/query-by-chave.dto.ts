import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class QueryNfeByChaveDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ description: 'Chave de acesso da NF-e', minLength: 44, maxLength: 44 })
  @IsString()
  @Length(44, 44)
  chaveAcesso!: string;

  @ApiPropertyOptional({ enum: NfeAmbiente, default: NfeAmbiente.producao })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  persistir?: boolean;
}
