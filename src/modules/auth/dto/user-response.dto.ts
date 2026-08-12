import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional()
  nome?: string;

  @ApiProperty({ enum: ['admin', 'comum', 'cliente'] })
  role!: 'admin' | 'comum' | 'cliente';

  @ApiPropertyOptional()
  clienteId?: string;

  @ApiProperty()
  ativo!: boolean;

  @ApiPropertyOptional()
  ultimoLoginAt?: string | null;

  @ApiPropertyOptional()
  passwordChangedAt?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
