import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DashboardStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class DashboardStatsByClientDto {
  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  totalNfse!: number;

  @ApiProperty()
  storedXmls!: number;
}

export class DashboardStatsResponseDto {
  @ApiProperty()
  totalNfse!: number;

  @ApiProperty()
  storedXmls!: number;

  @ApiProperty({ type: [DashboardStatsByClientDto] })
  byClient!: DashboardStatsByClientDto[];
}
