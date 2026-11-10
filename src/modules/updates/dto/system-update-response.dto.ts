import { ApiProperty } from '@nestjs/swagger';

export class SystemUpdateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  titulo!: string;

  @ApiProperty()
  descricao!: string;

  @ApiProperty()
  autorNome!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
