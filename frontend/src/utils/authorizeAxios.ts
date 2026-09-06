import axios from "axios";
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

authorizeAxiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 ở đây có hai nghĩa hoàn toàn khác nhau:
    //  - phiên hết hạn / bị thu hồi  -> phải đăng xuất
    //  - đăng nhập sai mật khẩu      -> KHÔNG được đăng xuất, người dùng còn
    //    chưa có phiên nào để mà thoát
    // Trong toàn bộ luồng công khai của user-service, chỉ /user/login trả 401
    // (các lỗi OTP đều là 400), nên loại trừ đúng đường này là đủ.
    const isLoginAttempt = Boolean(error.config?.url?.includes("/user/login"));

    if (error.response?.status === 401 && !isLoginAttempt) {
      axiosReduxStore?.dispatch(logoutAPI());
    }

    // Screens that render the failure themselves (inline under a field, or as
    // a banner on the form) opt out — otherwise the user gets told twice.
    if (!error.config?.skipErrorToast) {
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

export default authorizeAxiosInstance;
