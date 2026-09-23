import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { Transform, Type, type TransformFnParams } from 'class-transformer'
import { PageQueryDto } from '@app/common/http/page-query.dto'

/**
 * Email so khớp KHÔNG phân biệt hoa thường và không dính khoảng trắng thừa:
 * `NgMinh4205@gmail.com ` và `ngminh4205@gmail.com` là cùng một hộp thư, nên
 * phải là cùng một tài khoản. Chuẩn hoá ngay ở đầu vào (ValidationPipe đang bật
 * `transform`) để mọi tầng phía sau — tra cứu, lưu, khoá OTP — thấy một dạng duy nhất.
 */
const toNormalizedEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

const toTrimmed = ({ value }: TransformFnParams): unknown =>
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
  email: string

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

export class ForgotPasswordDto {
  @Transform(toNormalizedEmail)
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string
}

export class ValidateResetTokenQueryDto {
  @IsNotEmpty()
  @IsString()
  token: string
}

/**
 * Ràng buộc mật khẩu phải khớp ĐÚNG `RegisterUserDto`: hai đường vào cùng một
 * trường thì không được có hai luật khác nhau.
 */
export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  token: string

  @IsNotEmpty()
  @MaxLength(20, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @MinLength(6, {
    message: 'Password is too short. Minimum length is $constraint1 characters',
  })
  password: string
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

export class FriendRequestsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['received', 'sent'])
  direction: 'received' | 'sent' = 'received'
}

export class ProfileQueryDto {
  @IsMongoId()
  userId!: string
}

export class RespondFriendRequestDto {
  @IsIn(['ACCEPTED', 'REJECTED'])
  status!: 'ACCEPTED' | 'REJECTED'
}

export class FriendRequestParamsDto {
  @IsMongoId()
  id!: string
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

/** Internal: profiles of up to 200 users, by id. */
export class MemberProfilesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  ids!: string[]
}
