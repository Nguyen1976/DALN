import { isSecureCookie } from './session.constants'

describe('isSecureCookie', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('mặc định bám theo NODE_ENV khi không đặt COOKIE_SECURE', () => {
    delete process.env.COOKIE_SECURE

    process.env.NODE_ENV = 'production'
    expect(isSecureCookie()).toBe(true)

    process.env.NODE_ENV = 'development'
    expect(isSecureCookie()).toBe(false)
  })

  it('COOKIE_SECURE=false tắt Secure kể cả ở production (HTTP qua IP)', () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = 'false'
    expect(isSecureCookie()).toBe(false)
  })

  it('COOKIE_SECURE=true bật Secure kể cả ngoài production, không phân biệt hoa thường', () => {
    process.env.NODE_ENV = 'development'
    process.env.COOKIE_SECURE = ' TRUE '
    expect(isSecureCookie()).toBe(true)
  })

  it('giá trị lạ thì quay về mặc định thay vì đoán', () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = 'yes'
    expect(isSecureCookie()).toBe(true)
  })
})
