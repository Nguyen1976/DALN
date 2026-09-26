import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator'

const isProvided = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== ''

/**
 * Đúng MỘT trong nhóm trường được gửi lên — không nhiều hơn, không ít hơn.
 *
 * Vì sao là ràng buộc ở tầng validate chứ không phải một chuỗi `if` trong
 * service: khi client gửi cả hai cách xác thực, việc service tự chọn lấy một
 * cái biến hành vi thành "cái nào viết trước trong if thì thắng" — người đọc
 * controller không đoán ra được, và người gọi API thì tưởng cả hai đều đã được
 * kiểm. Nói "sai đầu vào" ngay từ cửa là câu trả lời trung thực duy nhất.
 *
 * Chuỗi rỗng tính là KHÔNG gửi: form để trống một ô thường gửi `''` chứ không
 * bỏ hẳn trường, và người dùng để trống thì đúng là chưa chọn cách nào.
 */
export function ExactlyOneOf(siblings: string[], options?: ValidationOptions) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'exactlyOneOf',
      target: target.constructor,
      propertyName,
      constraints: [siblings],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [others] = args.constraints as [string[]]
          const object = args.object as Record<string, unknown>
          const provided = [
            value,
            ...others.map((name) => object[name]),
          ].filter(isProvided)
          return provided.length === 1
        },
        defaultMessage(args: ValidationArguments): string {
          const [others] = args.constraints as [string[]]
          const group = [args.property, ...others].join(' hoặc ')
          return `Cần đúng một trong: ${group}`
        },
      },
    })
  }
}
