import { Ambiente } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NfseNumeracaoLacunaDto {
  @ApiProperty({ enum: Ambiente })
  ambiente!: Ambiente;

  @ApiPropertyOptional({ nullable: true })
  serie!: string | null;

  @ApiProperty()
  numeroInicial!: number;

  @ApiProperty()
  numeroFinal!: number;

  @ApiProperty()
  quantidade!: number;
}

export class NfseNumeracaoValidationDto {
  @ApiProperty()
  aplicada!: boolean;

  @ApiPropertyOptional({ enum: ['requer_consulta_emitidas', 'filtros_incompativeis'] })
  motivo?: 'requer_consulta_emitidas' | 'filtros_incompativeis';

  @ApiPropertyOptional({ nullable: true })
  cnpjPrestador!: string | null;

  @ApiProperty()
  totalDocumentosAnalisados!: number;

  @ApiProperty()
  totalNumerosValidos!: number;

  @ApiProperty()
  totalFaixasLacuna!: number;

  @ApiProperty()
  totalNumerosPulados!: number;

  @ApiProperty()
  possuiNumeracaoPulada!: boolean;

  @ApiProperty({ type: [NfseNumeracaoLacunaDto] })
  lacunas!: NfseNumeracaoLacunaDto[];
}
