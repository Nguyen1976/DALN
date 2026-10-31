import type { ConsumeMessage } from 'amqplib'
import { PartitionConsumer } from './partition-consumer'

/** Channel giả: giữ callback consume, ghi lại ack/nack/close. */
class FakeChannel {
  deliver?: (msg: ConsumeMessage | null) => void
  readonly log: string[] = []
  private readonly listeners: Record<string, (() => void)[]> = {}
  prefetchCount?: number
  queue?: string

  prefetch(n: number) {
    this.prefetchCount = n
    return Promise.resolve()
  }
  consume(queue: string, cb: (msg: ConsumeMessage | null) => void) {
    this.queue = queue
    this.deliver = cb
    return Promise.resolve({ consumerTag: 't1' })
  }
  ack(msg: ConsumeMessage) {
    this.log.push(`ack ${msg.content.toString()}`)
  }
  nack(msg: ConsumeMessage, _all: boolean, requeue: boolean) {
    this.log.push(`nack ${msg.content.toString()} requeue=${requeue}`)
  }
  close() {
    this.log.push('close')
    this.emit('close')
    return Promise.resolve()
  }
  on(event: string, cb: () => void) {
    ;(this.listeners[event] ??= []).push(cb)
    return this
  }
  emit(event: string) {
    for (const cb of this.listeners[event] ?? []) cb()
  }
}

const msg = (body: unknown) =>
  ({ content: Buffer.from(JSON.stringify(body)) }) as ConsumeMessage

const flush = () => new Promise((r) => setImmediate(r))

async function start(handler: jest.Mock) {
  const channel = new FakeChannel()
  const consumer = await PartitionConsumer.start(
    { createChannel: () => Promise.resolve(channel as never) },
    5,
    handler,
    100,
  )
  return { channel, consumer }
}

describe('PartitionConsumer', () => {
  it('sets prefetch before consuming its partition queue', async () => {
    const { channel } = await start(jest.fn())
    expect(channel.prefetchCount).toBe(100)
    expect(channel.queue).toBe('chat.send.p5')
  })

  it('acks after the handler returns ack', async () => {
    const { channel } = await start(jest.fn().mockResolvedValue('ack'))
    channel.deliver!(msg({ n: 1 }))
    await flush()
    expect(channel.log).toEqual(['ack {"n":1}'])
  })

  it('nacks without requeue on dead-letter', async () => {
    const { channel } = await start(jest.fn().mockResolvedValue('dead-letter'))
    channel.deliver!(msg({ n: 1 }))
    await flush()
    expect(channel.log).toEqual(['nack {"n":1} requeue=false'])
  })

  it('holds deliveries that arrive while draining and closes without acking them', async () => {
    let finish!: () => void
    const handler = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((r) => (finish = () => r('ack'))),
      )
      .mockResolvedValue('ack')
    const { channel, consumer } = await start(handler)

    channel.deliver!(msg({ n: 1 }))
    const drained = consumer.drain()
    channel.deliver!(msg({ n: 2 }))
    channel.deliver!(msg({ n: 3 }))
    await flush()
    expect(channel.log).toEqual([])

    finish()
    await drained

    expect(handler).toHaveBeenCalledTimes(1)
    expect(channel.log).toEqual(['ack {"n":1}', 'close'])
  })

  it('drain is idempotent', async () => {
    const { channel, consumer } = await start(jest.fn())
    await Promise.all([consumer.drain(), consumer.drain()])
    expect(channel.log).toEqual(['close'])
  })

  it('reports loss when the channel closes on its own, not when drained', async () => {
    const lost = jest.fn()
    const { channel, consumer } = await start(jest.fn())
    consumer.onLost(lost)

    channel.emit('close')
    expect(lost).toHaveBeenCalledTimes(1)

    const other = await start(jest.fn())
    const lostOther = jest.fn()
    other.consumer.onLost(lostOther)
    await other.consumer.drain()
    expect(lostOther).not.toHaveBeenCalled()
  })

  it('dead-letters a delivery that is not JSON', async () => {
    const handler = jest.fn()
    const { channel } = await start(handler)
    channel.deliver!({ content: Buffer.from('not json') } as ConsumeMessage)
    await flush()
    expect(handler).not.toHaveBeenCalled()
    expect(channel.log).toEqual(['nack not json requeue=false'])
  })
})
