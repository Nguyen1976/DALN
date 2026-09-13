import 'reflect-metadata'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { Logger } from '@nestjs/common'
import {
  RABBIT_HANDLER,
  type RabbitHandlerConfig,
} from '@golevelup/nestjs-rabbitmq'
import type { Channel, ConsumeMessage } from 'amqplib'
import { RabbitSubscribeWithRetry } from './rabbit-subscribe-with-retry.decorator'
import { RETRY_COUNT_HEADER } from './retry-then-dead-letter'

class DemoSubscriber {
  @RabbitSubscribeWithRetry({
    exchange: 'demo.events',
    routingKey: 'demo.created',
    queue: 'demo_queue',
    maxRetries: 1,
  })
  async handle(this: void): Promise<void> {}
}

describe('RabbitSubscribeWithRetry', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  const meta = () =>
    Reflect.getMetadata(
      RABBIT_HANDLER,
      DemoSubscriber.prototype.handle,
    ) as RabbitHandlerConfig

  it('đăng ký handler subscribe của golevelup kèm errorHandler', () => {
    expect(meta()).toMatchObject({
      type: 'subscribe',
      exchange: 'demo.events',
      routingKey: 'demo.created',
      queue: 'demo_queue',
    })
    expect(typeof meta().errorHandler).toBe('function')
    // maxRetries là option riêng của wrapper, không lọt vào config golevelup.
    expect(meta()).not.toHaveProperty('maxRetries')
  })

  it('errorHandler gắn đúng queue và maxRetries của decorator', async () => {
    const channel = {
      publish: jest.fn(
        (
          _exchange: string,
          _routingKey: string,
          _content: Buffer,
          _options: unknown,
          cb?: (err: unknown) => void,
        ) => {
          cb?.(null)
          return true
        },
      ),
      ack: jest.fn(),
      nack: jest.fn(),
      waitForConfirms: jest.fn(),
    }
    const headers: Record<string, unknown> = {}
    const msg = {
      content: Buffer.from('{}'),
      fields: { routingKey: 'demo.created' },
      properties: { headers },
    } as unknown as ConsumeMessage
    const errorHandler = meta().errorHandler!

    await errorHandler(channel as unknown as Channel, msg, new Error('boom'))
    const [exchange, routingKey, content, options] =
      channel.publish.mock.calls[0]
    expect([exchange, routingKey, content]).toEqual([
      '',
      'demo_queue',
      msg.content,
    ])
    expect(
      (options as { headers: Record<string, unknown> }).headers,
    ).toMatchObject({ [RETRY_COUNT_HEADER]: 1 })

    // maxRetries: 1 -> lần lỗi kế tiếp là dead-letter.
    headers[RETRY_COUNT_HEADER] = 1
    await errorHandler(channel as unknown as Channel, msg, new Error('boom'))
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false)
  })
})

/**
 * Quét mã nguồn apps/: mặc định của golevelup là REQUEUE, nên chỉ một
 * `@RabbitSubscribe` trần là đủ để tái hiện vòng lặp vô hạn của sự cố
 * 2026-09-12. Test này chặn chuyện đó từ lúc review.
 */
describe('RabbitMQ wiring trong apps/', () => {
  const BACKEND = join(__dirname, '..', '..', '..', '..')
  const APPS = join(BACKEND, 'apps')

  const listTs = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        return ['node_modules', 'generated', 'dist'].includes(entry.name)
          ? []
          : listTs(full)
      }
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [full]
        : []
    })

  const sources = [
    ...listTs(APPS),
    ...listTs(join(BACKEND, 'libs', 'saga')),
  ].map((file) => ({
    file: relative(BACKEND, file).split(sep).join('/'),
    src: readFileSync(file, 'utf8'),
  }))

  const APPS_WITH_SUBSCRIBERS = [
    'chat',
    'notification',
    'realtime-gateway',
    'recommendation',
    'saga-orchestrator',
    'user',
  ]

  it('không còn @RabbitSubscribe trần', () => {
    const offenders = sources
      .filter(({ src }) => /@RabbitSubscribe\s*\(/.test(src))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it.each(APPS_WITH_SUBSCRIBERS)('%s dùng @RabbitSubscribeWithRetry', (app) => {
    const count = sources
      .filter(({ file }) => file.startsWith(`apps/${app}/`))
      .reduce(
        (n, { src }) =>
          n + (src.match(/@RabbitSubscribeWithRetry\s*\(/g)?.length ?? 0),
        0,
      )
    expect(count).toBeGreaterThan(0)
  })

  it('mọi RabbitMQModule.forRoot đặt defaultSubscribeErrorBehavior = NACK', () => {
    const modules = sources.filter(({ src }) =>
      /RabbitMQModule\.forRoot(Async)?\s*\(/.test(src),
    )
    expect(modules.length).toBeGreaterThanOrEqual(6)

    const missing = modules
      .filter(
        ({ src }) =>
          !/defaultSubscribeErrorBehavior:\s*MessageHandlerErrorBehavior\.NACK/.test(
            src,
          ),
      )
      .map(({ file }) => file)
    expect(missing).toEqual([])
  })

  it('không còn publish trực tiếp — mọi event đi qua publishEvent (có header version)', () => {
    const offenders = sources
      .filter(({ src }) => /\bamqp(Connection)?\.publish\s*\(/.test(src))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })
})
