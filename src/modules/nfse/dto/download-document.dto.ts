import { ApiProperty } from '@nestjs/swagger';

export class DownloadDocumentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty({
    description: 'Conteudo do arquivo em Base64'
  })
  contentBase64!: string;

  @ApiProperty({
    required: false,
    nullable: true
  })
  xml?: string;

  @ApiProperty({
    required: false,
    nullable: true
  })
  danfsePath?: string;
}
