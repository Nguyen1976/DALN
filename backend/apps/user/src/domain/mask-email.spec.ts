import { maskEmail } from './mask-email'

describe('maskEmail', () => {
  it('giữ 2 ký tự đầu và 2 ký tự cuối của phần trước @', () => {
    expect(maskEmail('ngminh4205@gmail.com')).toBe('ng******05@gmail.com')
  })

  it('tên ngắn không đủ để che thì thay toàn bộ bằng dấu sao', () => {
    // 4 ký tự trở xuống: giữ 2 đầu + 2 cuối là không che gì cả.
    expect(maskEmail('an@example.test')).toBe('**@example.test')
    expect(maskEmail('abcd@example.test')).toBe('****@example.test')
  })

  it('chuẩn hoá hoa thường và khoảng trắng thừa', () => {
    expect(maskEmail('  NgMinh4205@Gmail.com ')).toBe('ng******05@gmail.com')
  })

  it('chuỗi không phải email thì che sạch, không làm lộ gì', () => {
    expect(maskEmail('khong-phai-email')).toBe('****')
    expect(maskEmail('')).toBe('****')
  })
})
