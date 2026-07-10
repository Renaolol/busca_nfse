import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_UNPAGINATED_RESULTS = 10000;

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({
    description: `Quando true, ignora page/pageSize e retorna todos os registros que casam com o filtro (ate o limite de seguranca de ${MAX_UNPAGINATED_RESULTS} itens).`
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  all?: boolean;
}
