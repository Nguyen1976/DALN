import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Số giây còn lại tính từ mốc `until` tới hiện tại, không bao giờ âm.
 * Đặt ngoài hook vì đây là hàm thuần, không phụ thuộc React — để trong hook
 * sẽ khiến `run` bị coi là thiếu dependency.
 */
function secondsLeft(until: number) {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/** Đọc mốc đã lưu; trả 0 nếu chưa từng lưu hoặc đọc thất bại (chế độ riêng tư). */
function readDeadline(storageKey: string): number {
  if (!storageKey) return 0;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

/** Ghi mốc mới; im lặng bỏ qua nếu localStorage không dùng được. */
function writeDeadline(storageKey: string, until: number) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, String(until));
  } catch {
    /* chế độ riêng tư: mất phép lịch sự, server vẫn chặn bằng 429 */
  }
}

/**
 * Đếm ngược theo MỐC THỜI GIAN TUYỆT ĐỐI, không phải bộ đếm giảm dần.
 *
 * Bộ đếm sống trong state React sẽ về 0 khi tải lại trang, tức là bỏ qua được
 * thời gian chờ. Mốc thời gian lưu trong localStorage thì không. Đây vẫn chỉ
 * là phép lịch sự — server mới là nơi thật sự chặn (429).
 *
 * Mốc lưu theo từng `key` (thường là địa chỉ email) để đổi tài khoản không
 * thừa hưởng thời gian chờ của tài khoản trước. `storagePrefix` là tham số vì
 * mỗi luồng (OTP, quên mật khẩu, ...) có không gian key riêng — hardcode một
 * tiền tố chung sẽ làm mất thời gian chờ của người đang đợi dở ở luồng khác
 * khi tiền tố đổi.
 */
export function useResendCountdown(key: string, storagePrefix: string) {
  // key rỗng (chưa biết email) thì không có gì để lưu/đọc — countdown chỉ
  // sống trong bộ nhớ của lần chạy hiện tại.
  const storageKey = key ? `${storagePrefix}:${key}` : "";

  // Seed lười ngay từ lần render đầu tiên: nếu khởi tạo bằng 0 rồi sửa lại
  // trong effect, trình duyệt có thể kịp vẽ khung hình với nút "Gửi lại" ở
  // trạng thái mở khoá trước khi effect chạy và sửa lại số giây — người dùng
  // thấy nút nhấp nháy như bấm được trong khi chưa hết hạn chờ.
  const [seconds, setSeconds] = useState(() => secondsLeft(readDeadline(storageKey)));
  const timerRef = useRef<number | null>(null);

  const run = useCallback((until: number) => {
    if (timerRef.current) window.clearInterval(timerRef.current);

    const remaining = secondsLeft(until);
    setSeconds(remaining);
    if (remaining <= 0) {
      timerRef.current = null;
      return;
    }

    timerRef.current = window.setInterval(() => {
      const tick = secondsLeft(until);
      setSeconds(tick);
      if (tick <= 0 && timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 500);
  }, []);

  // Dừng hẳn: dọn interval đang chạy (nếu có) và đưa số giây về 0. Cần tách
  // riêng khỏi run() vì "không có mốc nào đang chờ" và "còn 0 giây" là hai
  // tình huống khác nhau — cái đầu phải chủ động dừng đồng hồ của key cũ.
  const stop = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSeconds(0);
  }, []);

  const start = useCallback(
    (duration = 60) => {
      // Không đặt lại một mốc đang còn sống. Server dùng SET NX EX: khi slot
      // vẫn bị giữ thì TTL cũ chạy tiếp và yêu cầu mới bị bỏ qua lặng lẽ —
      // reset ở client sẽ báo cho người dùng một khoảng chờ dài hơn thực tế.
      const existing = readDeadline(storageKey);
      const until =
        existing > Date.now() ? existing : Date.now() + duration * 1000;
      // Ghi mốc TRƯỚC khi chạy tick, để tải lại trang ngay sau khi bấm vẫn
      // khôi phục đúng thời gian chờ còn lại.
      writeDeadline(storageKey, until);
      run(until);
    },
    [run, storageKey],
  );

  // Nhặt lại mốc đã lưu sau khi tải lại trang, HOẶC khi storageKey đổi (ví
  // dụ người dùng gõ sang một email khác). Nếu key mới không có mốc nào còn
  // hiệu lực, phải chủ động stop() — nếu không, đồng hồ của key cũ vẫn chạy
  // và hiển thị nhầm lên key mới.
  useEffect(() => {
    const until = readDeadline(storageKey);
    if (until > Date.now()) run(until);
    else stop();
  }, [run, stop, storageKey]);

  // Interval bị rò khi component unmount giữa nhịp tick — đây chính là lỗi
  // VerifyOtp từng gặp trước khi có hook này.
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  return { seconds, start };
}
