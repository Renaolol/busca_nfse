import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class QueryNfeByNsuDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ description: 'NSU a consultar', example: '15' })
  @IsString()
  @Matches(/^\d+$/)
  nsu!: string;

  @ApiPropertyOptional({ enum: NfeAmbiente, default: NfeAmbiente.producao })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  persistir?: boolean;
}
