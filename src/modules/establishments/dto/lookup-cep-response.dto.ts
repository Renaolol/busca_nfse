import { ApiProperty } from '@nestjs/swagger';

export class LookupCepResponseDto {
  @ApiProperty({ example: '88010000' })
  cep!: string;

  @ApiProperty({ example: 'Rua dos Ilhéus' })
  logradouro!: string;

  @ApiProperty({ example: 'Centro' })
  bairro!: string;

  @ApiProperty({ example: 'Florianópolis' })
  municipioNome!: string;

  @ApiProperty({ example: '4205407' })
  municipioCodigoIbge!: string;

  @ApiProperty({ example: 'SC' })
  uf!: string;
}
