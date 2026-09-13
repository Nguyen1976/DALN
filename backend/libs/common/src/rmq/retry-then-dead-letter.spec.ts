import type { Channel, ConsumeMessage } from 'amqplib'
import { NonRetryableError } from './non-retryable.error'
import {
  ORIGINAL_ROUTING_KEY_HEADER,
  resolveMaxRetries,
  RETRY_COUNT_HEADER,
  retryThenDeadLetter,
} from './retry-then-dead-letter'

const QUEUE = 'chat_queue_send_message'

const makeMsg = (headers: Record<string, unknown> = {}): ConsumeMessage =>
  ({
    content: Buffer.from(JSON.stringify({ conversationId: 'c1' })),
    fields: {
      deliveryTag: 7,
      redelivered: false,
      exchange: 'realtime.events',
      routingKey: 'realtime.sendMessage',
      consumerTag: 'ctag',
    },
    properties: {
      headers: { 'x-event-version': 1, ...headers },
      messageId: 'm-1',
      deliveryMode: 2,
      contentType: undefined,
      contentEncoding: undefined,
      priority: undefined,
      correlationId: undefined,
      replyTo: undefined,
      expiration: undefined,
      timestamp: undefined,
      type: undefined,
      userId: undefined,
      appId: undefined,
      clusterId: undefined,
    },
  }) as ConsumeMessage

type ConfirmCallback = (err: unknown) => void

/** ConfirmChannel giả: broker confirm ngay (callback nhận null). */
const makeChannel = () => ({
  publish: jest.fn(
    (
      _exchange: string,
      _routingKey: string,
      _content: Buffer,
      _options: unknown,
      cb?: ConfirmCallback,
    ) => {
      cb?.(null)
      return true
    },
  ),
  ack: jest.fn(),
  nack: jest.fn(),
  waitForConfirms: jest.fn(),
})

const asChannel = (channel: object) => channel as unknown as Channel

const makeHandler = (maxRetries = 3) => {
  const logger = { warn: jest.fn(), error: jest.fn() }
  const handler = retryThenDeadLetter({ queue: QUEUE, maxRetries, logger })
  return { handler, logger }
}

describe('retryThenDeadLetter', () => {
  afterEach(() => {
    delete process.env.RMQ_MAX_RETRIES
    jest.useRealTimers()
  })

  it('dưới ngưỡng -> republish vào đúng queue qua default exchange, tăng x-retry-count', async () => {
    const { handler } = makeHandler()
    const channel = makeChannel()
    const msg = makeMsg({ [RETRY_COUNT_HEADER]: 1 })

    await handler(asChannel(channel), msg, new Error('db timeout'))

    expect(channel.publish).toHaveBeenCalledTimes(1)
    const [exchange, routingKey, content, options] =
      channel.publish.mock.calls[0]
    expect(exchange).toBe('')
    expect(routingKey).toBe(QUEUE)
    expect(content).toBe(msg.content)
    expect(options).toMatchObject({
      messageId: 'm-1',
      deliveryMode: 2,
      headers: {
        'x-event-version': 1,
        [RETRY_COUNT_HEADER]: 2,
        [ORIGINAL_ROUTING_KEY_HEADER]: 'realtime.sendMessage',
      },
    })
    expect(channel.nack).not.toHaveBeenCalled()
  })

  it('message chưa có header -> bản retry đầu tiên mang x-retry-count=1', async () => {
    const { handler } = makeHandler()
    const channel = makeChannel()

    await handler(asChannel(channel), makeMsg(), new Error('boom'))

    expect(channel.publish.mock.calls[0][3]).toMatchObject({
      headers: { [RETRY_COUNT_HEADER]: 1 },
    })
  })

  it('ack bản gốc SAU khi broker confirm bản republish', async () => {
    const { handler } = makeHandler()
    let confirm: ConfirmCallback | undefined
    const channel = makeChannel()
    channel.publish.mockImplementation((_e, _r, _c, _o, cb) => {
      confirm = cb
      return true
    })
    const msg = makeMsg()

    const done = handler(asChannel(channel), msg, new Error('boom'))
    await Promise.resolve()
    expect(channel.ack).not.toHaveBeenCalled()

    confirm?.(null)
    await done

    expect(channel.ack).toHaveBeenCalledWith(msg)
    expect(channel.nack).not.toHaveBeenCalled()
  })

  it('chạm ngưỡng -> nack không requeue (dead-letter), không republish', async () => {
    const { handler, logger } = makeHandler(3)
    const channel = makeChannel()
    const msg = makeMsg({ [RETRY_COUNT_HEADER]: 3 })

    await handler(asChannel(channel), msg, new Error('still failing'))

    expect(channel.publish).not.toHaveBeenCalled()
    expect(channel.ack).not.toHaveBeenCalled()
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /queue=chat_queue_send_message routingKey=realtime\.sendMessage messageId=m-1.*still failing/,
      ),
      expect.any(String),
    )
  })

  it('NonRetryableError -> dead-letter ngay từ lần đầu', async () => {
    const { handler } = makeHandler()
    const channel = makeChannel()
    const msg = makeMsg()

    await handler(
      asChannel(channel),
      msg,
      new NonRetryableError('version 2 chưa hỗ trợ'),
    )

    expect(channel.publish).not.toHaveBeenCalled()
    expect(channel.ack).not.toHaveBeenCalled()
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false)
  })

  it('broker nack bản republish -> dead-letter bản gốc, không ack', async () => {
    const { handler } = makeHandler()
    const channel = makeChannel()
    channel.publish.mockImplementation((_e, _r, _c, _o, cb) => {
      cb?.(new Error('nacked'))
      return true
    })
    const msg = makeMsg()

    await handler(asChannel(channel), msg, new Error('boom'))

    expect(channel.ack).not.toHaveBeenCalled()
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false)
  })

  it('broker không confirm -> hết timeout thì dead-letter, không treo', async () => {
    jest.useFakeTimers()
    const { handler } = makeHandler()
    const channel = makeChannel()
    channel.publish.mockImplementation(() => true)
    const msg = makeMsg()

    const done = handler(asChannel(channel), msg, new Error('boom'))
    await jest.advanceTimersByTimeAsync(10_000)
    await done

    expect(channel.ack).not.toHaveBeenCalled()
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false)
  })

  it('channel không phải ConfirmChannel -> publish rồi ack ngay', async () => {
    const { handler } = makeHandler()
    const channel = {
      publish: jest.fn().mockReturnValue(true),
      ack: jest.fn(),
      nack: jest.fn(),
    }
    const msg = makeMsg()

    await handler(asChannel(channel), msg, new Error('boom'))

    expect(channel.publish).toHaveBeenCalledWith(
      '',
      QUEUE,
      msg.content,
      expect.any(Object),
    )
    expect(channel.ack).toHaveBeenCalledWith(msg)
  })

  it('không bao giờ ném lỗi kể cả khi channel ném ở publish lẫn nack', async () => {
    const { handler } = makeHandler()
    const channel = {
      publish: jest.fn(() => {
        throw new Error('Channel closed')
      }),
      ack: jest.fn(),
      nack: jest.fn(() => {
        throw new Error('Channel closed')
      }),
      waitForConfirms: jest.fn(),
    }

    await expect(
      handler(asChannel(channel), makeMsg(), new Error('boom')),
    ).resolves.toBeUndefined()
    expect(channel.ack).not.toHaveBeenCalled()
  })

  it('không ném lỗi khi ack ném sau republish thành công', async () => {
    const { handler } = makeHandler()
    const channel = makeChannel()
    channel.ack.mockImplementation(() => {
      throw new Error('Channel closed')
    })

    await expect(
      handler(asChannel(channel), makeMsg(), new Error('boom')),
    ).resolves.toBeUndefined()
  })

  it('maxRetries mặc định đọc RMQ_MAX_RETRIES lúc xảy ra lỗi', async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }
    const handler = retryThenDeadLetter({ queue: QUEUE, logger })
    const channel = makeChannel()
    const msg = makeMsg({ [RETRY_COUNT_HEADER]: 1 })

    process.env.RMQ_MAX_RETRIES = '1'
    await handler(asChannel(channel), msg, new Error('boom'))

    expect(channel.publish).not.toHaveBeenCalled()
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false)
  })
})

describe('resolveMaxRetries', () => {
  afterEach(() => {
    delete process.env.RMQ_MAX_RETRIES
  })

  it('mặc định 3, đọc env, giá trị truyền vào thắng env', () => {
    expect(resolveMaxRetries()).toBe(3)
    process.env.RMQ_MAX_RETRIES = '5'
    expect(resolveMaxRetries()).toBe(5)
    expect(resolveMaxRetries(0)).toBe(0)
  })

  it('env rỗng hoặc rác -> 3', () => {
    process.env.RMQ_MAX_RETRIES = ''
    expect(resolveMaxRetries()).toBe(3)
    process.env.RMQ_MAX_RETRIES = 'abc'
    expect(resolveMaxRetries()).toBe(3)
    process.env.RMQ_MAX_RETRIES = '-2'
    expect(resolveMaxRetries()).toBe(3)
  })
})
