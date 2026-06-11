import { ApiProperty } from '@nestjs/swagger';

export class DownloadCertificateDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty({ description: 'Conteudo do certificado em Base64' })
  contentBase64!: string;
}
