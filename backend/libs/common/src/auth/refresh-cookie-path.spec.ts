import {
  refreshCookiePath,
  refreshCookiePathWarning,
} from './session.constants'

/**
 * Đường dẫn của cookie refresh phải khớp với URL mà TRÌNH DUYỆT gọi, không
 * phải URL mà service nhìn thấy.
 *
 * Bộ test này sinh ra từ một sự cố thật trên production: nginx phục vụ API dưới
 * tiền tố `/api` và cắt nó đi trước khi chuyển tiếp, nên service thấy
 * `/user/refresh` và đặt `Path=/user`, trong khi trình duyệt gọi
 * `/api/user/refresh`. Hai đường không khớp nên cookie refresh nằm lại trong
 * trình duyệt mãi mãi: đúng 15 phút sau khi đăng nhập, access cookie tự hết
 * hạn, lời gọi làm mới đi lên mà không mang theo gì, và mọi người dùng bị đăng
 * xuất. Dev không thấy vì ở đó không có tiền tố nào.
 */
describe('refreshCookiePath', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('không đặt env -> /user, đúng như khi service mount ở gốc', () => {
    delete process.env.REFRESH_COOKIE_PATH
    expect(refreshCookiePath()).toBe('/user')
  })

  it('đặt env -> dùng đúng giá trị đó', () => {
    process.env.REFRESH_COOKIE_PATH = '/api/user'
    expect(refreshCookiePath()).toBe('/api/user')
  })

  // Ba dạng gõ nhầm dưới đây đều làm cookie im lặng không được gửi — đúng loại
  // hỏng không để lại dấu vết nào ngoài việc người dùng bị đăng xuất.
  it('bỏ dấu / thừa ở cuối', () => {
    process.env.REFRESH_COOKIE_PATH = '/api/user/'
    expect(refreshCookiePath()).toBe('/api/user')
  })

  it('tự thêm dấu / ở đầu', () => {
    process.env.REFRESH_COOKIE_PATH = 'api/user'
    expect(refreshCookiePath()).toBe('/api/user')
  })

  it('bỏ khoảng trắng thừa hai đầu', () => {
    process.env.REFRESH_COOKIE_PATH = '  /api/user  '
    expect(refreshCookiePath()).toBe('/api/user')
  })

  it('chuỗi rỗng hoặc toàn khoảng trắng -> quay về mặc định', () => {
    process.env.REFRESH_COOKIE_PATH = '   '
    expect(refreshCookiePath()).toBe('/user')
  })

  it('chỉ một dấu / -> quay về mặc định thay vì thành cookie đi khắp nơi', () => {
    process.env.REFRESH_COOKIE_PATH = '/'
    expect(refreshCookiePath()).toBe('/user')
  })
})

describe('refreshCookiePathWarning', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('mặc định và tiền tố hợp lệ -> không cảnh báo', () => {
    delete process.env.REFRESH_COOKIE_PATH
    expect(refreshCookiePathWarning()).toBeNull()

    process.env.REFRESH_COOKIE_PATH = '/api/user'
    expect(refreshCookiePathWarning()).toBeNull()
  })

  /**
   * Mọi route của service này nằm dưới `/user`, nên đường dẫn cookie bắt buộc
   * kết thúc bằng `/user`. Đặt `/api` là cookie rộng hơn mức cần (đi tới mọi
   * service sau cùng tiền tố); đặt `/apiuser` là cookie không bao giờ được gửi.
   * Service không tự biết nó được mount ở đâu, nhưng hình dạng thì kiểm được.
   */
  it('không kết thúc bằng /user -> cảnh báo nêu rõ giá trị sai', () => {
    process.env.REFRESH_COOKIE_PATH = '/api'
    const warning = refreshCookiePathWarning()
    expect(warning).toContain('/api')
    expect(warning).toContain('/user')
  })

  it('gõ dính liền -> cũng phải cảnh báo', () => {
    process.env.REFRESH_COOKIE_PATH = '/apiuser'
    expect(refreshCookiePathWarning()).not.toBeNull()
  })
})
