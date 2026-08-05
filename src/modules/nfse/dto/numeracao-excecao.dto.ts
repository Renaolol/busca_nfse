import { Ambiente, NfseNumeracaoExcecaoTipo } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListNfseNumeracaoExcecoesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpjConsulta?: string;
}

export class NfseNumeracaoExcecaoResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  cnpjConsulta!: string;

  @ApiProperty({ enum: Ambiente })
  ambiente!: Ambiente;

  @ApiProperty()
  numeroNfse!: number;

  @ApiProperty({ enum: NfseNumeracaoExcecaoTipo })
  tipo!: NfseNumeracaoExcecaoTipo;

  @ApiPropertyOptional({ nullable: true })
  observacao!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CreateNfseNumeracaoExcecaoDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsString()
  cnpjConsulta!: string;

  @ApiProperty({ enum: Ambiente })
  @IsEnum(Ambiente)
  ambiente!: Ambiente;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999999)
  numeroNfse!: number;

  @ApiProperty({ enum: NfseNumeracaoExcecaoTipo })
  @IsEnum(NfseNumeracaoExcecaoTipo)
  tipo!: NfseNumeracaoExcecaoTipo;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacao?: string;
}
