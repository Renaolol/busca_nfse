import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class LoginUserDto {
  @ApiPropertyOptional({ description: 'UUID do usuario quando configurado em AUTH_USERS_JSON' })
  userId?: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: ['admin', 'cliente'] })
  role!: 'admin' | 'cliente';

  @ApiPropertyOptional({ description: 'Definido quando role=cliente' })
  clienteId?: string;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ default: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Tempo de expiracao em segundos' })
  expiresIn!: number;

  @ApiProperty({ type: LoginUserDto })
  user!: LoginUserDto;
}
