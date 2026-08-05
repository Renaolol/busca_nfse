import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateNfseDocumentNumberingValidationDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty({
    description: 'Quando true, o documento deixa de participar da validacao de numeracao e da auditoria de lacunas.'
  })
  @IsBoolean()
  ignorar!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacao?: string;
}
