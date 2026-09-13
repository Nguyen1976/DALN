// Giá trị header AMQP có thể tới dạng number, string hoặc Buffer tuỳ client
// publish (amqplib giải mã longstr thành string, tool khác có thể gửi bytes).
// Nội bộ của rmq — không export ra index.

export function headerToNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return Number(raw)
  if (Buffer.isBuffer(raw)) return Number(raw.toString())
  return NaN
}

export function headerToText(raw: unknown): string {
  if (raw === undefined || raw === null) return '-'
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (Buffer.isBuffer(raw)) return raw.toString()
  return JSON.stringify(raw) ?? '-'
}
