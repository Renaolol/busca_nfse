import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateClientDto {
  @ApiProperty()
  @IsString()
  razaoSocial!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nomeFantasia?: string;

  @ApiProperty({ description: 'CNPJ com 14 digitos numericos' })
  @IsString()
  @Length(14, 14)
  cnpj!: string;

  @ApiPropertyOptional({ description: 'Inscricao municipal do estabelecimento principal' })
  @IsOptional()
  @IsString()
  inscricaoMunicipal?: string;

  @ApiPropertyOptional({ description: 'Codigo IBGE do municipio do estabelecimento principal' })
  @IsOptional()
  @IsString()
  municipioCodigoIbge?: string;

  @ApiPropertyOptional({ description: 'Municipio do estabelecimento principal' })
  @IsOptional()
  @IsString()
  municipioNome?: string;

  @ApiPropertyOptional({ description: 'Responsavel interno pelo cliente' })
  @IsOptional()
  @IsString()
  responsavelInterno?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  emailResponsavel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefone?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Controla se o cliente participa das rotinas de busca de NF-e' })
  @IsOptional()
  @IsBoolean()
  nfeHabilitado?: boolean;

  @ApiPropertyOptional({ description: 'Codigo da empresa no Dominio/Contabil, usado para preencher a exportacao Dominio automaticamente' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  codigoEmpresaDominio?: number;
}
