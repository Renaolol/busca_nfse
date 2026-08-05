import { Ambiente } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class NfseGapAuditRangeDto {
  @ApiProperty({ enum: Ambiente })
  @IsEnum(Ambiente)
  ambiente!: Ambiente;

  @ApiPropertyOptional({ description: 'Serie fiscal associada a lacuna detectada.', nullable: true })
  @IsOptional()
  @IsString()
  serie?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  numeroInicial!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  numeroFinal!: number;
}
