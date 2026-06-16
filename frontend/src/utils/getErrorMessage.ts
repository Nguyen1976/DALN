const DEFAULT_ERROR_MESSAGE = "Đã xảy ra lỗi";

/**
 * Trích thông điệp lỗi thân thiện từ lỗi axios/backend.
 * Ưu tiên message do backend trả về, fallback về message mặc định.
 */
export function getErrorMessage(
  error: unknown,
  fallback: string = DEFAULT_ERROR_MESSAGE,
): string {
  const err = error as {
    response?: { data?: { message?: string; error?: { message?: string } } };
    message?: string;
  };

  return (
    err?.response?.data?.message ||
    err?.response?.data?.error?.message ||
    err?.message ||
    fallback
  );
}
