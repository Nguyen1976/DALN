import { JwtService } from '@nestjs/jwt'
import { resolveTokens } from './resolve-tokens'

const jwt = new JwtService({ secret: 'test-secret' })
const payload = { userId: 'u1', email: 'u1@example.test', username: 'u1' }

const valid = () => jwt.sign(payload, { expiresIn: '15m' })
const expired = () =>
  jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 })
const forged = () =>
  new JwtService({ secret: 'other-secret' }).sign(payload, { expiresIn: '15m' })

describe('resolveTokens', () => {
  it('access hợp lệ -> dùng luôn, không đụng tới refresh', () => {
    expect(resolveTokens(jwt, valid(), valid())).toMatchObject({
      ok: true,
      usedRefresh: false,
      payload: { userId: 'u1' },
    })
  })

  it('access hết hạn nhưng vẫn được gửi kèm + refresh hợp lệ -> làm mới', () => {
    expect(resolveTokens(jwt, expired(), valid())).toMatchObject({
      ok: true,
      usedRefresh: true,
    })
  })

  // Cookie accessToken có maxAge đúng bằng TTL của JWT, nên trình duyệt xoá nó
  // đúng lúc token hết hạn: từ phút thứ 15 request chỉ còn mang refreshToken.
  // Nhánh này từng trả ACCESS_TOKEN_MISSING -> frontend đăng xuất dù refresh
  // còn hạn 7 ngày.
  it('cookie access đã bị trình duyệt xoá + refresh hợp lệ -> làm mới', () => {
    expect(resolveTokens(jwt, undefined, valid())).toMatchObject({
      ok: true,
      usedRefresh: true,
      payload: { userId: 'u1' },
    })
  })

  it('cookie access đã bị xoá + refresh hỏng hoặc hết hạn -> REFRESH_TOKEN_INVALID', () => {
    expect(resolveTokens(jwt, undefined, forged())).toEqual({
      ok: false,
      code: 'REFRESH_TOKEN_INVALID',
    })
    expect(resolveTokens(jwt, null, expired())).toEqual({
      ok: false,
      code: 'REFRESH_TOKEN_INVALID',
    })
  })

  it('không có cookie nào -> ACCESS_TOKEN_MISSING', () => {
    expect(resolveTokens(jwt, undefined, undefined)).toEqual({
      ok: false,
      code: 'ACCESS_TOKEN_MISSING',
    })
  })

  it('access hết hạn, không có refresh -> REFRESH_TOKEN_MISSING', () => {
    expect(resolveTokens(jwt, expired(), undefined)).toEqual({
      ok: false,
      code: 'REFRESH_TOKEN_MISSING',
    })
  })

  it('access sai chữ ký -> TOKEN_INVALID, không lùi sang refresh', () => {
    expect(resolveTokens(jwt, forged(), valid())).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })
})
