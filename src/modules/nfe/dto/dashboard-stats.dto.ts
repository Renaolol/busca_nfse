import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DashboardNfeStatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class DashboardNfeStatsByClientDto {
  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  totalNfe!: number;

  @ApiProperty()
  xmlsCompletos!: number;
}

export class DashboardNfeStatsResponseDto {
  @ApiProperty()
  totalNfe!: number;

  @ApiProperty()
  xmlsCompletos!: number;

  @ApiProperty({ type: [DashboardNfeStatsByClientDto] })
  byClient!: DashboardNfeStatsByClientDto[];
}
