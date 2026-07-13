import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class SincronizarNfseEventosDto {
  @ApiProperty({ description: 'Cliente dono das NFS-e que terao eventos consultados' })
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({ description: 'Limita a sincronizacao a um estabelecimento especifico' })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'] })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiPropertyOptional({ description: 'Limita a sincronizacao a uma chave de acesso especifica' })
  @IsOptional()
  @IsString()
  chaveAcesso?: string;

  @ApiPropertyOptional({
    description: 'Lista explicita de IDs de NFS-e a processar. Quando informada, a sincronizacao percorre apenas esses documentos.'
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  documentoIds?: string[];

  @ApiPropertyOptional({
    description: 'Quando true, prioriza notas sem eventos salvos localmente',
    default: true
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  somenteSemEventos?: boolean;

  @ApiPropertyOptional({
    description: 'Quantidade maxima de notas consultadas por chamada',
    default: 100,
    minimum: 1,
    maximum: 1000
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class SincronizarNfseEventosDetalheDto {
  @ApiProperty()
  documentoId!: string;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiProperty()
  estabelecimentoId!: string;

  @ApiProperty({ enum: ['producao', 'producao_restrita'] })
  ambiente!: 'producao' | 'producao_restrita';

  @ApiProperty({ enum: ['sincronizado', 'sem_eventos', 'falha_api', 'falha_certificado'] })
  status!: 'sincronizado' | 'sem_eventos' | 'falha_api' | 'falha_certificado';

  @ApiProperty()
  eventosEncontrados!: number;

  @ApiProperty()
  eventosImportados!: number;

  @ApiPropertyOptional()
  mensagem?: string;
}

export class SincronizarNfseEventosResponseDto {
  @ApiProperty()
  documentosAnalisados!: number;

  @ApiProperty()
  documentosComEventos!: number;

  @ApiProperty()
  eventosEncontrados!: number;

  @ApiProperty()
  eventosImportados!: number;

  @ApiProperty()
  falhas!: number;

  @ApiProperty({ type: [SincronizarNfseEventosDetalheDto] })
  detalhes!: SincronizarNfseEventosDetalheDto[];
}
