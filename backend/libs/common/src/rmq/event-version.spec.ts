import {
  assertSupportedVersion,
  EVENT_TYPE_HEADER,
  EVENT_VERSION_HEADER,
  publishEvent,
  readEventVersion,
  type AmqpPublisher,
} from './event-version'
import { NonRetryableError } from './non-retryable.error'

type PublishArgs = Parameters<AmqpPublisher['publish']>

const msgWith = (headers?: Record<string, unknown>) => ({
  properties: { headers },
})

const makeAmqp = () => {
  const publish = jest.fn().mockResolvedValue(true)
  const call = (i = 0) => publish.mock.calls[i] as PublishArgs
  return { amqp: { publish }, call }
}

describe('publishEvent', () => {
  it('gắn x-event-version=1, x-event-type, persistent và giữ nguyên body', async () => {
    const { amqp, call } = makeAmqp()
    const payload = { userId: 'u1' }

    await expect(
      publishEvent(amqp, 'user.events', 'user.created', payload),
    ).resolves.toBe(true)

    const [exchange, routingKey, body, options] = call()
    expect(exchange).toBe('user.events')
    expect(routingKey).toBe('user.created')
    // Body gửi đi chính là object gốc — không bọc { version, data }.
    expect(body).toBe(payload)
    expect(options).toMatchObject({
      persistent: true,
      headers: {
        [EVENT_VERSION_HEADER]: 1,
        [EVENT_TYPE_HEADER]: 'user.created',
      },
    })
    expect(typeof options?.messageId).toBe('string')
  })

  it('dùng version và messageId được truyền vào', async () => {
    const { amqp, call } = makeAmqp()

    await publishEvent(amqp, 'ex', 'rk', {}, { version: 2, messageId: 'm-1' })

    expect(call()[3]).toMatchObject({
      messageId: 'm-1',
      headers: { [EVENT_VERSION_HEADER]: 2 },
    })
  })

  it('mỗi lần publish sinh messageId khác nhau', async () => {
    const { amqp, call } = makeAmqp()

    await publishEvent(amqp, 'ex', 'rk', {})
    await publishEvent(amqp, 'ex', 'rk', {})

    expect(call(0)[3]?.messageId).not.toBe(call(1)[3]?.messageId)
  })

  it('không nuốt lỗi publish — trả về đúng promise của amqp', async () => {
    const amqp = { publish: jest.fn(() => Promise.reject(new Error('closed'))) }

    await expect(publishEvent(amqp, 'ex', 'rk', {})).rejects.toThrow('closed')
  })
})

describe('readEventVersion', () => {
  it('message cũ không có header -> 1', () => {
    expect(readEventVersion(msgWith(undefined))).toBe(1)
    expect(readEventVersion(msgWith({}))).toBe(1)
    expect(readEventVersion({ properties: { headers: null } })).toBe(1)
    expect(readEventVersion(undefined)).toBe(1)
  })

  it('đọc được version dạng số, chuỗi và Buffer', () => {
    expect(readEventVersion(msgWith({ [EVENT_VERSION_HEADER]: 2 }))).toBe(2)
    expect(readEventVersion(msgWith({ [EVENT_VERSION_HEADER]: '3' }))).toBe(3)
    expect(
      readEventVersion(msgWith({ [EVENT_VERSION_HEADER]: Buffer.from('4') })),
    ).toBe(4)
  })

  it('header rác -> NonRetryableError', () => {
    for (const bad of ['abc', 0, -1, 1.5, { v: 1 }]) {
      expect(() =>
        readEventVersion(msgWith({ [EVENT_VERSION_HEADER]: bad })),
      ).toThrow(NonRetryableError)
    }
  })
})

describe('assertSupportedVersion', () => {
  it('version được hỗ trợ -> trả về version', () => {
    expect(
      assertSupportedVersion(msgWith({ [EVENT_VERSION_HEADER]: 2 }), [1, 2]),
    ).toBe(2)
  })

  it('message không header được coi là v1', () => {
    expect(assertSupportedVersion(msgWith({}), [1])).toBe(1)
  })

  it('version mới hơn consumer hiểu -> NonRetryableError nêu rõ event', () => {
    expect(() =>
      assertSupportedVersion(
        msgWith({ [EVENT_VERSION_HEADER]: 2, [EVENT_TYPE_HEADER]: 'saga.x' }),
        [1],
      ),
    ).toThrow(
      new NonRetryableError(
        'Event saga.x version 2 chưa được hỗ trợ (hỗ trợ: 1)',
      ),
    )
  })
})
