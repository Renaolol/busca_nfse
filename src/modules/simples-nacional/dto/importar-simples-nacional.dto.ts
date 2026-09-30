import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ImportarSimplesNacionalDto {
  @ApiProperty({ description: 'Nome original do arquivo (.xlsx, .csv ou .txt)', example: 'empresas-simples.xlsx' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nomeArquivo!: string;

  @ApiProperty({
    description:
      'Conteudo do arquivo em Base64. A planilha precisa ter uma coluna "CNPJ"; a coluna "Razao Social" (ou "Nome"/"Empresa") e opcional.'
  })
  @IsString()
  @IsNotEmpty()
  arquivoBase64!: string;
}
