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
      { email: raw, password: 'secret1', username: 'minh' },
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
  it('mật khẩu 6 ký tự là ngắn nhất được chấp nhận', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: '123456',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('5 ký tự thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: '12345',
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('21 ký tự thì bị từ chối — khớp đúng ràng buộc của RegisterUserDto', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'tok',
      password: 'a'.repeat(21),
    })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('thiếu token thì bị từ chối', async () => {
    const dto = plainToInstance(ResetPasswordDto, { password: '123456' })
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
