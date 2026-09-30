import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ConsultarSimplesNacionalLoteDto {
  @ApiProperty({ type: [String], description: 'CNPJs (14) ou raizes (8), com ou sem pontuacao. Maximo 5000.' })
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  cnpjs!: string[];

  @ApiPropertyOptional({ description: 'Preenchido automaticamente para usuarios de cliente' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
