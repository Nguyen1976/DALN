import { Status } from 'apps/user/src/generated'
import {
  ArrayMaxSize,
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
import { Transform, Type, type TransformFnParams } from 'class-transformer'

/**
 * Email so khớp KHÔNG phân biệt hoa thường và không dính khoảng trắng thừa:
 * `NgMinh4205@gmail.com ` và `ngminh4205@gmail.com` là cùng một hộp thư, nên
 * phải là cùng một tài khoản. Chuẩn hoá ngay ở đầu vào (ValidationPipe đang bật
 * `transform`) để mọi tầng phía sau — tra cứu, lưu, khoá OTP — thấy một dạng duy nhất.
 */
const toNormalizedEmail = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

const toTrimmed = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value

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
  @Transform(toNormalizedEmail)
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
  @Transform(toNormalizedEmail)
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string

  @IsNotEmpty({ message: 'Password must not be empty' })
  password: string
}

export class VerifyOtpDto {
  @Transform(toNormalizedEmail)
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
  @Transform(toNormalizedEmail)
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string
}

/** Gửi lời mời theo email — ô "Thêm bạn" gõ email. */
export class MakeFriendDto {
  @Transform(toNormalizedEmail)
  @IsNotEmpty()
  @IsEmail()
  email: string
}

/**
 * Gửi lời mời theo username — thẻ gợi ý kết bạn. Dữ liệu gợi ý cố ý không mang
 * email của người lạ, nên trước đây nút "Kết bạn" ở đó luôn báo không lấy được email.
 */
export class MakeFriendByUsernameDto {
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  username: string
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
  // An empty array is how the client says "skip this step" — the onboarding is
  // there to sharpen suggestions, not to lock a new account out of the app.
  @IsArray()
  @ArrayMaxSize(24)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  slugs!: string[]
}
