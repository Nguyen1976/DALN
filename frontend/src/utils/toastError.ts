import { toast } from "sonner";
import { getErrorMessage } from "./getErrorMessage";

/** Hiển thị toast lỗi từ exception axios/backend. */
export function showErrorToast(error: unknown, fallback: string) {
  toast.error(getErrorMessage(error, fallback));
}
