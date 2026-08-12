import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentCheckResponseDto {
  @ApiProperty({ enum: ['nfse', 'nfe', 'cte'] })
  tipo!: 'nfse' | 'nfe' | 'cte';

  @ApiProperty()
  documentoId!: string;

  @ApiProperty()
  conferido!: boolean;

  @ApiPropertyOptional()
  clienteId?: string | null;

  @ApiPropertyOptional()
  conferidoEm?: string | null;
}
