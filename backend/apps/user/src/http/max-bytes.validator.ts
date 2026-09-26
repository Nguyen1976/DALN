import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator'

/**
 * Chặn theo SỐ BYTE UTF-8, không phải số ký tự.
 *
 * Vì sao cần cho mật khẩu: bcrypt (kể cả bcryptjs) chỉ dùng 72 byte đầu và
 * lặng lẽ bỏ phần sau. `@MaxLength(64)` đếm ký tự, nên "Mật khẩu rất dài của
 * tôi…" 64 ký tự tiếng Việt là ~120 byte — phần đuôi bị cắt mà không ai biết,
 * và hai mật khẩu khác nhau ở đuôi trở thành cùng một hash. OWASP nói rõ:
 * không được cắt mật khẩu một cách âm thầm.
 */
export function MaxBytes(max: number, options?: ValidationOptions) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'maxBytes',
      target: target.constructor,
      propertyName,
      constraints: [max],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') return true
          const [limit] = args.constraints as [number]
          return Buffer.byteLength(value, 'utf8') <= limit
        },
        defaultMessage(args: ValidationArguments): string {
          const [limit] = args.constraints as [number]
          return `${args.property} không được vượt ${limit} byte`
        },
      },
    })
  }
}
