import { BadRequestException, type ValidationError } from '@nestjs/common'

const VALIDATION_MESSAGES_VI: Record<string, string> = {
  'email must be an email': 'Email không hợp lệ',
  'password must be longer than or equal to 6 characters':
    'Mật khẩu phải có ít nhất 6 ký tự',
  'password should not be empty': 'Vui lòng nhập mật khẩu',
  'email should not be empty': 'Vui lòng nhập email',
}

function formatValidationError(error: ValidationError): string {
  if (error.constraints) {
    return Object.values(error.constraints)
      .map((message) => VALIDATION_MESSAGES_VI[message] || message)
      .join(', ')
  }

  if (error.children?.length) {
    return error.children
      .map((child) => formatValidationError(child))
      .filter(Boolean)
      .join(', ')
  }

  return ''
}

export function validationExceptionFactory(errors: ValidationError[]) {
  const message =
    errors
      .map((error) => formatValidationError(error))
      .filter(Boolean)
      .join('; ') || 'Dữ liệu không hợp lệ'

  return new BadRequestException(message)
}
