import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class GetDominioNfeXmlDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  catalogoId!: number;

  @ApiPropertyOptional({ description: 'Opcional para restringir a busca a um estabelecimento do cliente' })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;
}

export class DownloadDominioNfeXmlDto {
  @ApiProperty()
  catalogoId!: number;

  @ApiPropertyOptional()
  chaveAcesso?: string;

  @ApiPropertyOptional()
  numeroNfe?: string;

  @ApiPropertyOptional()
  serie?: string;

  @ApiPropertyOptional()
  modelo?: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  contentBase64!: string;

  @ApiProperty()
  xml!: string;
}
