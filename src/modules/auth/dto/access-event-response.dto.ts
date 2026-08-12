import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccessEventResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['login_sucesso', 'login_falha', 'logout', 'token_renovado', 'sessao_expirada', 'acesso_negado'] })
  tipo!: 'login_sucesso' | 'login_falha' | 'logout' | 'token_renovado' | 'sessao_expirada' | 'acesso_negado';

  @ApiPropertyOptional()
  usuarioId?: string | null;

  @ApiPropertyOptional()
  sessaoId?: string | null;

  @ApiPropertyOptional()
  clienteId?: string | null;

  @ApiPropertyOptional()
  username?: string | null;

  @ApiPropertyOptional()
  ip?: string | null;

  @ApiPropertyOptional()
  userAgent?: string | null;

  @ApiPropertyOptional({ description: 'Detalhes adicionais do evento' })
  detalhes?: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;
}
