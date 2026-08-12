import { ApiProperty } from '@nestjs/swagger';
import { AuthenticatedUserDto } from './authenticated-user.dto';

export class MeResponseDto {
  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;
}
