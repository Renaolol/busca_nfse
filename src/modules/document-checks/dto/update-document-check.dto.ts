import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

const documentCheckTypes = ['nfse', 'nfe', 'cte'] as const;

export class UpdateDocumentCheckDto {
  @ApiProperty({ enum: documentCheckTypes })
  @IsIn(documentCheckTypes)
  tipo!: (typeof documentCheckTypes)[number];

  @ApiProperty()
  @IsUUID()
  documentoId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiProperty()
  @IsBoolean()
  conferido!: boolean;
}
