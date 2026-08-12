import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  usuarioId!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional()
  nome?: string;

  @ApiProperty({ enum: ['admin', 'comum', 'cliente'] })
  role!: 'admin' | 'comum' | 'cliente';

  @ApiPropertyOptional()
  clienteId?: string;

  @ApiProperty()
  loginAt!: string;

  @ApiProperty()
  lastSeenAt!: string;

  @ApiPropertyOptional()
  logoutAt?: string | null;

  @ApiProperty()
  expiresAt!: string;

  @ApiPropertyOptional()
  revokedAt?: string | null;

  @ApiPropertyOptional()
  ip?: string | null;

  @ApiPropertyOptional()
  userAgent?: string | null;

  @ApiProperty({ description: 'Duracao acumulada em milissegundos' })
  durationMs!: number;

  @ApiProperty({ description: 'Indica se a sessao ainda pode ser usada' })
  ativa!: boolean;
}
