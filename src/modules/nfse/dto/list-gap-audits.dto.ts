import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { NfseNumeracaoLacunaDto } from './list-nfse-response.dto';

export class ListNfseGapAuditsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class NfseGapAuditOverviewRowDto {
  @ApiProperty()
  clienteId!: string;

  @ApiProperty()
  razaoSocial!: string;

  @ApiProperty()
  cnpjConsulta!: string;

  @ApiProperty()
  totalDocumentosAnalisados!: number;

  @ApiProperty()
  totalNumerosValidos!: number;

  @ApiProperty()
  totalFaixasLacuna!: number;

  @ApiProperty()
  totalNumerosPulados!: number;

  @ApiProperty({ type: [NfseNumeracaoLacunaDto] })
  lacunas!: NfseNumeracaoLacunaDto[];
}
