import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateAutomacaoNfeDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ enum: NfeAmbiente })
  @IsEnum(NfeAmbiente)
  ambiente!: NfeAmbiente;

  @ApiProperty({ default: false })
  @IsBoolean()
  cienciaAutomatica!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  recuperacaoXmlAutomatica!: boolean;

  @ApiPropertyOptional({ description: 'Confirma expressamente a autorização para o estabelecimento e ambiente informados.' })
  @IsOptional()
  @IsBoolean()
  confirmacaoExpressa?: boolean;

  @ApiPropertyOptional({ description: 'Versão do termo exibido ao usuário.' })
  @IsOptional()
  @IsString()
  versaoTermo?: string;
}

export class RevogarAutomacaoNfeDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ enum: NfeAmbiente })
  @IsEnum(NfeAmbiente)
  ambiente!: NfeAmbiente;
}

export class NfeAutomacaoQueryDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  estabelecimentoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
