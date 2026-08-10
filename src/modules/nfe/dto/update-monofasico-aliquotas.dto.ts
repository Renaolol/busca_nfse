import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';

export class MonofasicoAliquotaPeriodoDto {
  @ApiProperty({ description: 'Fator multiplicador da aliquota vigente no periodo (ex: 1.17)' })
  @IsNumber()
  @Min(0)
  aliquota!: number;

  @ApiProperty({ description: 'Data de inicio de vigencia do periodo (YYYY-MM-DD)' })
  @IsDateString()
  dataInicio!: string;

  @ApiPropertyOptional({
    description: 'Data final de vigencia do periodo (YYYY-MM-DD). Deixe em branco para o periodo vigente.',
    nullable: true
  })
  @IsOptional()
  @IsDateString()
  dataFim?: string | null;
}

export class UpdateMonofasicoAliquotasDto {
  @ApiProperty({ type: [MonofasicoAliquotaPeriodoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MonofasicoAliquotaPeriodoDto)
  periodos!: MonofasicoAliquotaPeriodoDto[];
}
