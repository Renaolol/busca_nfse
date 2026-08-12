import { ApiProperty } from '@nestjs/swagger';
import { AuthenticatedUserDto } from './authenticated-user.dto';

export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ default: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ description: 'Tempo de expiracao do access token em segundos' })
  expiresIn!: number;

  @ApiProperty({ description: 'Tempo de expiracao do refresh token em segundos' })
  refreshExpiresIn!: number;

  @ApiProperty({ description: 'Data/hora ISO de expiracao da sessao' })
  sessionExpiresAt!: string;

  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;
}
