import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';
import { Ambiente } from '@prisma/client';
import { NfseGapAuditRangeDto } from './nfse-gap-audit.dto';

export class ReprocessPastNsusDto {
  @ApiPropertyOptional({
    description: 'Quando informado, limita a recuperacao aos controles deste cliente'
  })
  @IsOptional()
  @IsUUID()
  clienteId?: string;

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
