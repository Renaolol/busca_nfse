import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ListNfseContaContabilConfigQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class NfseContaContabilConfigResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  codigoServico!: string;

  @ApiProperty()
  contaContabil!: string;

  @ApiProperty()
  ativo!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CreateNfseContaContabilConfigDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty({ description: 'Codigo do servico (Codigo Servico Nacional, com reserva para Item Lista Servico)' })
  @IsString()
  @MaxLength(50)
  codigoServico!: string;

  @ApiProperty({ description: 'Conta contabil Dominio a ser usada no debito do registro 1300 (Entrada) para esse codigo de servico' })
  @IsString()
  @MaxLength(50)
  contaContabil!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class UpdateNfseContaContabilConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contaContabil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
