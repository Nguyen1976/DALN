import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { logoutAPI } from "@/redux/slices/userSlice";
import { toast } from "sonner";
import type { AppDispatch } from "@/redux/store";
import { API_ROOT } from "@/utils/constant";
import { getErrorMessage } from "@/utils/getErrorMessage";

declare module "axios" {
  // Screens that render a failure inline set this so the global interceptor
  // stays quiet instead of duplicating the message in a toast.
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean;
    /**
     * Request của chính luồng làm mới phiên. Không được làm mới thêm một lần
     * nữa từ trong nó, nếu không sẽ thành đệ quy khi phiên đã chết.
     */
    skipSessionRefresh?: boolean;
    /** Đã thử lại sau một lần làm mới — chỉ một lần, không lặp. */
    sessionRetried?: boolean;
  }
}

let axiosReduxStore: {
  dispatch: AppDispatch;
};

export const injectStore = (mainStore: { dispatch: AppDispatch }) => {
  axiosReduxStore = mainStore;
};

const authorizeAxiosInstance = axios.create({
  baseURL: API_ROOT,
  withCredentials: true,
  timeout: 1000 * 60 * 10,
});

const LOGIN_URL = "/user/login";
const REFRESH_URL = "/user/refresh";

/**
 * Làm mới phiên — SINGLE-FLIGHT.
 *
 * Sau mốc 15 phút, mọi request đang bay đều nhận 401 cùng lúc. Nếu mỗi request
 * tự gọi /user/refresh thì N request sẽ trình CÙNG một refresh token: đúng một
 * cái rotate được, số còn lại rơi vào cửa sổ ân hạn — và nếu chậm quá 30 giây
 * thì bị hiểu là token bị đánh cắp, giết sạch phiên của một người vô tội.
 *
 * Nên chỉ một lời gọi thật được phát ra; các request khác chờ đúng promise đó.
 */
let refreshInFlight: Promise<void> | null = null;

function refreshSession(): Promise<void> {
  refreshInFlight ??= authorizeAxiosInstance
    .post(REFRESH_URL, undefined, {
      skipErrorToast: true,
      skipSessionRefresh: true,
    })
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * Mã DUY NHẤT nghĩa là phiên đã chấm dứt thật.
 *
 * Cố ý không có ACCESS_TOKEN_MISSING ở đây: cookie access có maxAge đúng bằng
 * TTL của token, nên trình duyệt tự xoá nó đúng lúc hết hạn — request đầu tiên
 * sau mốc 15 phút KHÔNG mang access token nào cả. Coi đó là phiên chết sẽ đăng
 * xuất người dùng dù refresh token còn hạn 7 ngày. TOKEN_INVALID cũng vậy: sau
 * khi đổi JWT_SECRET, access token cũ thành vô hiệu nhưng refresh token là
 * chuỗi opaque nên vẫn cứu được phiên.
 */
const SESSION_ENDED = "SESSION_REVOKED";

authorizeAxiosInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ code?: string }>) => {
    const config = error.config as InternalAxiosRequestConfig | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const url = config?.url ?? "";

    // 401 ở đây có ba nghĩa khác nhau, và gộp chúng lại là nguồn của mọi lỗi
    // "tự nhiên bị đăng xuất":
    //   - đăng nhập sai mật khẩu   -> KHÔNG đăng xuất, còn chưa có phiên nào
    //   - access token hết hạn     -> làm mới rồi thử lại, người dùng không thấy gì
    //   - phiên bị thu hồi/chết    -> đăng xuất thật
    const isLoginAttempt = url.includes(LOGIN_URL);

    // 503 KHÔNG phải phiên chấm dứt: server không kiểm tra được phiên vì hạ
    // tầng lỗi. Đăng xuất ở đây nghĩa là một cú nấc của Redis đá hết người
    // dùng ra ngoài — đúng điều thiết kế đã cố tránh bằng cách trả 503.
    if (status === 503 && code === "SESSION_CHECK_UNAVAILABLE") {
      if (!config?.skipErrorToast) {
        const text = "Hệ thống đang tạm gián đoạn, vui lòng thử lại.";
        toast.error(text, { id: text });
      }
      return Promise.reject(error);
    }

    if (status === 401 && !isLoginAttempt) {
      // Thử làm mới cho MỌI 401 trừ khi phiên đã bị thu hồi: hết hạn, mất
      // cookie, hay token vô hiệu đều có thể cứu được bằng refresh token.
      const canRefresh =
        config &&
        !config.skipSessionRefresh &&
        !config.sessionRetried &&
        code !== SESSION_ENDED;

      if (canRefresh) {
        try {
          await refreshSession();
          config.sessionRetried = true;
          // Request gốc chạy lại với cookie mới; người dùng không thấy gì cả.
          return await authorizeAxiosInstance.request(config);
        } catch (refreshError) {
          const refreshStatus = (refreshError as AxiosError).response?.status;
          // Làm mới thất bại vì HẠ TẦNG (503, 5xx, mất mạng) không phải bằng
          // chứng phiên đã chết — giữ người dùng ở lại và để họ thử lại. Chỉ
          // 401 từ chính /user/refresh mới nghĩa là phiên chấm dứt thật.
          if (refreshStatus !== 401) {
            if (!config.skipErrorToast) {
              const text = "Hệ thống đang tạm gián đoạn, vui lòng thử lại.";
              toast.error(text, { id: text });
            }
            return Promise.reject(error);
          }
        }
      }

      axiosReduxStore?.dispatch(logoutAPI());

      // Phiên chấm dứt thì nói đúng như vậy, thay vì để lọt thông điệp
      // "UNAUTHORIZED" thô ra trước mặt người dùng.
      if (!config?.skipErrorToast) {
        const text =
          code === SESSION_ENDED
            ? "Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại."
            : getErrorMessage(error);
        toast.error(text, { id: text });
      }
      return Promise.reject(error);
    }

    // Screens that render the failure themselves (inline under a field, or as
    // a banner on the form) opt out — otherwise the user gets told twice.
    if (!config?.skipErrorToast) {
      const message = getErrorMessage(error);
      const text =
        message === "Network Error" ? "Không thể kết nối đến máy chủ" : message;
      // Keying by text collapses a burst of identical failures into one toast
      // instead of stacking a wall of the same sentence.
      toast.error(text, { id: text });
    }

    return Promise.reject(error);
  },
);

const bodyOf = <T>(response: AxiosResponse<T>) => response.data;

/** One page of a list; send `nextCursor` back for the next (null: no more). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Calls that answer with the response body, typed. */
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    authorizeAxiosInstance.get<T>(url, config).then(bodyOf),
  post: <T = void>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    authorizeAxiosInstance.post<T>(url, body, config).then(bodyOf),
  put: <T = void>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    authorizeAxiosInstance.put<T>(url, body, config).then(bodyOf),
  patch: <T = void>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    authorizeAxiosInstance.patch<T>(url, body, config).then(bodyOf),
};

/** Dùng cho luồng hồi phục socket: làm mới phiên trước khi nối lại. */
export { refreshSession };

export default authorizeAxiosInstance;
