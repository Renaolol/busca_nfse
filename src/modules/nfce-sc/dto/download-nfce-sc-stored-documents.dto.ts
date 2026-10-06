import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DownloadNfceScStoredDocumentsDto {
  @ApiProperty({ type: [String], description: 'IDs das NFC-e armazenadas para incluir no ZIP.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clienteId!: string;
}
