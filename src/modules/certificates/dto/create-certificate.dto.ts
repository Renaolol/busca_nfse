import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class CreateCertificateDto {
  @ApiPropertyOptional({ description: 'Cliente vinculado ao certificado. Opcional para certificados avulsos.' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiProperty()
  @IsString()
  nome!: string;

  @ApiProperty({ description: 'CPF (11 digitos) ou CNPJ (14 digitos) do titular' })
  @IsString()
  @Matches(/^\d{11}$|^\d{14}$/)
  cnpjTitular!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiProperty({ description: 'Conteudo do arquivo .pfx/.p12 em Base64' })
  @IsString()
  arquivoBase64!: string;

  @ApiProperty({ description: 'Senha do certificado' })
  @IsString()
  senha!: string;

  @ApiPropertyOptional({ description: 'Opcional. Quando informado, sera ignorado e preenchido automaticamente a partir do .pfx/.p12.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validadeInicio?: Date;

  @ApiPropertyOptional({ description: 'Opcional. Quando informado, sera ignorado e preenchido automaticamente a partir do .pfx/.p12.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validadeFim?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbprint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emissor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Anotacoes internas sobre uso, renovacao ou origem do certificado.' })
  @IsOptional()
  @IsString()
  anotacoes?: string;

  @ApiPropertyOptional({ description: 'ID de certificado antigo para substituicao' })
  @IsOptional()
  @IsUUID()
  substituirCertificadoId?: string;
}
