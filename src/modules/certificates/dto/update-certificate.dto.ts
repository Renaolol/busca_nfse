import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class UpdateCertificateDto {
  @ApiPropertyOptional({
    description: 'Cliente vinculado ao certificado. Informe null para deixar avulso.',
    nullable: true
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nome?: string;

  @ApiPropertyOptional({ description: 'CPF (11 digitos) ou CNPJ (14 digitos) do titular' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$|^\d{14}$/)
  cnpjTitular?: string;

  @ApiPropertyOptional({
    description: 'Estabelecimento vinculado ao certificado. Informe null para remover o vinculo.',
    nullable: true
  })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string | null;

  @ApiPropertyOptional({ description: 'Novo conteudo do arquivo .pfx/.p12 em Base64' })
  @IsOptional()
  @IsString()
  arquivoBase64?: string;

  @ApiPropertyOptional({ description: 'Nova senha do certificado ou senha do novo arquivo' })
  @IsOptional()
  @IsString()
  senha?: string;

  @ApiPropertyOptional({
    description: 'Anotacoes internas sobre uso, renovacao ou origem do certificado.',
    nullable: true
  })
  @IsOptional()
  @IsString()
  anotacoes?: string | null;
}
