import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsUUID, Max, Min } from 'class-validator';

export class QueryCst060AnalysisDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsDateString()
  dataInicial!: string;

  @ApiProperty()
  @IsDateString()
  dataFinal!: string;

  @ApiProperty({ example: 17.25 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(100)
  aliquotaInterna!: number;
}

export class Cst060AnalysisItemDto {
  @ApiProperty() nfeId!: string;
  @ApiProperty() chaveAcesso!: string;
  @ApiPropertyOptional() numeroNfe?: string;
  @ApiPropertyOptional() serie?: string;
  @ApiProperty() dataEmissao!: string;
  @ApiProperty() itemNumero!: number;
  @ApiPropertyOptional() codigoProduto?: string;
  @ApiPropertyOptional() descricaoProduto?: string;
  @ApiPropertyOptional() ncm?: string;
  @ApiPropertyOptional() cest?: string;
  @ApiPropertyOptional() cfop?: string;
  @ApiPropertyOptional() unidade?: string;
  @ApiProperty() quantidade!: number;
  @ApiProperty() valorUnitario!: number;
  @ApiProperty() valorProduto!: number;
  @ApiProperty() desconto!: number;
  @ApiProperty() baseCalculada!: number;
  @ApiProperty() aliquotaInterna!: number;
  @ApiProperty({ enum: ['informada', 'regra-pneu'] }) origemAliquota!: 'informada' | 'regra-pneu';
  @ApiProperty() icmsStXml!: number;
  @ApiProperty() icmsCalculado!: number;
  @ApiProperty() diferenca!: number;
  @ApiProperty() diferencaAbsoluta!: number;
  @ApiProperty({ enum: ['OK', 'Divergente'] }) status!: 'OK' | 'Divergente';
  @ApiPropertyOptional() vBCSTRet?: number;
  @ApiPropertyOptional() pST?: number;
  @ApiPropertyOptional() vICMSSubstituto?: number;
  @ApiPropertyOptional() origemMercadoria?: string;
  @ApiPropertyOptional() cnpjEmitente?: string;
  @ApiPropertyOptional() razaoSocialEmitente?: string;
  @ApiPropertyOptional() cnpjDestinatario?: string;
  @ApiPropertyOptional() razaoSocialDestinatario?: string;
}

export class Cst060AnalysisResponseDto {
  @ApiProperty() notasAnalisadas!: number;
  @ApiProperty() notasComCst060!: number;
  @ApiProperty() itensCst060!: number;
  @ApiProperty() totalValorProdutos!: number;
  @ApiProperty() totalDescontos!: number;
  @ApiProperty() totalBaseCalculada!: number;
  @ApiProperty() totalIcmsStXml!: number;
  @ApiProperty() totalIcmsCalculado!: number;
  @ApiProperty() totalDiferenca!: number;
  @ApiProperty({ type: [Cst060AnalysisItemDto] }) items!: Cst060AnalysisItemDto[];
}
