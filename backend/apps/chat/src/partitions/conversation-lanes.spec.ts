import { ConversationLanes } from './conversation-lanes'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('ConversationLanes', () => {
  it('runs tasks of one key in submission order even when the first is slower', async () => {
    const lanes = new ConversationLanes()
    const done: string[] = []

    await Promise.all([
      lanes.run('c1', async () => {
        await sleep(30)
        done.push('A')
      }),
      lanes.run('c1', async () => {
        await sleep(1)
        done.push('B')
      }),
    ])

    expect(done).toEqual(['A', 'B'])
  })

  it('runs different keys concurrently', async () => {
    const lanes = new ConversationLanes()
    const started = Date.now()

    await Promise.all([
      lanes.run('c1', () => sleep(30)),
      lanes.run('c2', () => sleep(30)),
    ])

    expect(Date.now() - started).toBeLessThan(50)
  })

  it('a failed task does not block the next one on the same key', async () => {
    const lanes = new ConversationLanes()

    const first = lanes.run('c1', () => Promise.reject(new Error('boom')))
    const second = lanes.run('c1', () => Promise.resolve('ok'))

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
  })

  it('forgets idle keys', async () => {
    const lanes = new ConversationLanes()

    await lanes.run('c1', () => Promise.resolve())
    await lanes.run('c2', () => Promise.resolve())

    expect(lanes.size).toBe(0)
  })
})
