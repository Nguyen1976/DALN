import { Status } from '@prisma/client'
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

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
}

export class LoginUserDto {
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string

  @IsNotEmpty({ message: 'Password must not be empty' })
  password: string
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
