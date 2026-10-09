import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export class ReprocessNfceScNsusDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty({ description: 'Primeiro NSU do intervalo, inclusive. Zero consulta desde o primeiro NSU ainda disponível.', example: '1000' })
  @IsString()
  @Matches(/^\d{1,18}$/)
  nsuInicial!: string;

  @ApiProperty({ description: 'Último NSU do intervalo, inclusive. Não pode ultrapassar o cursor principal do controle.', example: '1500' })
  @IsString()
  @Matches(/^\d{1,18}$/)
  nsuFinal!: string;
}
