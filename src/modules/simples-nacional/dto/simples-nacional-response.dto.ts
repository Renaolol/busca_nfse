import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SimplesNacionalEmpresaDto {
  @ApiProperty({ description: 'Raiz do CNPJ (8 primeiros caracteres), usada na identificacao' })
  cnpjBase!: string;

  @ApiPropertyOptional({ nullable: true, description: 'CNPJ completo informado na planilha' })
  cnpj!: string | null;

  @ApiPropertyOptional({ nullable: true })
  razaoSocial!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Linha do arquivo de origem' })
  linhaOrigem!: number | null;
}

export class SimplesNacionalLinhaIgnoradaDto {
  @ApiProperty()
  linha!: number;

  @ApiProperty()
  valor!: string;

  @ApiProperty()
  motivo!: string;
}

export class SimplesNacionalImportacaoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nomeArquivo!: string;

  @ApiProperty({ enum: ['processando', 'concluida', 'erro'] })
  status!: 'processando' | 'concluida' | 'erro';

  @ApiPropertyOptional({
    nullable: true,
    enum: ['planilha', 'receita_simples'],
    description: 'receita_simples = arquivo Simples dos dados abertos do CNPJ (Receita Federal)'
  })
  layout!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Cabecalho (ou coluna) identificado como CNPJ' })
  colunaCnpj!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Cabecalho (ou coluna) identificado como razao social' })
  colunaRazaoSocial!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Coluna usada para filtrar apenas as linhas optantes' })
  colunaOpcao!: string | null;

  @ApiProperty({ description: 'Data/hora do envio em ISO 8601' })
  importadoEm!: string;

  @ApiProperty({ description: 'Ultima atualizacao de progresso em ISO 8601' })
  atualizadoEm!: string;

  @ApiPropertyOptional({ nullable: true })
  concluidoEm!: string | null;

  @ApiPropertyOptional({ nullable: true })
  importadoPor!: string | null;

  @ApiProperty({ description: 'Linhas lidas ate o momento (progresso)' })
  linhasProcessadas!: number;

  @ApiProperty({ description: 'Linhas com conteudo lidas apos o cabecalho' })
  totalLinhas!: number;

  @ApiProperty({ description: 'Empresas distintas (por raiz de CNPJ) gravadas' })
  totalEmpresas!: number;

  @ApiProperty({ description: 'Linhas sem CNPJ ou com CNPJ invalido' })
  totalIgnoradas!: number;

  @ApiProperty({ description: 'Linhas repetidas da mesma raiz de CNPJ (ex.: filiais)' })
  totalDuplicadas!: number;

  @ApiProperty({ description: 'Linhas de empresas nao optantes (ex.: opcao "N" no arquivo da Receita)' })
  totalNaoOptantes!: number;

  @ApiProperty({ type: [SimplesNacionalLinhaIgnoradaDto], description: 'Amostra das primeiras linhas ignoradas (ate 50)' })
  linhasIgnoradas!: SimplesNacionalLinhaIgnoradaDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Motivo da falha quando status = erro' })
  mensagem!: string | null;
}

export class SimplesNacionalResumoDto {
  @ApiProperty({ description: 'Empresas da tabela ativa' })
  totalEmpresas!: number;

  @ApiPropertyOptional({ type: SimplesNacionalImportacaoDto, nullable: true, description: 'Tabela ativa' })
  ultimaImportacao!: SimplesNacionalImportacaoDto | null;

  @ApiPropertyOptional({
    type: SimplesNacionalImportacaoDto,
    nullable: true,
    description: 'Importacao mais recente que a tabela ativa, em processamento ou com erro'
  })
  ultimaTentativa!: SimplesNacionalImportacaoDto | null;
}

export class SimplesNacionalEmpresasPageDto {
  @ApiProperty({ type: [SimplesNacionalEmpresaDto] })
  items!: SimplesNacionalEmpresaDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Total da tabela; null quando ha filtro (sem contagem exata)' })
  total!: number | null;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiPropertyOptional({ nullable: true, description: 'null quando ha filtro (sem contagem exata)' })
  totalPages!: number | null;

  @ApiProperty({ description: 'true quando existe uma proxima pagina' })
  temMais!: boolean;
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

export class SimplesNacionalConsultaLoteRespostaDto {
  @ApiProperty({ type: [String], description: 'Raizes (8 caracteres) dos CNPJs informados que constam na tabela' })
  cnpjBases!: string[];
}

export class SimplesNacionalLimpezaDto {
  @ApiProperty()
  removidas!: number;
}
