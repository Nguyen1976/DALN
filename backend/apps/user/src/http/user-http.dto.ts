import {
  ArrayMaxSize,
  IsBoolean,
  ValidateIf,
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
  IsNumberString,
} from 'class-validator'
import { MaxBytes } from '@app/common/http/max-bytes.validator'
import { ExactlyOneOf } from '@app/common/http/exactly-one-of.validator'
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
  // Trần 20 ký tự cũ chặn cả passphrase, mà passphrase là cách người dùng
  // thường tạo được mật khẩu mạnh nhất. OWASP yêu cầu cho phép ít nhất 64.
  @MaxLength(64, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @MaxBytes(72, {
    message: 'Mật khẩu quá dài (tối đa 72 byte)',
  })
  @MinLength(8, {
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

  // KHÔNG có trần ở đây nghĩa là một chuỗi 100KB đi thẳng vào bcrypt.compare:
  // mỗi request như vậy chiếm CPU rất lâu, và đó là một cách làm sập server rẻ
  // tiền. Trần rộng hơn chính sách đăng ký để người có mật khẩu cũ vẫn vào được.
  @MaxLength(200, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @IsNotEmpty({ message: 'Password must not be empty' })
  password: string
}

export class VerifyOtpDto {
  @Transform(toNormalizedEmail)
  @IsEmail()
  @IsNotEmpty({ message: 'Email must not be empty' })
  email: string

  @IsNotEmpty({ message: 'OTP must not be empty' })
  // `@IsString()` một mình cho qua cả "abcdef": mã chỉ gồm chữ số nên nói
  // đúng điều đó, và loại bớt rác trước khi nó tốn một lượt thử.
  @IsNumberString({}, { message: 'OTP must be 6 digits' })
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
  // Trần 20 ký tự cũ chặn cả passphrase, mà passphrase là cách người dùng
  // thường tạo được mật khẩu mạnh nhất. OWASP yêu cầu cho phép ít nhất 64.
  @MaxLength(64, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @MaxBytes(72, {
    message: 'Mật khẩu quá dài (tối đa 72 byte)',
  })
  @MinLength(8, {
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

/**
 * Đổi mật khẩu từ trang Cài đặt.
 *
 * Hai cách tự chứng minh, chọn MỘT: biết mật khẩu hiện tại, hoặc đọc được hộp
 * thư. Người quên mật khẩu cũ vẫn đổi được mà không phải đăng xuất đi làm
 * "quên mật khẩu"; người không mở được mail vẫn đổi được bằng mật khẩu cũ.
 */
export class ChangePasswordDto {
  @IsNotEmpty()
  // Cùng trần với ResetPasswordDto: 64 ký tự cho passphrase, và 72 byte vì
  // bcrypt lặng lẽ bỏ phần vượt quá.
  @MaxLength(64, {
    message: 'Password is too long. Maximum length is $constraint1 characters',
  })
  @MaxBytes(72, { message: 'Mật khẩu quá dài (tối đa 72 byte)' })
  @MinLength(8, {
    message: 'Password is too short. Minimum length is $constraint1 characters',
  })
  newPassword: string

  /** Cách 1. `ExactlyOneOf` nằm ở đây và chỉ ở đây để lỗi báo về một chỗ. */
  @ExactlyOneOf(['otp'], {
    message: 'Cần đúng một trong: mật khẩu hiện tại hoặc mã OTP',
  })
  // Đọc là: "bỏ qua ô này khi người dùng đã chọn đường OTP". Không thể dùng
  // `@IsOptional()` hay điều kiện chỉ-khi-có-mặt: `@ValidateIf` tắt MỌI ràng
  // buộc của thuộc tính, kể cả `ExactlyOneOf` — và thế thì body không gửi cách
  // xác thực nào sẽ lọt qua, còn body gửi cả hai cũng lọt.
  @ValidateIf(
    (o: ChangePasswordDto) =>
      o.currentPassword !== undefined || o.otp === undefined,
  )
  @IsString()
  @MaxBytes(72, { message: 'Mật khẩu quá dài (tối đa 72 byte)' })
  currentPassword?: string

  /** Cách 2 — cùng khuôn với VerifyOtpDto, mã 6 chữ số. */
  @ValidateIf((o: ChangePasswordDto) => o.otp !== undefined)
  @IsNumberString({}, { message: 'OTP must be 6 digits' })
  @MinLength(6, { message: 'OTP must be 6 characters' })
  @MaxLength(6, { message: 'OTP must be 6 characters' })
  otp?: string

  /**
   * Bỏ trống = false. Một cờ thiếu không bao giờ được hiểu thành hành động
   * phá huỷ: người dùng phải chủ động tích thì các thiết bị khác mới bị đá.
   */
  @IsBoolean()
  revokeOtherSessions: boolean = false
}

export class RevokeSessionDto {
  @IsNotEmpty({ message: 'sid must not be empty' })
  @IsString()
  @MaxLength(64)
  sid: string
}
