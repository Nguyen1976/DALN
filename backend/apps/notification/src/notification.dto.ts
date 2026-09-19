import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator'

class ChannelTogglesDto {
  @IsOptional()
  @IsBoolean()
  IN_APP?: boolean

  @IsOptional()
  @IsBoolean()
  EMAIL?: boolean

  @IsOptional()
  @IsBoolean()
  REALTIME?: boolean
}

class GlobalPreferenceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  channels?: ChannelTogglesDto
}

class DigestPreferenceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsInt()
  @Min(1)
  minUnread?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  cooldownMinutes?: number
}

/** A partial change: whatever is left out keeps its current value. */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GlobalPreferenceDto)
  global?: GlobalPreferenceDto

  /** Per notification type; unknown types are ignored by the service. */
  @IsOptional()
  @IsObject()
  overrides?: Record<string, ChannelTogglesDto>

  @IsOptional()
  @ValidateNested()
  @Type(() => DigestPreferenceDto)
  digest?: DigestPreferenceDto
}
