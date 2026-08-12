import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthenticatedUserDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional()
  nome?: string;

  @ApiProperty({ enum: ['admin', 'comum', 'cliente'] })
  role!: 'admin' | 'comum' | 'cliente';

  @ApiPropertyOptional()
  clienteId?: string;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty({ description: 'Data/hora ISO de expiracao da sessao' })
  sessionExpiresAt!: string;
}
