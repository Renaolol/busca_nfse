import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompareSpedHistoricoDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  clientId?: string | null;

  @ApiProperty()
  clientName!: string;

  @ApiPropertyOptional()
  clientCnpj?: string | null;

  @ApiPropertyOptional()
  competence?: string | null;

  @ApiProperty()
  sourceFileName!: string;

  @ApiProperty({ enum: ['Excel', 'PDF'] })
  outputFormat!: 'Excel' | 'PDF';

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ type: Object })
  report!: Record<string, unknown>;
}
