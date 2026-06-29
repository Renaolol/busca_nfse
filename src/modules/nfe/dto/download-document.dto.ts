import { ApiProperty } from '@nestjs/swagger';

export class DownloadNfeDocumentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  contentBase64!: string;

  @ApiProperty()
  xml!: string;
}
