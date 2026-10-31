/**
 * Một "làn" tuần tự cho mỗi hội thoại: tác vụ sau của cùng một key chỉ chạy khi
 * tác vụ trước đã xong (kể cả khi tác vụ trước lỗi). Các key khác nhau vẫn chạy
 * song song, nên prefetch và batching không mất tác dụng.
 *
 * Cần vì consumer nhận nhiều tin cùng lúc (prefetch): tin gửi ảnh còn đang chờ
 * kiểm tra file trên S3 thì tin chữ gửi sau đã kịp vào BatchWriter trước, và
 * được ghi `createdAt` sớm hơn.
 */
export class ConversationLanes {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    // Dọn key NGAY trong promise trả về: caller await xong là key đã được dọn.
    const tracked: Promise<T> = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.tails.get(key) === tracked) this.tails.delete(key)
      })
    this.tails.set(key, tracked)
    return tracked
  }

  /** Số hội thoại đang có tác vụ chờ hoặc đang chạy. */
  get size(): number {
    return this.tails.size
  }
}
