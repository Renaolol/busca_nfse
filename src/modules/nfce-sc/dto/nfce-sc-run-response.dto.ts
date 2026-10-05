import { ApiProperty } from '@nestjs/swagger';

export class NfceScRunResponseDto {
  @ApiProperty({ example: true })
  accepted!: boolean;

  @ApiProperty({ example: true, description: 'Indica se esta chamada iniciou uma nova sincronizacao.' })
  started!: boolean;

  @ApiProperty({ enum: ['processando'], example: 'processando' })
  status!: 'processando';

  @ApiProperty({ example: '12345' })
  ultimoNsu!: string;

  @ApiProperty({ example: 250 })
  totalDocumentosBaixados!: number;

  @ApiProperty({ example: 'Consulta SEF/SC em andamento. A continuacao dos lotes e automatica.' })
  mensagem!: string;
}
