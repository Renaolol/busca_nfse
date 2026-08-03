import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SaveCompareSpedHistoricoDto {
  @ApiPropertyOptional({ description: 'Cliente relacionado ao historico' })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiProperty({ description: 'Nome da empresa selecionada na comparacao' })
  @IsString()
  @MaxLength(255)
  clientName!: string;

  @ApiPropertyOptional({ description: 'CNPJ da empresa selecionada' })
  @IsOptional()
  @IsString()
  @MaxLength(14)
  clientCnpj?: string;

  @ApiPropertyOptional({ description: 'Competencia da comparacao' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  competence?: string;

  @ApiProperty({ description: 'Nome do arquivo SPED usado na comparacao' })
  @IsString()
  @MaxLength(255)
  sourceFileName!: string;

  @ApiProperty({ enum: ['Excel', 'PDF'] })
  @IsIn(['Excel', 'PDF'])
  outputFormat!: 'Excel' | 'PDF';

  @ApiPropertyOptional({ description: 'Momento em que a comparacao foi gerada em ISO 8601' })
  @IsOptional()
  @IsString()
  generatedAt?: string;

  @ApiProperty({ type: Object, description: 'Relatorio completo da comparacao' })
  @IsObject()
  report!: Record<string, unknown>;
}
