import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSystemUpdateDto {
  @ApiProperty({ maxLength: 160, example: 'Novo relatório de atualizações' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  titulo!: string;

  @ApiProperty({ maxLength: 10000, example: 'Incluímos um relatório diário com as atualizações registradas no sistema.' })
  @IsString()
  @MinLength(3)
  @MaxLength(10000)
  descricao!: string;
}
