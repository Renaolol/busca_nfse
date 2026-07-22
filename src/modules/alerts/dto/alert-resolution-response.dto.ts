import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AlertResolutionResponseDto {
  @ApiProperty()
  alertId!: string;

  @ApiProperty()
  fingerprint!: string;

  @ApiPropertyOptional()
  clientId!: string | null;

  @ApiPropertyOptional()
  origem!: string | null;

  @ApiPropertyOptional()
  titulo!: string | null;

  @ApiPropertyOptional()
  resolvedAt!: string | null;
}
