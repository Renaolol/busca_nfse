import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class BuscarCodigoEmpresaDominioDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;
}
