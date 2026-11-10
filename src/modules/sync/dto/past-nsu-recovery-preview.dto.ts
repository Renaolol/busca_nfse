import { ApiProperty } from '@nestjs/swagger';
import { Ambiente } from '@prisma/client';

export class PastNsuRecoveryPreviewRangeDto {
  @ApiProperty({ description: 'Primeiro NSU da faixa candidata.' })
  nsuInicial!: string;

  @ApiProperty({ description: 'Ultimo NSU da faixa candidata.' })
  nsuFinal!: string;

  @ApiProperty({ description: 'Quantidade maxima de NSUs que podem ser avaliados nesta faixa.' })
  quantidade!: number;

  @ApiProperty({ type: [String], description: 'Lacunas de numeracao associadas a faixa.' })
  lacunas!: string[];
}

export class PastNsuRecoveryPreviewControlDto {
  @ApiProperty()
  controleId!: string;

  @ApiProperty()
  cnpjConsulta!: string;

  @ApiProperty({ enum: Ambiente })
  ambiente!: Ambiente;

  @ApiProperty({ description: 'Quantidade maxima de NSUs candidatos para este controle.' })
  nsusPlanejados!: number;

  @ApiProperty({ type: [PastNsuRecoveryPreviewRangeDto] })
  faixas!: PastNsuRecoveryPreviewRangeDto[];
}

export class PastNsuRecoveryPreviewDto {
  @ApiProperty({ enum: ['gap-audit'] })
  modo!: 'gap-audit';

  @ApiProperty({ description: 'Quantidade de lacunas de numeracao recebidas.' })
  lacunasInformadas!: number;

  @ApiProperty()
  controlesEncontrados!: number;

  @ApiProperty({ description: 'Quantidade maxima de NSUs candidatos antes da busca prioritaria encerrar faixas.' })
  nsusPlanejados!: number;

  @ApiProperty({ type: [PastNsuRecoveryPreviewControlDto] })
  controles!: PastNsuRecoveryPreviewControlDto[];
}
