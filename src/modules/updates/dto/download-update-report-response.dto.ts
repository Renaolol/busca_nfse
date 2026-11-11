import { ApiProperty } from '@nestjs/swagger';

export class DownloadUpdateReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'relatorio-atualizacoes-2026-11-10.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  contentType!: string;

  @ApiProperty({ description: 'Conteudo do PDF em Base64' })
  contentBase64!: string;
}
