/**
 * Chỉ can thiệp khi dev chạy watch mode bằng polling trong Docker (bind mount
 * trên macOS/Windows không phát sự kiện fs) — xem WATCHPACK_POLLING và
 * CHOKIDAR_INTERVAL trong .env.docker.
 *
 * fork-ts-checker-webpack-plugin (Nest bật sẵn để kiểm kiểu khi watch) lấy chu
 * kỳ poll từ `watchOptions.poll`. Polling bật bằng biến môi trường thì
 * `watchOptions.poll` trống, plugin truyền `binaryInterval: undefined` cho
 * chokidar, và chỉ cần một file nhị phân nằm trong src (logo mail của
 * notification) là tiến trình chết: ERR_INVALID_ARG_TYPE "interval".
 *
 * Build prod (CI, không có WATCHPACK_POLLING) nhận nguyên option mặc định, nên
 * bundle không đổi.
 */
module.exports = (options) => {
  const poll = Number.parseInt(process.env.CHOKIDAR_INTERVAL ?? '', 10)
  if (!process.env.WATCHPACK_POLLING || !Number.isFinite(poll)) return options
  return { ...options, watchOptions: { ...options.watchOptions, poll } }
}
