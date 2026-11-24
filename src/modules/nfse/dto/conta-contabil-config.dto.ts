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

  @ApiPropertyOptional({ description: 'Codigo opcional do produto Dominio, aceitando caracteres imprimiveis exceto | e caracteres de controle' })
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

  @ApiPropertyOptional({ description: 'Codigo opcional do produto Dominio, aceitando caracteres imprimiveis exceto | e caracteres de controle', pattern: '^[^\\u0000-\\u001F\\u007F|]+$' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[^\u0000-\u001F\u007F|]+$/, { message: 'produto nao pode conter caracteres de controle nem |.' })
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

  @ApiPropertyOptional({ description: 'Codigo opcional do produto Dominio, aceitando caracteres imprimiveis exceto | e caracteres de controle', pattern: '^[^\\u0000-\\u001F\\u007F|]+$' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[^\u0000-\u001F\u007F|]+$/, { message: 'produto nao pode conter caracteres de controle nem |.' })
  produto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
