import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NfeManifestacaoTipo } from '../../../integrations/nfe-distribuicao/nfe-manifestacao.types';

export class RegistrarNfeManifestacaoDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador do cliente no escopo da sessão.' })
  @IsUUID()
  clienteId!: string;

  @ApiProperty({ format: 'uuid', description: 'Chave idempotente desta autorização explícita do usuário.' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ enum: ['ciencia_operacao', 'confirmacao_operacao', 'desconhecimento_operacao', 'operacao_nao_realizada'] })
  @IsIn(['ciencia_operacao', 'confirmacao_operacao', 'desconhecimento_operacao', 'operacao_nao_realizada'])
  tipo!: NfeManifestacaoTipo;

  @ApiPropertyOptional({ minLength: 15, maxLength: 255, description: 'Obrigatória somente para Operação não Realizada.' })
  @IsOptional()
  @IsString()
  @MinLength(15)
  @MaxLength(255)
  justificativa?: string;

  @ApiProperty({ enum: [true], description: 'Confirmação expressa de que o usuário revisou o efeito jurídico do evento.' })
  @IsBoolean()
  confirmacaoExpressa!: boolean;

  @ApiPropertyOptional({ default: false, description: 'Confirma que o usuário pretende retificar uma manifestação conclusiva anterior, se houver.' })
  @IsOptional()
  @IsBoolean()
  retificarConclusiva?: boolean;
}
