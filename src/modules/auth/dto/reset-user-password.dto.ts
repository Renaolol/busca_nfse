import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetUserPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
