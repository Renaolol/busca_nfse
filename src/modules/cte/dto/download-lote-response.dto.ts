import { ApiProperty } from '@nestjs/swagger';

class DownloadCteLoteErroItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  erro!: string;
}

export class DownloadCteLoteResponseDto {
  @ApiProperty()
  fileName!: string;

  @ApiProperty({ default: 'application/zip' })
  contentType!: string;

  @ApiProperty({ description: 'Conteudo do arquivo ZIP em Base64' })
  contentBase64!: string;

  @ApiProperty()
  totalSolicitados!: number;

  @ApiProperty()
  totalDocumentosEncontrados!: number;

  @ApiProperty()
  totalArquivosIncluidos!: number;

  @ApiProperty({ type: [String] })
  idsNaoEncontrados!: string[];

  @ApiProperty({ type: [DownloadCteLoteErroItemDto] })
  erros!: DownloadCteLoteErroItemDto[];
}
