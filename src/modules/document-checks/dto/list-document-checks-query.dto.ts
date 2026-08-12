import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

const documentCheckTypes = ['nfse', 'nfe', 'cte'] as const;

export class ListDocumentChecksQueryDto {
  @ApiProperty({ enum: documentCheckTypes })
  @IsIn(documentCheckTypes)
  tipo!: (typeof documentCheckTypes)[number];

  @ApiPropertyOptional({ type: [String], description: 'Lista de IDs dos documentos a consultar' })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  documentoIds?: string[];
}
