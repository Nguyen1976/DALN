/**
 * Email không phân biệt hoa thường và không mang khoảng trắng thừa — cùng quy
 * tắc với backend (DTO chuẩn hoá ở đầu vào). Chuẩn hoá cả ở đây để giá trị gửi
 * đi luôn nhất quán, kể cả khi người dùng dán email có dấu cách hay viết hoa.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
