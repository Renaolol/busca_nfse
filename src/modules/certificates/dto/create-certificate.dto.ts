import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateCertificateDto {
  @ApiProperty()
  @IsString()
  nome!: string;

  @ApiProperty({ description: 'CNPJ do titular com 14 digitos' })
  @IsString()
  @Length(14, 14)
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

  @ApiPropertyOptional({ description: 'ID de certificado antigo para substituicao' })
  @IsOptional()
  @IsUUID()
  substituirCertificadoId?: string;
}
