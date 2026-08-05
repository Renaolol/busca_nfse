import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RecuperarNfsePorChaveDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({
    description: 'Estabelecimento a ser usado no certificado. Quando omitido, sera resolvido por cliente + cnpjConsulta.'
  })
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional({ description: 'CNPJ base da busca emitida, usado para localizar o estabelecimento automaticamente.' })
  @IsOptional()
  @IsString()
  @Length(14, 14)
  cnpjConsulta?: string;

  @ApiPropertyOptional({ enum: ['producao', 'producao_restrita'], default: 'producao' })
  @IsOptional()
  @IsIn(['producao', 'producao_restrita'])
  ambiente?: 'producao' | 'producao_restrita';

  @ApiProperty({
    type: [String],
    description: 'Lista de chaves de acesso da NFS-e a recuperar via API oficial do Emissor Publico.'
  })
  @IsArray()
  @IsString({ each: true })
  chavesAcesso!: string[];
}
