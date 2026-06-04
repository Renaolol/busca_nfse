import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ImportXmlDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({
    description:
      'XML da NFS-e ou XML de evento da NFS-e em texto. Eventos sao vinculados pela chave da NFS-e referenciada.'
  })
  @IsString()
  xml!: string;

  @ApiPropertyOptional({ default: 'producao' })
  @IsOptional()
  @IsString()
  ambiente?: 'producao' | 'producao_restrita';
}
