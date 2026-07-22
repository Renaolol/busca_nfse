import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateAlertResolutionDto {
  @ApiProperty({ description: 'Marca ou desmarca o alerta como resolvido' })
  @IsBoolean()
  resolvido!: boolean;

  @ApiProperty({ description: 'Fingerprint atual do alerta para evitar reaproveitar resolucoes antigas' })
  @IsString()
  fingerprint!: string;

  @ApiPropertyOptional({ description: 'Cliente relacionado ao alerta' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Origem do alerta' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  origem?: string;

  @ApiPropertyOptional({ description: 'Titulo atual do alerta' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  titulo?: string;
}
