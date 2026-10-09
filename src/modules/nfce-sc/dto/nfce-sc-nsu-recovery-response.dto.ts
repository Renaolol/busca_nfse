import { ApiProperty } from '@nestjs/swagger';

export class NfceScNsuRecoveryResponseDto {
  @ApiProperty({ example: true })
  accepted!: boolean;

  @ApiProperty({ example: true, description: 'Indica se esta chamada iniciou ou retomou a recuperação.' })
  started!: boolean;

  @ApiProperty({ enum: ['processando'], example: 'processando' })
  status!: 'processando';

  @ApiProperty({ example: '1000' })
  nsuInicial!: string;

  @ApiProperty({ example: '1500' })
  nsuFinal!: string;

  @ApiProperty({ example: '1250', description: 'Último cursor confirmado da consulta de recuperação.' })
  nsuAtual!: string;

  @ApiProperty({ example: 250 })
  totalDocumentos!: number;

  @ApiProperty({ example: 'Reprocessamento do intervalo NSU 1000–1500 em andamento.' })
  mensagem!: string;
}
