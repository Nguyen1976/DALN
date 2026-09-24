import { JwtService } from '@nestjs/jwt'
import {
  ACCESS_TOKEN_TYPE,
  readCookie,
  resolveAccessToken,
} from './resolve-tokens'

const jwt = new JwtService({ secret: 'test-secret' })
const other = new JwtService({ secret: 'other-secret' })

const claims = {
  userId: 'u1',
  email: 'u1@example.test',
  username: 'u1',
  sid: 's1',
  typ: ACCESS_TOKEN_TYPE,
}

const sign = (extra: Record<string, unknown> = {}, service = jwt) =>
  service.sign({ ...claims, ...extra }, { expiresIn: '15m' })

describe('resolveAccessToken', () => {
  it('access hợp lệ -> trả danh tính kèm sid', () => {
    expect(resolveAccessToken(jwt, sign())).toEqual({
      ok: true,
      payload: {
        userId: 'u1',
        email: 'u1@example.test',
        username: 'u1',
        sid: 's1',
      },
    })
  })

  it('không có cookie access -> ACCESS_TOKEN_MISSING', () => {
    expect(resolveAccessToken(jwt, undefined)).toEqual({
      ok: false,
      code: 'ACCESS_TOKEN_MISSING',
    })
    expect(resolveAccessToken(jwt, null)).toEqual({
      ok: false,
      code: 'ACCESS_TOKEN_MISSING',
    })
    expect(resolveAccessToken(jwt, '')).toEqual({
      ok: false,
      code: 'ACCESS_TOKEN_MISSING',
    })
  })

  // Phân biệt được hai mã này là điều kiện để FE biết khi nào nên gọi refresh
  // và khi nào phải đăng xuất. Gộp chung thành 401 trần là mất thông tin đó.
  it('access hết hạn -> ACCESS_TOKEN_EXPIRED, không phải TOKEN_INVALID', () => {
    const expired = jwt.sign({
      ...claims,
      exp: Math.floor(Date.now() / 1000) - 60,
    })

    expect(resolveAccessToken(jwt, expired)).toEqual({
      ok: false,
      code: 'ACCESS_TOKEN_EXPIRED',
    })
  })

  it('sai chữ ký -> TOKEN_INVALID', () => {
    expect(resolveAccessToken(jwt, sign({}, other))).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  it('chuỗi rác -> TOKEN_INVALID', () => {
    expect(resolveAccessToken(jwt, 'khong-phai-jwt')).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  // Token cấp trước khi có cơ chế phiên: chữ ký vẫn đúng nếu secret chưa đổi,
  // nhưng không có sid thì không thu hồi được. Không dung thứ.
  it('thiếu sid -> TOKEN_INVALID', () => {
    const legacy = jwt.sign(
      { userId: 'u1', email: 'e', username: 'u', typ: ACCESS_TOKEN_TYPE },
      { expiresIn: '15m' },
    )

    expect(resolveAccessToken(jwt, legacy)).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  it('sid rỗng -> TOKEN_INVALID', () => {
    expect(resolveAccessToken(jwt, sign({ sid: '' }))).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  it.each([
    ['thiếu typ', { typ: undefined }],
    ['typ sai', { typ: 'rt' }],
  ])('%s -> TOKEN_INVALID', (_label, extra) => {
    expect(resolveAccessToken(jwt, sign(extra))).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  it('thiếu userId -> TOKEN_INVALID', () => {
    expect(resolveAccessToken(jwt, sign({ userId: '' }))).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  it('payload không phải object -> TOKEN_INVALID', () => {
    expect(resolveAccessToken(jwt, jwt.sign('chuoi-tran'))).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
    })
  })

  // email/username chỉ để hiển thị; thiếu thì không được đánh sập cả phiên.
  it('thiếu email/username -> vẫn hợp lệ, trả chuỗi rỗng', () => {
    const token = jwt.sign(
      { userId: 'u1', sid: 's1', typ: ACCESS_TOKEN_TYPE },
      { expiresIn: '15m' },
    )

    expect(resolveAccessToken(jwt, token)).toEqual({
      ok: true,
      payload: { userId: 'u1', email: '', username: '', sid: 's1' },
    })
  })
})

describe('readCookie', () => {
  it('đọc đúng cookie giữa nhiều cookie khác', () => {
    expect(readCookie('a=1; accessToken=abc; b=2', 'accessToken')).toBe('abc')
  })

  it('giữ nguyên giá trị có dấu = bên trong', () => {
    expect(readCookie('refreshToken=sid.ver=ify', 'refreshToken')).toBe(
      'sid.ver=ify',
    )
  })

  it('giải mã giá trị đã urlencode', () => {
    expect(readCookie('x=a%20b', 'x')).toBe('a b')
  })

  it('không có header hoặc không có key -> null', () => {
    expect(readCookie(undefined, 'accessToken')).toBeNull()
    expect(readCookie('a=1', 'accessToken')).toBeNull()
  })
})
