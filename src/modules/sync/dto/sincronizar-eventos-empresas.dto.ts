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
