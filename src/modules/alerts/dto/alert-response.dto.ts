import { ApiProperty } from '@nestjs/swagger';

export class AlertResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  severity!: string;

  @ApiProperty()
  tipo!: string;

  @ApiProperty()
  titulo!: string;

  @ApiProperty()
  descricao!: string;

  @ApiProperty()
  clientId!: string;

  @ApiProperty()
  cliente!: string;

  @ApiProperty()
  dataHora!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  origem!: string;

  @ApiProperty()
  mensagemTecnica!: string;

  @ApiProperty()
  sugestaoAcao!: string;

  @ApiProperty({ type: [String] })
  historicoTentativas!: string[];

  @ApiProperty()
  allowsReprocess!: boolean;

  @ApiProperty()
  persistence!: string;

  @ApiProperty()
  canToggleResolved!: boolean;

  @ApiProperty()
  documentoId!: string;

  @ApiProperty()
  chaveAcesso!: string;

  @ApiProperty()
  numeroDocumento!: string;

  @ApiProperty()
  eventoTipo!: string;

  @ApiProperty()
  eventoDescricao!: string;

  @ApiProperty()
  resolvedAt!: string | null;

  @ApiProperty()
  emissor!: string;

  @ApiProperty({ type: [String] })
  retencoes!: string[];
}
