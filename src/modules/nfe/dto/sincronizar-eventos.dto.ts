import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SincronizarNfeEventosDto {
  @ApiProperty({ description: 'Cliente dono dos documentos que terao eventos consultados' })
  clienteId!: string;

  @ApiPropertyOptional({ type: [String], description: 'IDs especificos de documentos para consultar eventos' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  documentoIds?: string[];

  @ApiPropertyOptional({
    description: 'Quando true, prioriza documentos sem eventos salvos localmente',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  somenteSemEventos?: boolean;

  @ApiPropertyOptional({
    description: 'Quantidade maxima de documentos consultados na execucao',
    default: 50,
    minimum: 1,
    maximum: 200
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SincronizarNfeEventosDetalheDto {
  @ApiProperty()
  documentoId!: string;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiPropertyOptional()
  numeroDocumento?: string | null;

  @ApiProperty({ enum: ['sincronizado', 'sem_eventos', 'falha_api', 'falha_certificado'] })
  status!: 'sincronizado' | 'sem_eventos' | 'falha_api' | 'falha_certificado';

  @ApiProperty()
  eventosEncontrados!: number;

  @ApiProperty()
  eventosImportados!: number;

  @ApiPropertyOptional()
  mensagem?: string;
}

export class SincronizarNfeEventosResponseDto {
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

  @ApiProperty({ type: [SincronizarNfeEventosDetalheDto] })
  detalhes!: SincronizarNfeEventosDetalheDto[];
}
