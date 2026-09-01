import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class SincronizarEventosEmpresasDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Empresas que devem participar da busca. Quando omitido, processa todas as empresas.'
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  clienteIds?: string[];
}

export class SincronizarEventosEmpresasDetalheDto {
  @ApiProperty()
  clienteId!: string;

  @ApiProperty({ enum: ['nfe', 'cte'] })
  tipoDocumento!: 'nfe' | 'cte';

  @ApiProperty()
  documentosProcessados!: number;

  @ApiProperty()
  documentosComEventos!: number;

  @ApiProperty()
  eventosImportados!: number;

  @ApiProperty()
  falhas!: number;

  @ApiPropertyOptional()
  mensagem?: string;
}

export class SincronizarEventosEmpresasResponseDto {
  @ApiProperty({ description: 'Limite fixo de idade aplicado aos documentos.' })
  limiteDias!: number;

  @ApiProperty()
  empresasProcessadas!: number;

  @ApiProperty()
  documentosSelecionados!: number;

  @ApiProperty()
  documentosProcessados!: number;

  @ApiProperty()
  documentosComEventos!: number;

  @ApiProperty()
  eventosEncontrados!: number;

  @ApiProperty()
  eventosImportados!: number;

  @ApiProperty()
  falhas!: number;

  @ApiProperty({ type: [SincronizarEventosEmpresasDetalheDto] })
  detalhes!: SincronizarEventosEmpresasDetalheDto[];
}

export class SincronizarEventosEmpresasExecutionDto {
  @ApiProperty()
  executionId!: string;

  @ApiProperty({ enum: ['running', 'completed', 'failed'] })
  status!: 'running' | 'completed' | 'failed';

  @ApiProperty({ description: 'Total de documentos elegiveis para consulta.' })
  documentosTotal!: number;

  @ApiProperty({ description: 'Documentos cuja consulta de eventos ja foi concluida.' })
  documentosConsultados!: number;

  @ApiPropertyOptional()
  currentMessage!: string | null;

  @ApiProperty()
  startedAt!: string;

  @ApiPropertyOptional()
  finishedAt!: string | null;

  @ApiPropertyOptional({ type: SincronizarEventosEmpresasResponseDto })
  result!: SincronizarEventosEmpresasResponseDto | null;
}
