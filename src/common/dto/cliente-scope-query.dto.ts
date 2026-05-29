import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ClienteScopeQueryDto {
  @ApiProperty({ description: 'ID do cliente para escopo de acesso' })
  @IsUUID()
  clienteId!: string;
}
