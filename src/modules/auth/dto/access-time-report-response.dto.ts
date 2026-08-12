import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccessTimeReportResponseDto {
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

  @ApiProperty({ description: 'Quantidade de sessoes com intersecao no periodo informado' })
  totalSessions!: number;

  @ApiProperty({ description: 'Quantidade de sessoes ainda ativas entre as encontradas' })
  activeSessions!: number;

  @ApiProperty({ description: 'Tempo total logado no periodo, em milissegundos' })
  totalDurationMs!: number;

  @ApiPropertyOptional()
  lastLoginAt?: string | null;

  @ApiPropertyOptional()
  lastActivityAt?: string | null;
}
