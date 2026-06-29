import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class PauseNfeSyncDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({ enum: NfeAmbiente })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;
}
