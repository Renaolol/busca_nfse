import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, ValidateNested } from 'class-validator';
import { QueryNfseDto } from './query-nfse.dto';

function normalizeIbsCbsOverrideValue(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || String(value).trim() === '') {
    return null;
  }
  return String(value).trim();
}

export class NfseDominioIbsCbsOverrideDto {
  @ApiProperty({ format: 'uuid', description: 'ID do documento NFS-e exibido no Leitor Fiscal' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d{3}$', description: 'CST do IBS/CBS; nulo limpa o valor do XML' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d{3}$/)
  cstIbsCbs?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d{6}$', description: 'cClassTrib; nulo limpa o valor do XML' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d{6}$/)
  cClassTribIbsCbs?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d+(?:[.,]\\d{1,2})?$' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d+(?:[.,]\d{1,2})?$/)
  baseCalculoIbsCbs?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d+(?:[.,]\\d{1,6})?$' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d+(?:[.,]\d{1,6})?$/)
  aliquotaIbsTotal?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d+(?:[.,]\\d{1,2})?$' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d+(?:[.,]\d{1,2})?$/)
  valorIbsTotal?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d+(?:[.,]\\d{1,6})?$' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d+(?:[.,]\d{1,6})?$/)
  aliquotaCbs?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: '^\\d+(?:[.,]\\d{1,2})?$' })
  @IsOptional()
  @Transform(({ value }) => normalizeIbsCbsOverrideValue(value))
  @IsString()
  @Matches(/^\d+(?:[.,]\d{1,2})?$/)
  valorCbs?: string | null;
}

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
    type: [NfseDominioIbsCbsOverrideDto],
    description: 'Edicoes de IBS/CBS por documento. Quando um campo for omitido, o valor do XML sera usado; envie nulo para limpar um campo.'
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => NfseDominioIbsCbsOverrideDto)
  ibscbsOverrides?: NfseDominioIbsCbsOverrideDto[];

  @ApiPropertyOptional({
    description: 'Inclui os registros de produtos/estoque 1030 (Entrada) ou 3030 (Servico) no arquivo',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  incluirEstoque?: boolean;

  @ApiPropertyOptional({
    description: 'Codigo opcional do produto para os registros 1030/3030; aceita caracteres imprimiveis exceto | e caracteres de controle',
    pattern: '^[^\\u0000-\\u001F\\u007F|]+$'
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
  @Matches(/^[^\u0000-\u001F\u007F|]+$/, { message: 'produtoPadrao nao pode conter caracteres de controle nem |.' })
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
