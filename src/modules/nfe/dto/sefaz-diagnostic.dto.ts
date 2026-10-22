import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class StartSefazDiagnosticDto {
  @ApiProperty({ description: 'Controle de sincronizacao do estabelecimento selecionado.' })
  @IsUUID()
  controleId!: string;

  @ApiProperty({ description: 'Certificado ativo vinculado ao estabelecimento selecionado.' })
  @IsUUID()
  certificadoId!: string;

  @ApiPropertyOptional({ enum: NfeAmbiente })
  @IsOptional()
  @IsEnum(NfeAmbiente)
  ambiente?: NfeAmbiente;
}

export class ExecuteSefazDiagnosticDto {
  @ApiProperty({ enum: ['distNSU', 'consChNFe'] })
  @IsIn(['distNSU', 'consChNFe'])
  method!: 'distNSU' | 'consChNFe';

  @ApiPropertyOptional({ description: 'Obrigatoria para consChNFe.', minLength: 44, maxLength: 44, pattern: '^\\d{44}$' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{44}$/)
  chaveAcesso?: string;

  @ApiPropertyOptional({ default: false, description: 'Persiste os documentos retornados. distNSU persiste por padrao para manter o cursor seguro.' })
  @IsOptional()
  @IsBoolean()
  persistir?: boolean;
}
