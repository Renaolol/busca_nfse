import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CertificateScopeQueryDto {
  @ApiPropertyOptional({
    description: 'ID do cliente para validar escopo quando o certificado esta vinculado a um cliente'
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
