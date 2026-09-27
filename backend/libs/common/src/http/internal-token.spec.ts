import {
  DEV_INTERNAL_API_TOKEN,
  resolveInternalApiToken,
} from './internal-token'
import { internalFetch } from './internal-fetch'

describe('resolveInternalApiToken', () => {
  const OLD = { ...process.env }

  afterEach(() => {
    process.env = { ...OLD }
  })

  it('có biến môi trường -> dùng đúng giá trị đó (bỏ khoảng trắng)', () => {
    process.env.INTERNAL_API_TOKEN = '  secret-that  '
    expect(resolveInternalApiToken()).toBe('secret-that')
  })

  it('production thiếu biến -> null (fail-closed, không có giá trị mặc định)', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.INTERNAL_API_TOKEN
    expect(resolveInternalApiToken()).toBeNull()
    process.env.INTERNAL_API_TOKEN = '   '
    expect(resolveInternalApiToken()).toBeNull()
  })

  it('dev để trống -> token dev mặc định, để `docker compose up` chạy được ngay', () => {
    process.env.NODE_ENV = 'development'
    process.env.INTERNAL_API_TOKEN = ''
    expect(resolveInternalApiToken()).toBe(DEV_INTERNAL_API_TOKEN)
  })
})

describe('internalFetch', () => {
  const OLD = { ...process.env }
  const realFetch = global.fetch

  afterEach(() => {
    process.env = { ...OLD }
    global.fetch = realFetch
  })

  it('dev để trống vẫn gửi token dev mặc định (khớp bên nhận)', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.INTERNAL_API_TOKEN
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await internalFetch('http://chat:3003/x')

    const [[, init]] = fetchMock.mock.calls as [string, RequestInit][]
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe(
      DEV_INTERNAL_API_TOKEN,
    )
  })
})
