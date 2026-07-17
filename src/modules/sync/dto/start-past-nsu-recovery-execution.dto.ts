import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StartPastNsuRecoveryExecutionDto {
  @ApiProperty({
    description: 'Cliente alvo da execucao manual com progresso visual por NSU'
  })
  @IsUUID()
  clienteId!: string;
}
