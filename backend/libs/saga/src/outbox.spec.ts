import { Logger } from '@nestjs/common'
import { EVENT_TYPE_HEADER, EVENT_VERSION_HEADER } from '@app/common/rmq'
import { OutboxRelay } from './outbox'
import type { OutboxRecord } from './types'

const record = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 'o1',
  messageId: 'msg-1',
  exchange: 'saga.events',
  routingKey: 'saga.friendship.reply',
  payload: { messageId: 'msg-1', status: 'OK' },
  status: 'NEW',
  attempt: 0,
  maxAttempts: 10,
  nextAttemptAt: null,
  ...over,
})

function setup(records: OutboxRecord[]) {
  const prisma = {
    outboxEvent: {
      findMany: jest.fn().mockResolvedValue(records),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
    },
  }
  const amqp = { publish: jest.fn().mockResolvedValue(true) }
  const relay = new OutboxRelay(prisma, amqp, { name: 'TestOutboxRelay' })

  const publishCall = () => amqp.publish.mock.calls[0] as unknown[]
  const updateArgs = () =>
    (prisma.outboxEvent.update.mock.calls[0] as unknown[])[0] as {
      where: unknown
      data: Record<string, unknown>
    }

  return { amqp, relay, publishCall, updateArgs }
}

describe('OutboxRelay', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('publish kèm x-event-version=1 + messageId của outbox, body giữ nguyên, rồi đánh dấu PUBLISHED', async () => {
    const { relay, publishCall, updateArgs } = setup([record()])

    await relay.tick()

    expect(publishCall()).toEqual([
      'saga.events',
      'saga.friendship.reply',
      { messageId: 'msg-1', status: 'OK' },
      {
        persistent: true,
        messageId: 'msg-1',
        headers: {
          [EVENT_VERSION_HEADER]: 1,
          [EVENT_TYPE_HEADER]: 'saga.friendship.reply',
        },
      },
    ])
    expect(updateArgs().where).toEqual({ id: 'o1' })
    expect(updateArgs().data.status).toBe('PUBLISHED')
  })

  it('bản ghi mang version -> header mang đúng version đó', async () => {
    const { relay, publishCall } = setup([record({ version: 2 })])

    await relay.tick()

    expect(publishCall()[3]).toMatchObject({
      headers: { [EVENT_VERSION_HEADER]: 2 },
    })
  })

  it('publish lỗi -> FAILED + hẹn lần sau (hành vi cũ giữ nguyên)', async () => {
    const { amqp, relay, updateArgs } = setup([record()])
    amqp.publish.mockRejectedValue(new Error('channel closed'))

    await relay.tick()

    expect(updateArgs().where).toEqual({ id: 'o1' })
    expect(updateArgs().data).toMatchObject({
      status: 'FAILED',
      attempt: 1,
      error: 'channel closed',
    })
  })
})
