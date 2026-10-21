import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class DownloadCteLoteDto {
  @ApiProperty({ type: [String], description: 'IDs dos CT-e que terao XML incluido no ZIP' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    description: 'Escopo opcional por cliente (injetado automaticamente pelo guard quando houver token de cliente)'
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
