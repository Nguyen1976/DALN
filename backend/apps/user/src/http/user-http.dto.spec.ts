import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  ForgotPasswordDto,
  LoginUserDto,
  MakeFriendByUsernameDto,
  MakeFriendDto,
  RegisterUserDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './user-http.dto'

const invalidFields = async (dto: object) =>
  (await validate(dto)).map((e) => e.property)

describe('email ở đầu vào: bỏ khoảng trắng, không phân biệt hoa thường', () => {
  const raw = '  NgMinh4205@Gmail.COM '

  it.each([
    [
      'RegisterUserDto',
      RegisterUserDto,
      { email: raw, password: 'secret12', username: 'minh' },
    ],
    ['LoginUserDto', LoginUserDto, { email: raw, password: 'x' }],
    ['VerifyOtpDto', VerifyOtpDto, { email: raw, otp: '123456' }],
    ['ResendOtpDto', ResendOtpDto, { email: raw }],
    ['MakeFriendDto', MakeFriendDto, { email: raw }],
  ])('%s', async (_name, Dto, body) => {
    const dto = plainToInstance(Dto as new () => { email: string }, body)
    expect(dto.email).toBe('ngminh4205@gmail.com')
    expect(await invalidFields(dto)).toEqual([])
  })

  it('email sai định dạng vẫn bị chặn', async () => {
    const dto = plainToInstance(MakeFriendDto, { email: 'khong-phai-email' })
    expect(await invalidFields(dto)).toEqual(['email'])
  })
})

describe('MakeFriendByUsernameDto', () => {
  it('bỏ khoảng trắng hai đầu username', async () => {
    const dto = plainToInstance(MakeFriendByUsernameDto, {
      username: '  dmhanguyen ',
    })
    expect(dto.username).toBe('dmhanguyen')
    expect(await invalidFields(dto)).toEqual([])
  })

  it('thiếu username -> báo lỗi', async () => {
    const dto = plainToInstance(MakeFriendByUsernameDto, {})
    expect(await invalidFields(dto)).toEqual(['username'])
  })

  it('username chỉ toàn khoảng trắng -> báo lỗi', async () => {
    const dto = plainToInstance(MakeFriendByUsernameDto, { username: '   ' })
    expect(await invalidFields(dto)).toEqual(['username'])
  })
})

describe('ForgotPasswordDto', () => {
  it('chuẩn hoá email về chữ thường và cắt khoảng trắng', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: '  NgMinh4205@Gmail.com ',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
    expect(dto.email).toBe('ngminh4205@gmail.com')
  })

  it('email sai định dạng thì không qua', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: 'khong-phai' })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})

describe('ResetPasswordDto', () => {
  it('mật khẩu 8 ký tự là ngắn nhất được chấp nhận', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: '12345678',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('7 ký tự thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: '1234567',
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  // Trần 20 ký tự cũ chặn cả passphrase — cách dễ nhất để có mật khẩu mạnh.
  it('passphrase 64 ký tự được chấp nhận', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: 'a'.repeat(64),
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('65 ký tự thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: 'a'.repeat(65),
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  // bcrypt chỉ dùng 72 byte đầu rồi lặng lẽ bỏ phần sau, nên trần theo BYTE
  // mới là trần thật. 40 ký tự tiếng Việt có dấu đã vượt 72 byte.
  it('mật khẩu tiếng Việt vượt 72 byte bị từ chối, không bị cắt âm thầm', async () => {
    const password = 'ậ'.repeat(40)
    expect(password.length).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(password, 'utf8')).toBeGreaterThan(72)

    const dto = plainToInstance(ResetPasswordDto, { token: 'tok', password })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('thiếu token thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, { password: '12345678' })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})

describe('LoginUserDto — trần độ dài mật khẩu', () => {
  // Không có trần thì một chuỗi 100KB đi thẳng vào bcrypt.compare: mỗi request
  // như thế chiếm CPU rất lâu, và đó là cách làm sập server rẻ nhất.
  it('mật khẩu cũ ngắn vẫn đăng nhập được (không áp chính sách mới lên login)', async () => {
    const dto = plainToInstance(LoginUserDto, {
      email: 'a@b.test',
      password: '123456',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('chuỗi khổng lồ bị chặn trước khi tới bcrypt', async () => {
    const dto = plainToInstance(LoginUserDto, {
      email: 'a@b.test',
      password: 'a'.repeat(100_000),
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})

describe('VerifyOtpDto — mã chỉ gồm chữ số', () => {
  it('6 chữ số là hợp lệ', async () => {
    const dto = plainToInstance(VerifyOtpDto, {
      email: 'a@b.test',
      otp: '012345',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it.each([
    ['chữ cái', 'abcdef'],
    ['lẫn chữ', '12a456'],
    ['dấu', '12-456'],
  ])('từ chối %s — không để rác tốn một lượt thử', async (_label, otp) => {
    const dto = plainToInstance(VerifyOtpDto, { email: 'a@b.test', otp })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
