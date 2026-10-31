import { ObjectId } from 'mongodb'
import {
  PARTITION_COUNT,
  partitionOf,
  partitionQueue,
  partitionRoutingKey,
} from './partition'

describe('partitionOf', () => {
  it('matches FNV-1a 32-bit', () => {
    expect(partitionOf('a')).toBe(0xe40c292c % 16)
    expect(partitionOf('')).toBe(0x811c9dc5 % 16)
  })

  it('is stable and in range', () => {
    const id = '6a3500000000000000000001'
    expect(partitionOf(id)).toBe(partitionOf(id))
    for (let i = 0; i < 1000; i++) {
      const p = partitionOf(new ObjectId().toHexString())
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(PARTITION_COUNT)
    }
  })

  it('spreads ObjectIds over every partition', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++)
      seen.add(partitionOf(new ObjectId().toHexString()))
    expect(seen.size).toBe(PARTITION_COUNT)
  })
})

describe('partition names', () => {
  it('names queues and routing keys by partition', () => {
    expect(PARTITION_COUNT).toBe(16)
    expect(partitionQueue(7)).toBe('chat.send.p7')
    expect(partitionRoutingKey(7)).toBe('send.p7')
  })
})
