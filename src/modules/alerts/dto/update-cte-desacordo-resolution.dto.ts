import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateCteDesacordoResolutionDto {
  @ApiProperty({ description: 'Marca ou desmarca o alerta como resolvido' })
  @IsBoolean()
  resolvido!: boolean;
}
