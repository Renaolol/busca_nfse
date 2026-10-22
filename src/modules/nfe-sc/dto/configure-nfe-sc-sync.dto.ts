import { ApiProperty } from '@nestjs/swagger';
import { NfeAmbiente } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsUUID } from 'class-validator';

export class ConfigureNfeScSyncDto {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;

  @ApiProperty()
  @IsUUID()
  estabelecimentoId!: string;

  @ApiProperty({ description: 'Certificado A1 do contabilista, armazenado com criptografia.' })
  @IsUUID()
  certificadoId!: string;

  @ApiProperty({ enum: [NfeAmbiente.producao], default: NfeAmbiente.producao })
  @IsEnum(NfeAmbiente)
  ambiente = NfeAmbiente.producao;

  @ApiProperty({ enum: [1, 2, 3, 9], default: 3, description: '1=emitente, 2=destinatario, 3=emitente ou destinatario, 9=emitente e destinatario.' })
  @IsInt()
  @IsIn([1, 2, 3, 9])
  indAtor = 3;

  @ApiProperty({
    description: 'Confirma que o administrador verificou externamente que o titular do certificado é contabilista vinculado ao CPF/CNPJ consultado na SEF/SC.',
    enum: [true]
  })
  @IsBoolean()
  autorizacaoContabilistaConfirmada!: boolean;
}
