import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DashboardCteStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class DashboardCteStatsByClientDto {
  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  totalCte!: number;

  @ApiProperty()
  xmlsCompletos!: number;
}

export class DashboardCteStatsResponseDto {
  @ApiProperty()
  totalCte!: number;

  @ApiProperty()
  xmlsCompletos!: number;

  @ApiProperty({ type: [DashboardCteStatsByClientDto] })
  byClient!: DashboardCteStatsByClientDto[];
}
