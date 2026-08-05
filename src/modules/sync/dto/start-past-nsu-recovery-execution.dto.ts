import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Ambiente } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';
import { NfseGapAuditRangeDto } from './nfse-gap-audit.dto';

export class StartPastNsuRecoveryExecutionDto {
  @ApiProperty({
    description: 'Cliente alvo da execucao manual com progresso visual por NSU'
  })
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({
    description: 'Quando informado junto das lacunas, limita a auditoria ao CNPJ consultado'
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/)
  cnpjConsulta?: string;

  @ApiPropertyOptional({
    enum: Ambiente,
    description: 'Ambiente alvo da auditoria por lacunas'
  })
  @IsOptional()
  @IsEnum(Ambiente)
  ambiente?: Ambiente;

  @ApiPropertyOptional({
    type: [NfseGapAuditRangeDto],
    description: 'Faixas de numeracao pulada que devem orientar a busca por NSU'
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NfseGapAuditRangeDto)
  lacunas?: NfseGapAuditRangeDto[];
}
