/**
 * Bảng phân công: partition → instance nên giữ nó.
 *
 * Hàm thuần — không đọc giờ, không random, không state. Mọi instance chạy cùng
 * hàm trên cùng (members, owners) đọc từ Redis nên ra cùng một bảng, không cần
 * ai làm "sếp". Hai mục tiêu:
 *  - chia đều: mỗi member giữ ⌊n/m⌋ hoặc ⌈n/m⌉ partition;
 *  - ít đổi chủ nhất: chỉ dời partition của member đã chết / chưa có chủ, và
 *    phần vượt quota của từng member còn sống.
 *
 * Hoà luôn xét theo tên, partition luôn xét theo chỉ số tăng dần — thiếu một
 * luật hoà là hai instance có thể tính ra hai bảng khác nhau.
 */
export function stickyAssign(
  members: string[],
  owners: (string | null)[],
): string[] {
  const alive = [...new Set(members)].sort()
  if (alive.length === 0) return []

  const holding = new Map(alive.map((m) => [m, 0]))
  for (const owner of owners) {
    if (owner && holding.has(owner)) holding.set(owner, holding.get(owner)! + 1)
  }

  // Suất +1 cho người đang giữ nhiều nhất: họ phải nhả ít nhất.
  const base = Math.floor(owners.length / alive.length)
  const extra = owners.length % alive.length
  const quota = new Map(alive.map((m) => [m, base]))
  ;[...alive]
    .sort((a, b) => holding.get(b)! - holding.get(a)! || a.localeCompare(b))
    .slice(0, extra)
    .forEach((m) => quota.set(m, base + 1))

  // Giữ: chủ còn sống, chưa đủ quota.
  const assigned = new Map(alive.map((m) => [m, 0]))
  const result = owners.map((owner) => {
    if (owner && quota.has(owner) && assigned.get(owner)! < quota.get(owner)!) {
      assigned.set(owner, assigned.get(owner)! + 1)
      return owner
    }
    return null
  })

  // Chia phần còn lại cho người thiếu nhiều nhất.
  const deficit = (m: string) => quota.get(m)! - assigned.get(m)!
  return result.map((owner) => {
    if (owner) return owner
    const taker = alive
      .filter((m) => deficit(m) > 0)
      .sort((a, b) => deficit(b) - deficit(a) || a.localeCompare(b))[0]
    assigned.set(taker, assigned.get(taker)! + 1)
    return taker
  })
}
