import { z } from "zod";

/**
 * Chính sách mật khẩu, khớp đúng DTO của backend.
 *
 * `max` đếm ký tự còn `maxBytes` đếm byte UTF-8: bcrypt chỉ dùng 72 byte đầu
 * rồi lặng lẽ bỏ phần sau, nên 40 ký tự tiếng Việt có dấu đã vượt trần dù mới
 * hơn nửa số ký tự cho phép. Chặn ở client để người dùng biết ngay tại ô nhập,
 * thay vì nhận lỗi 400 chung chung sau khi bấm gửi.
 */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 64;
const PASSWORD_MAX_BYTES = 72;

const password = z
  .string()
  .min(PASSWORD_MIN, `Mật khẩu phải có ít nhất ${PASSWORD_MIN} ký tự`)
  .max(PASSWORD_MAX, `Mật khẩu tối đa ${PASSWORD_MAX} ký tự`)
  .refine(
    (value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES,
    `Mật khẩu quá dài (tối đa ${PASSWORD_MAX_BYTES} byte — chữ có dấu tính 2-3 byte)`,
  );

const email = z
  .string()
  .min(1, "Vui lòng nhập email")
  .email("Email không hợp lệ");

/**
 * Đăng nhập KHÔNG áp chính sách mới.
 *
 * Người đã có mật khẩu 6 ký tự từ trước vẫn phải đăng nhập được; siết ở đây sẽ
 * khoá họ ra khỏi chính tài khoản của mình mà không có đường nào sửa. Trần 200
 * ký tự chỉ để chặn chuỗi khổng lồ đi vào bcrypt.
 */
const formLoginScheme = z.object({
  email,
  password: z
    .string()
    .min(1, "Vui lòng nhập mật khẩu")
    .max(200, "Mật khẩu quá dài"),
});

const formRegisterScheme = z
  .object({
    username: z
      .string()
      .min(3, "Tên người dùng phải có ít nhất 3 ký tự")
      .max(30, "Tên người dùng tối đa 30 ký tự"),
    email,
    password,
    confirmPassword: z.string().min(1, "Vui lòng nhập lại mật khẩu"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirmPassword"],
  });

const forgotPasswordScheme = z.object({ email });

/** Cùng luật với đăng ký — hai đường vào một trường không được khác luật. */
const resetPasswordScheme = z
  .object({
    password,
    confirmPassword: z.string().min(1, "Vui lòng nhập lại mật khẩu"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirmPassword"],
  });

/**
 * Đổi mật khẩu trong Cài đặt: đúng MỘT cách tự chứng minh, khớp với
 * `ChangePasswordDto` của backend.
 *
 * `method` là trường của riêng form, không gửi đi — nó quyết định ô nào bắt
 * buộc. Bọc trong `superRefine` thay vì `.refine` để lỗi gắn được vào đúng ô
 * người dùng đang bỏ trống, thay vì một thông báo chung ở đầu form.
 */
const changePasswordScheme = z
  .object({
    method: z.enum(['current-password', 'otp']),
    currentPassword: z.string(),
    otp: z.string(),
    newPassword: password,
    confirmPassword: z.string().min(1, 'Vui lòng nhập lại mật khẩu'),
    revokeOtherSessions: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.method === 'current-password' && !values.currentPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentPassword'],
        message: 'Vui lòng nhập mật khẩu hiện tại',
      })
    }
    if (values.method === 'otp' && values.otp.length !== 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['otp'],
        message: 'Mã gồm 6 chữ số',
      })
    }
    if (values.newPassword !== values.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Mật khẩu xác nhận không khớp',
      })
    }
  })

export {
  formLoginScheme,
  formRegisterScheme,
  forgotPasswordScheme,
  resetPasswordScheme,
  changePasswordScheme,
  PASSWORD_MIN,
  PASSWORD_MAX,
};
