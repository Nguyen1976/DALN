import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

/**
 * `?limit=&cursor=` on every paged list. Lists answer `{ items, nextCursor }`
 * and the client sends `nextCursor` back as it is; only the server knows
 * what it encodes.
 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20

  @IsOptional()
  @IsString()
  cursor?: string
}
