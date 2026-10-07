import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
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

  @ApiPropertyOptional({ enum: ['Padrao', 'PorFornecedor', 'Caixa'], default: 'Padrao' })
  @IsOptional()
  @IsIn(['Padrao', 'PorFornecedor', 'Caixa'])
  contas?: 'Padrao' | 'PorFornecedor' | 'Caixa';

  @ApiPropertyOptional({
    description: 'Inclui os registros de produtos/estoque 1030 (Entrada) ou 3030 (Servico) no arquivo',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  incluirEstoque?: boolean;

  @ApiPropertyOptional({
    description: 'Codigo alfanumerico opcional do produto para os registros 1030/3030',
    pattern: '^[A-Za-z0-9]+$'
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    const normalized = String(value).trim();
    return normalized || undefined;
  })
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: 'produtoPadrao deve conter apenas letras e numeros.' })
  produtoPadrao?: string;

  @ApiPropertyOptional({
    description: 'Acumulador Dominio para NFS-e de Entrada sem retencoes',
    pattern: '^[A-Za-z0-9]+$'
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value).trim()))
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: 'acumuladorEntradaSemRetencoes deve conter apenas letras e numeros.' })
  acumuladorEntradaSemRetencoes?: string;

  @ApiPropertyOptional({
    description: 'Acumulador Dominio para NFS-e de Entrada com retencoes',
    pattern: '^[A-Za-z0-9]+$'
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value).trim()))
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: 'acumuladorEntradaComRetencoes deve conter apenas letras e numeros.' })
  acumuladorEntradaComRetencoes?: string;

  @ApiPropertyOptional({
    description: 'Acumulador Dominio para NFS-e de Servico sem retencoes',
    pattern: '^[A-Za-z0-9]+$'
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value).trim()))
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: 'acumuladorServicoSemRetencoes deve conter apenas letras e numeros.' })
  acumuladorServicoSemRetencoes?: string;

  @ApiPropertyOptional({
    description: 'Acumulador Dominio para NFS-e de Servico com retencoes',
    pattern: '^[A-Za-z0-9]+$'
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? value : String(value).trim()))
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: 'acumuladorServicoComRetencoes deve conter apenas letras e numeros.' })
  acumuladorServicoComRetencoes?: string;
}
