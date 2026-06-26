import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';

const NIGHTLY_SWEEP_ALLOWED_SLOTS = ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'] as const;

export class UpdateSchedulerSettingsDto {
  @ApiPropertyOptional({
    description: 'Ativa ou desativa a rotina noturna global.',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Horarios ativos da rotina noturna global.',
    type: [String],
    example: ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00']
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NIGHTLY_SWEEP_ALLOWED_SLOTS, { each: true })
  activeSlots?: string[];
}
