import { ApiProperty } from '@nestjs/swagger';

export class NfceScDiagnosticDownloadDto {
  @ApiProperty({ example: 'nfce-sc-diagnostico-12345678000199-2026-10-05T12-30-00-000Z.zip' })
  fileName!: string;

  @ApiProperty({ example: 'application/zip' })
  contentType!: string;

  @ApiProperty({ description: 'ZIP em Base64 contendo requisicao.xml, resposta.xml e capturado-em.txt' })
  contentBase64!: string;
}
