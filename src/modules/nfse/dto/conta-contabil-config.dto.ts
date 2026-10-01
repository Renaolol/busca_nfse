import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Codigo alfanumerico opcional do produto Dominio a ser usado no registro 1030 para esse codigo de servico' })
  produto?: string | null;

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

  @ApiPropertyOptional({ description: 'Codigo alfanumerico opcional do produto Dominio a ser usado no registro 1030 para esse codigo de servico', pattern: '^[A-Za-z0-9]+$' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'produto deve conter apenas letras e numeros.' })
  produto?: string;

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

  @ApiPropertyOptional({ description: 'Codigo alfanumerico opcional do produto Dominio para esse codigo de servico', pattern: '^[A-Za-z0-9]+$' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'produto deve conter apenas letras e numeros.' })
  produto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
