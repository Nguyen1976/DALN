import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  LoginUserDto,
  MakeFriendByUsernameDto,
  MakeFriendDto,
  RegisterUserDto,
  ResendOtpDto,
  VerifyOtpDto,
} from './user-http.dto'

const invalidFields = async (dto: object) =>
  (await validate(dto)).map((e) => e.property)

describe('email ở đầu vào: bỏ khoảng trắng, không phân biệt hoa thường', () => {
  const raw = '  NgMinh4205@Gmail.COM '

  it.each([
    ['RegisterUserDto', RegisterUserDto, { email: raw, password: 'secret1', username: 'minh' }],
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
    const dto = plainToInstance(MakeFriendByUsernameDto, { username: '  dmhanguyen ' })
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
