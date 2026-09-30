import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ImportarSimplesNacionalQueryDto {
  @ApiProperty({ description: 'Nome original do arquivo (.csv, .txt, .xlsx ou .zip)', example: 'Simples.zip' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nomeArquivo!: string;
}
