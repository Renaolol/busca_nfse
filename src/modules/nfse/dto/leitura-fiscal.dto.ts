import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NfseLeituraFiscalRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  estabelecimentoId!: string;

  @ApiPropertyOptional({ nullable: true })
  numeroNfse!: string | null;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiPropertyOptional({ nullable: true })
  dataEmissao!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  prestador!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cnpjPrestador!: string | null;

  @ApiPropertyOptional({ nullable: true })
  tomador!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cnpjTomador!: string | null;

  @ApiPropertyOptional({ nullable: true })
  municipio!: string | null;

  @ApiPropertyOptional({ nullable: true })
  codigoServicoPrestado!: string | null;

  @ApiPropertyOptional({ nullable: true })
  descricaoServico!: string | null;

  @ApiProperty({ enum: ['padrao_nacional', 'abrasf', 'desconhecido'] })
  layout!: 'padrao_nacional' | 'abrasf' | 'desconhecido';

  @ApiPropertyOptional()
  localPrestacao?: string;

  @ApiPropertyOptional()
  localIncidenciaIss?: string;

  @ApiPropertyOptional()
  valorServico?: string;

  @ApiPropertyOptional()
  valorLiquidoNfse?: string;

  @ApiPropertyOptional()
  valorTotalRetencoes?: string;

  @ApiPropertyOptional()
  valorIss?: string;

  @ApiPropertyOptional()
  valorIssRetido?: string;

  @ApiPropertyOptional()
  valorIssRetidoReal?: string;

  @ApiPropertyOptional()
  valorIrrf?: string;

  @ApiPropertyOptional()
  valorInss?: string;

  @ApiPropertyOptional()
  valorCsll?: string;

  @ApiPropertyOptional()
  valorPis?: string;

  @ApiPropertyOptional()
  valorCofins?: string;

  @ApiPropertyOptional()
  aliquotaIss?: string;

  @ApiPropertyOptional()
  aliquotaRealIss?: string;

  @ApiPropertyOptional()
  retencaoIss?: string;

  @ApiPropertyOptional({ enum: ['Retido', 'Normal'] })
  retencaoFederal?: 'Retido' | 'Normal';

  @ApiPropertyOptional()
  totalRetencoesFederais?: string;

  @ApiProperty({ enum: ['OK', 'Erro'] })
  statusProcessamento!: 'OK' | 'Erro';

  @ApiPropertyOptional()
  erroProcessamento?: string;

  @ApiProperty({ type: [String] })
  camposComProblema!: string[];
}

export class NfseLeituraFiscalSummaryDto {
  @ApiProperty()
  totalDocumentosFiltrados!: number;

  @ApiProperty()
  totalDocumentosLidos!: number;

  @ApiProperty()
  totalDocumentosComErro!: number;

  @ApiProperty()
  totalDocumentosSemXml!: number;

  @ApiPropertyOptional()
  valorServicoTotal?: number;

  @ApiPropertyOptional()
  valorLiquidoTotal?: number;

  @ApiPropertyOptional()
  valorRetidoTotal?: number;

  @ApiPropertyOptional()
  valorIssTotal?: number;

  @ApiPropertyOptional()
  valorIssRetidoRealTotal?: number;

  @ApiPropertyOptional()
  totalRetencoesFederais?: number;
}

export class NfseLeituraFiscalResumoMunicipioDto {
  @ApiProperty()
  municipio!: string;

  @ApiProperty()
  quantidadeNotas!: number;

  @ApiProperty()
  valorServicoTotal!: number;

  @ApiProperty()
  valorLiquidoTotal!: number;

  @ApiProperty()
  valorIssTotal!: number;
}

export class NfseLeituraFiscalResumoPorMunicipioDto {
  @ApiProperty({ type: [NfseLeituraFiscalResumoMunicipioDto] })
  localPrestacao!: NfseLeituraFiscalResumoMunicipioDto[];

  @ApiProperty({ type: [NfseLeituraFiscalResumoMunicipioDto] })
  localIncidenciaIss!: NfseLeituraFiscalResumoMunicipioDto[];
}

export class NfseLeituraFiscalResponseDto {
  @ApiProperty({ type: [NfseLeituraFiscalRowDto] })
  items!: NfseLeituraFiscalRowDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: NfseLeituraFiscalSummaryDto })
  summary!: NfseLeituraFiscalSummaryDto;

  @ApiProperty({ type: NfseLeituraFiscalResumoPorMunicipioDto })
  resumoPorMunicipio!: NfseLeituraFiscalResumoPorMunicipioDto;
}
