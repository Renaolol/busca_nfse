import { ApiProperty } from '@nestjs/swagger';
import { SystemUpdateResponseDto } from './system-update-response.dto';

export class DailyUpdateReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-11-10' })
  dataReferencia!: Date;

  @ApiProperty({ format: 'date-time' })
  geradoEm!: Date;

  @ApiProperty({ type: [SystemUpdateResponseDto] })
  registros!: SystemUpdateResponseDto[];
}
