import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import { NfeAmbiente } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ConfigureNfceScSyncDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty()
  @IsUUID()
  certificadoId!: string;

  @ApiProperty({ enum: NfeAmbiente })
  @IsEnum(NfeAmbiente)
  ambiente!: NfeAmbiente;

  @ApiProperty({ enum: [1, 2, 3, 9], default: 3 })
  @IsInt()
  @IsIn([1, 2, 3, 9])
  @Min(1)
  @Max(9)
  indAtor = 3;
}
