import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'

export class EmbedUserDto {
  @IsString()
  id!: string

  @IsString()
  bio!: string

  @IsInt()
  @Min(0)
  age!: number
}

export class EmbedAndSaveDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmbedUserDto)
  users!: EmbedUserDto[]
}
