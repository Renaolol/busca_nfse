import { ApiProperty } from '@nestjs/swagger';

class DownloadLoteErroItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  erro!: string;
}

export class DownloadLoteResponseDto {
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

  @ApiProperty({ type: [DownloadLoteErroItemDto] })
  erros!: DownloadLoteErroItemDto[];
}
