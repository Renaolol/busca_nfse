import { ApiProperty } from '@nestjs/swagger';

export class CertificatePasswordDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Senha do certificado descriptografada para consulta operacional.' })
  senha!: string;
}
