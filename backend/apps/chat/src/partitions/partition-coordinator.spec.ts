import type { LeaseStore } from './lease-store'
import {
  PartitionCoordinator,
  type CoordinatorOptions,
} from './partition-coordinator'

/** Lease store trong bộ nhớ, cùng ngữ nghĩa TTL với bản Redis, đồng hồ giả. */
class FakeLeaseStore implements LeaseStore {
  members = new Map<string, number>()
  leases = new Map<number, { owner: string; until: number }>()
  calls: string[] = []
  private listeners: (() => void)[] = []

  constructor(readonly clock: { now: number }) {}

  heartbeat(memberId: string, ttlMs: number) {
    this.calls.push(`heartbeat ${memberId}`)
    this.members.set(memberId, this.clock.now)
    for (const [m, at] of this.members) {
      if (at < this.clock.now - ttlMs) this.members.delete(m)
    }
    return Promise.resolve([...this.members.keys()].sort())
  }
  leave(memberId: string) {
    this.calls.push(`leave ${memberId}`)
    this.members.delete(memberId)
    return Promise.resolve()
  }
  owners() {
    return Promise.resolve(
      Array.from({ length: 16 }, (_, p) => this.ownerOf(p)),
    )
  }
  acquire(p: number, memberId: string, ttlMs: number) {
    if (this.ownerOf(p)) return Promise.resolve(false)
    this.leases.set(p, { owner: memberId, until: this.clock.now + ttlMs })
    return Promise.resolve(true)
  }
  renew(
    p: number,
    memberId: string,
    ttlMs: number,
  ): Promise<'renewed' | 'lost'> {
    if (this.ownerOf(p) !== memberId) return Promise.resolve('lost' as const)
    this.leases.set(p, { owner: memberId, until: this.clock.now + ttlMs })
    return Promise.resolve('renewed' as const)
  }
  release(p: number, memberId: string) {
    this.calls.push(`release ${p}`)
    if (this.ownerOf(p) === memberId) this.leases.delete(p)
    return Promise.resolve()
  }
  notify() {
    this.calls.push('notify')
    return Promise.resolve()
  }
  onNotify(cb: () => void) {
    this.listeners.push(cb)
    return Promise.resolve()
  }
  ownerOf(p: number): string | null {
    const lease = this.leases.get(p)
    return lease && lease.until > this.clock.now ? lease.owner : null
  }
}

type FakeConsumer = {
  partition: number
  drain: jest.Mock<Promise<void>, []>
  onLost: (cb: () => void) => void
  lose: () => void
}

/** Partition nào đang có consumer chạy, của member nào — để bắt hai chủ. */
const active = new Map<number, string[]>()

function consumerFactory(memberId: string, store: FakeLeaseStore) {
  const consumers = new Map<number, FakeConsumer>()
  const start = jest.fn((p: number) => {
    let lost: () => void = () => undefined
    const consumer: FakeConsumer = {
      partition: p,
      drain: jest.fn(() => {
        store.calls.push(`drain ${p}`)
        active.set(
          p,
          (active.get(p) ?? []).filter((m) => m !== memberId),
        )
        return Promise.resolve()
      }),
      onLost: (cb) => (lost = cb),
      lose: () => {
        active.set(
          p,
          (active.get(p) ?? []).filter((m) => m !== memberId),
        )
        lost()
      },
    }
    active.set(p, [...(active.get(p) ?? []), memberId])
    consumers.set(p, consumer)
    return Promise.resolve(consumer)
  })
  return { start, consumers }
}

const OPTIONS = (clock: { now: number }): CoordinatorOptions => ({
  tickMs: 2000,
  memberTtlMs: 6000,
  leaseTtlMs: 6000,
  settleMs: 3000,
  now: () => clock.now,
})

function member(id: string, store: FakeLeaseStore) {
  const factory = consumerFactory(id, store)
  const coordinator = new PartitionCoordinator(
    store,
    factory.start,
    id,
    OPTIONS(store.clock),
  )
  return { coordinator, ...factory }
}

/** Mọi task bất đồng bộ (drain → release → notify) chạy xong. */
const settle = () => new Promise((r) => setImmediate(r))

function expectSingleOwners() {
  for (const [p, members] of active) {
    expect({ p, owners: members.length <= 1 }).toEqual({ p, owners: true })
  }
}

describe('PartitionCoordinator', () => {
  let clock: { now: number }
  let store: FakeLeaseStore

  beforeEach(() => {
    active.clear()
    clock = { now: 100_000 }
    store = new FakeLeaseStore(clock)
  })

  it('does nothing before the settle period', async () => {
    const a = member('A', store)
    clock.now += 2999
    await a.coordinator.tick()
    expect(store.calls).toEqual([])
    expect(a.start).not.toHaveBeenCalled()
  })

  it('claims all 16 partitions when it is the only member', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()
    expect(a.coordinator.ownedPartitions()).toEqual(
      Array.from({ length: 16 }, (_, p) => p),
    )
    expect(store.calls).toContain('notify')
  })

  it('hands partitions to a new member and only those', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()

    const b = member('B', store)
    clock.now += 3000
    for (let round = 0; round < 3; round++) {
      await b.coordinator.tick()
      expectSingleOwners()
      await a.coordinator.tick()
      await settle()
      expectSingleOwners()
    }
    await b.coordinator.tick()

    expect(a.coordinator.ownedPartitions()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(b.coordinator.ownedPartitions()).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15,
    ])
    expectSingleOwners()
  })

  it('does not subscribe until the previous owner released', async () => {
    const b = member('B', store)
    store.leases.set(9, { owner: 'A', until: clock.now + 60_000 })
    store.members.set('A', clock.now + 60_000)
    clock.now += 3000

    await b.coordinator.tick()

    expect(b.start).not.toHaveBeenCalledWith(9)
  })

  it('drains before releasing', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()
    store.members.set('B', clock.now)
    store.calls = []

    await a.coordinator.tick()
    await settle()

    const p = 15
    const order = store.calls.filter((c) =>
      [`drain ${p}`, `release ${p}`].includes(c),
    )
    expect(order).toEqual([`drain ${p}`, `release ${p}`])
    expect(store.calls.lastIndexOf('notify')).toBeGreaterThan(
      store.calls.indexOf(`release ${p}`),
    )
  })

  it('runs another tick when notified during a tick', async () => {
    const a = member('A', store)
    clock.now += 3000
    let unblock!: () => void
    const blocked = new Promise<void>((r) => (unblock = r))
    const heartbeat = (id: string, ttl: number) =>
      FakeLeaseStore.prototype.heartbeat.call(store, id, ttl) as Promise<
        string[]
      >
    let calls = 0
    store.heartbeat = async (id: string, ttl: number) => {
      calls++
      if (calls === 1) await blocked
      return heartbeat(id, ttl)
    }

    const first = a.coordinator.tick()
    void a.coordinator.tick()
    void a.coordinator.tick()
    unblock()
    await first

    expect(calls).toBe(2)
  })

  it('releases a partition when renew returns lost', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()
    store.leases.set(4, { owner: 'Z', until: clock.now + 60_000 })

    await a.coordinator.tick()
    await settle()

    expect(a.consumers.get(4)!.drain).toHaveBeenCalled()
    expect(a.coordinator.ownedPartitions()).not.toContain(4)
  })

  it('keeps its partitions when redis is unreachable', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()
    store.renew = () => Promise.reject(new Error('ECONNREFUSED'))
    store.heartbeat = () => Promise.reject(new Error('ECONNREFUSED'))

    await a.coordinator.tick()
    await settle()

    expect(a.coordinator.ownedPartitions()).toHaveLength(16)
    expect(
      [...a.consumers.values()].every((c) => !c.drain.mock.calls.length),
    ).toBe(true)
  })

  it("takes over a crashed member's partitions after its ttl", async () => {
    const a = member('A', store)
    const b = member('B', store)
    clock.now += 3000
    await a.coordinator.tick()
    await b.coordinator.tick()
    await a.coordinator.tick()
    await settle()
    await b.coordinator.tick()
    expect(b.coordinator.ownedPartitions()).toHaveLength(8)

    // B chết: không tick nữa, lease và heartbeat của nó hết hạn.
    clock.now += 6001
    await a.coordinator.tick()

    expect(a.coordinator.ownedPartitions()).toHaveLength(16)
  })

  it('drops a partition whose channel was lost and reclaims it on the next tick', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()

    a.consumers.get(6)!.lose()
    await settle()
    expect(a.coordinator.ownedPartitions()).not.toContain(6)

    await a.coordinator.tick()
    expect(a.coordinator.ownedPartitions()).toContain(6)
    expect(a.start).toHaveBeenCalledTimes(17)
  })

  it('shutdown leaves, notifies, drains every partition and releases them', async () => {
    const a = member('A', store)
    clock.now += 3000
    await a.coordinator.tick()
    store.calls = []

    await a.coordinator.shutdown()

    expect(store.calls[0]).toBe('leave A')
    expect(store.calls[1]).toBe('notify')
    for (let p = 0; p < 16; p++) {
      expect(store.calls).toContain(`drain ${p}`)
      expect(store.ownerOf(p)).toBeNull()
    }
    expect(a.coordinator.ownedPartitions()).toEqual([])
  })
})
