import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export class DownloadLoteDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    enum: ['ambos', 'xml', 'danfe'],
    default: 'ambos',
    description: 'Tipo de arquivo para incluir no ZIP'
  })
  @IsOptional()
  @IsIn(['ambos', 'xml', 'danfe'])
  tipoArquivo?: 'ambos' | 'xml' | 'danfe';

  @ApiPropertyOptional({
    description: 'Escopo opcional por cliente (injetado automaticamente pelo guard quando houver token de cliente)'
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
