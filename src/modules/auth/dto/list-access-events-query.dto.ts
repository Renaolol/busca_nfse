import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const accessEventTypes = ['login_sucesso', 'login_falha', 'logout', 'token_renovado', 'sessao_expirada', 'acesso_negado'] as const;

export class ListAccessEventsQueryDto {
  @ApiPropertyOptional({ enum: accessEventTypes })
  @IsOptional()
  @IsString()
  @IsIn(accessEventTypes)
  tipo?: (typeof accessEventTypes)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ default: 200 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
