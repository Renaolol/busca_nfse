import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export class DownloadLoteDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    enum: ['ambos', 'xml', 'danfse'],
    default: 'ambos',
    description: 'Tipo de arquivo para incluir no ZIP'
  })
  @IsOptional()
  @IsIn(['ambos', 'xml', 'danfse'])
  tipoArquivo?: 'ambos' | 'xml' | 'danfse';

  @ApiPropertyOptional({
    description: 'Escopo opcional por cliente (obrigatorio para token de cliente; injetado automaticamente pelo guard)'
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
