import { assertSendTopology } from './send-topology'

describe('assertSendTopology', () => {
  it('asserts one exchange and 16 single-active-consumer queues', async () => {
    const calls: unknown[][] = []
    const channel = {
      assertExchange: jest.fn((...args: unknown[]) => {
        calls.push(['exchange', ...args])
        return Promise.resolve({})
      }),
      assertQueue: jest.fn((...args: unknown[]) => {
        calls.push(['queue', ...args])
        return Promise.resolve({})
      }),
      bindQueue: jest.fn((...args: unknown[]) => {
        calls.push(['bind', ...args])
        return Promise.resolve({})
      }),
    }

    await assertSendTopology(channel as never)

    expect(channel.assertExchange).toHaveBeenCalledWith('chat.send', 'direct', {
      durable: true,
    })
    expect(channel.assertQueue).toHaveBeenCalledTimes(16)
    expect(channel.assertQueue).toHaveBeenCalledWith('chat.send.p0', {
      durable: true,
      arguments: { 'x-single-active-consumer': true },
    })
    expect(channel.bindQueue).toHaveBeenCalledTimes(16)
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'chat.send.p15',
      'chat.send',
      'send.p15',
    )
    // Exchange trước, queue trước binding của chính nó.
    expect(calls[0][0]).toBe('exchange')
  })
})
