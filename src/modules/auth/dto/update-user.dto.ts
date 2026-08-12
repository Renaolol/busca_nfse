import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9._-]{3,80}$/i, { message: 'username deve conter entre 3 e 80 caracteres alfanumericos ou ._-' })
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nome?: string;

  @ApiPropertyOptional({ enum: ['admin', 'comum', 'cliente'] })
  @IsOptional()
  @IsString()
  role?: 'admin' | 'comum' | 'cliente';

  @ApiPropertyOptional({ description: 'Obrigatorio quando role=cliente' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
