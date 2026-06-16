import axios from "axios";
import { logoutAPI } from "@/redux/slices/userSlice";
import { toast } from "sonner";
import type { AppDispatch } from "@/redux/store";
import { API_ROOT } from "@/utils/constant";
import { getErrorMessage } from "@/utils/getErrorMessage";

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
    if (error.response?.status === 401) {
      axiosReduxStore?.dispatch(logoutAPI());
    }

    const message = getErrorMessage(error);
    toast.error(
      message === "Network Error" ? "Không thể kết nối đến máy chủ" : message,
    );

    return Promise.reject(error);
  },
);

export default authorizeAxiosInstance;
