import { Status } from 'apps/user/src/generated'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export class RegisterLocationDto {
  @Type(() => Number)
  @IsNotEmpty()
  @IsNumber()
  lat: number

  @Type(() => Number)
  @IsNotEmpty()
  @IsNumber()
  lon: number
}

export class RegisterUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string

  @IsNotEmpty()
  @MaxLength(20, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @MinLength(6, {
    message: 'Password is too short. Minimum length is $constraint1 characters',
  })
  password: string

  @IsNotEmpty()
  @MaxLength(30, {
    message: 'Username is too long. Maximum length is $constraint1 characters',
  })
  @MinLength(3, {
    message: 'Username is too short. Minimum length is $constraint1 characters',
  })
  username: string

  @IsOptional()
  @ValidateNested()
  @Type(() => RegisterLocationDto)
  location?: RegisterLocationDto
}

export class LoginUserDto {
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string

  @IsNotEmpty({ message: 'Password must not be empty' })
  password: string
}

export class VerifyOtpDto {
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email  : string

  @IsNotEmpty({ message: 'OTP must not be empty' })
  @IsString()
  @MinLength(6, { message: 'OTP must be 6 characters' })
  @MaxLength(6, { message: 'OTP must be 6 characters' })
  otp: string
}

export class ResendOtpDto {
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string
}

export class MakeFriendDto {
  @IsNotEmpty()
  @IsEmail()
  email: string
}

export class UpdateStatusMakeFriendDto {
  @IsNotEmpty()
  @IsEnum(Status, {
    message: `Status must be one of the following values: ${Object.values(Status).join(', ')}`,
  })
  status: Status

  @IsNotEmpty()
  inviterId: string

  @IsNotEmpty()
  inviteeName: string
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string
}

export class CompleteInterestOnboardingDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Vui lòng chọn ít nhất một sở thích' })
  @ArrayMaxSize(24)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  slugs!: string[]
}
