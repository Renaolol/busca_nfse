import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Codigo do produto padrao para os registros 1030/3030', default: 557 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  produtoPadrao?: number;
}
