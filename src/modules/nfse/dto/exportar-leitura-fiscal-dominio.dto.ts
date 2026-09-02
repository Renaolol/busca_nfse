import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { QueryNfseDto } from './query-nfse.dto';

export class ExportarLeituraFiscalDominioDto extends QueryNfseDto {
  @ApiProperty()
  @IsUUID()
  declare clienteId: string;

  @ApiProperty({ description: 'Codigo da empresa no Dominio/Contabil' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  codigoEmpresa!: number;

  @ApiProperty({ enum: ['Entrada', 'Servico'], default: 'Entrada' })
  @IsIn(['Entrada', 'Servico'])
  tipoRegistro!: 'Entrada' | 'Servico';

  @ApiPropertyOptional({ enum: ['Padrao', 'PorFornecedor'], default: 'Padrao' })
  @IsOptional()
  @IsIn(['Padrao', 'PorFornecedor'])
  contas?: 'Padrao' | 'PorFornecedor';

  @ApiPropertyOptional({
    description: 'Codigo alfanumerico do produto padrao para os registros 1030/3030',
    default: '557',
    pattern: '^[A-Za-z0-9]+$'
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value).trim()))
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: 'produtoPadrao deve conter apenas letras e numeros.' })
  produtoPadrao?: string;
}
