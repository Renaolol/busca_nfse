import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimplesNacionalEmpresaDto {
  @ApiProperty({ description: 'Raiz do CNPJ (8 primeiros caracteres), usada na identificacao' })
  cnpjBase!: string;

  @ApiPropertyOptional({ nullable: true, description: 'CNPJ completo informado na planilha' })
  cnpj!: string | null;

  @ApiPropertyOptional({ nullable: true })
  razaoSocial!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Linha da planilha de origem' })
  linhaOrigem!: number | null;
}

export class SimplesNacionalImportacaoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nomeArquivo!: string;

  @ApiProperty({ description: 'Data/hora da importacao em ISO 8601' })
  importadoEm!: string;

  @ApiPropertyOptional({ nullable: true })
  importadoPor!: string | null;

  @ApiProperty({ description: 'Linhas com conteudo lidas apos o cabecalho' })
  totalLinhas!: number;

  @ApiProperty({ description: 'Empresas distintas (por raiz de CNPJ) gravadas' })
  totalEmpresas!: number;

  @ApiProperty({ description: 'Linhas sem CNPJ ou com CNPJ invalido' })
  totalIgnoradas!: number;

  @ApiProperty({ description: 'Linhas repetidas da mesma raiz de CNPJ (ex.: filiais)' })
  totalDuplicadas!: number;
}

export class SimplesNacionalResumoDto {
  @ApiProperty()
  totalEmpresas!: number;

  @ApiPropertyOptional({ type: SimplesNacionalImportacaoDto, nullable: true })
  ultimaImportacao!: SimplesNacionalImportacaoDto | null;
}

export class SimplesNacionalEmpresasPageDto {
  @ApiProperty({ type: [SimplesNacionalEmpresaDto] })
  items!: SimplesNacionalEmpresaDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  totalPages!: number;
}

export class SimplesNacionalConsultaDto {
  @ApiProperty({ description: 'CNPJ consultado, sem pontuacao' })
  cnpj!: string;

  @ApiProperty()
  cnpjBase!: string;

  @ApiProperty({ description: 'true quando a raiz do CNPJ consta na tabela do Simples Nacional' })
  optante!: boolean;

  @ApiPropertyOptional({ type: SimplesNacionalEmpresaDto, nullable: true })
  empresa!: SimplesNacionalEmpresaDto | null;
}

export class SimplesNacionalLinhaIgnoradaDto {
  @ApiProperty()
  linha!: number;

  @ApiProperty()
  valor!: string;

  @ApiProperty()
  motivo!: string;
}

export class SimplesNacionalImportacaoResultadoDto {
  @ApiProperty({ type: SimplesNacionalImportacaoDto })
  importacao!: SimplesNacionalImportacaoDto;

  @ApiProperty({ description: 'Cabecalho (ou coluna) identificado como CNPJ' })
  colunaCnpj!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Cabecalho (ou coluna) identificado como razao social' })
  colunaRazaoSocial!: string | null;

  @ApiProperty({
    type: [SimplesNacionalLinhaIgnoradaDto],
    description: 'Amostra das primeiras linhas ignoradas (ate 50)'
  })
  linhasIgnoradas!: SimplesNacionalLinhaIgnoradaDto[];
}

export class SimplesNacionalLimpezaDto {
  @ApiProperty()
  removidas!: number;
}
