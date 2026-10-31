import { stickyAssign } from './sticky-assign'

const ABC = [
  'A',
  'A',
  'A',
  'A',
  'A',
  'A',
  'C',
  'C',
  'B',
  'B',
  'B',
  'B',
  'B',
  'C',
  'C',
  'C',
]

/** PRNG có seed để property test lặp lại được. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('stickyAssign', () => {
  it('cold start gives everything to the only member', () => {
    expect(stickyAssign(['A'], Array<null>(16).fill(null))).toEqual(
      Array<string>(16).fill('A'),
    )
  })

  it('a joining member takes exactly its quota', () => {
    expect(stickyAssign(['A', 'B', 'C', 'D'], ABC)).toEqual([
      'A',
      'A',
      'A',
      'A',
      'D',
      'D',
      'C',
      'C',
      'B',
      'B',
      'B',
      'B',
      'D',
      'C',
      'C',
      'D',
    ])
  })

  it("a dead member's partitions are the only ones that move", () => {
    expect(stickyAssign(['A', 'B'], ABC)).toEqual([
      'A',
      'A',
      'A',
      'A',
      'A',
      'A',
      'B',
      'A',
      'B',
      'B',
      'B',
      'B',
      'B',
      'B',
      'A',
      'B',
    ])
  })

  it('member order and duplicates do not change the result', () => {
    expect(stickyAssign(['B', 'A', 'C', 'A'], ABC)).toEqual(ABC)
  })

  it('returns nothing when nobody is alive', () => {
    expect(stickyAssign([], ABC)).toEqual([])
  })

  it('is a fixed point', () => {
    for (const members of [
      ['A'],
      ['A', 'B'],
      ['A', 'B', 'C'],
      ['A', 'B', 'C', 'D'],
    ]) {
      const once = stickyAssign(members, ABC)
      expect(stickyAssign(members, once)).toEqual(once)
    }
  })

  it('balances within one and moves the minimum', () => {
    const random = rng(42)
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    for (let run = 0; run < 300; run++) {
      const members = names.filter(() => random() < 0.6)
      if (!members.length) members.push('A')
      const owners = Array.from({ length: 16 }, () =>
        random() < 0.15 ? null : names[Math.floor(random() * names.length)],
      )

      const result = stickyAssign(members, owners)

      const counts = members.map((m) => result.filter((o) => o === m).length)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
      expect(result.every((o) => members.includes(o))).toBe(true)

      // Tối thiểu: chỉ dời partition của người đã chết/không có chủ, cộng phần
      // vượt quota của từng người còn sống.
      const alive = new Set(members)
      const quota = new Map(
        members.map((m) => [m, result.filter((o) => o === m).length]),
      )
      const forced =
        owners.filter((o) => !o || !alive.has(o)).length +
        members.reduce((sum, m) => {
          const held = owners.filter((o) => o === m).length
          return sum + Math.max(0, held - quota.get(m)!)
        }, 0)
      const moved = result.filter((o, i) => o !== owners[i]).length
      expect(moved).toBe(forced)
    }
  })
})
