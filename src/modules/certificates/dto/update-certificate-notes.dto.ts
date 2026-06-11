import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateCertificateNotesDto {
  @ApiPropertyOptional({ description: 'Anotacoes internas sobre o certificado' })
  @IsOptional()
  @IsString()
  anotacoes?: string;
}
