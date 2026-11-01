import { HttpException } from '@nestjs/common'
import type { MessageSendPayload } from 'libs/constant/rmq/payload'
import { ConversationLanes } from './conversation-lanes'
import { SendMessageHandler } from './send-message.handler'

const payload = (n: number, conversationId = 'c1'): MessageSendPayload => ({
  conversationId,
  senderId: 'u1',
  content: `m${n}`,
  clientMessageId: `tmp-${n}`,
})

function makeHandler(sendMessage: jest.Mock) {
  const events = { publishMessageError: jest.fn() }
  const handler = new SendMessageHandler(
    { sendMessage } as never,
    events as never,
    new ConversationLanes(),
  )
  return { handler, events }
}

describe('SendMessageHandler', () => {
  afterEach(() => jest.useRealTimers())

  it('acks after sendMessage resolves', async () => {
    const sendMessage = jest.fn().mockResolvedValue({})
    const { handler } = makeHandler(sendMessage)

    await expect(handler.handle(payload(1))).resolves.toBe('ack')
    expect(sendMessage).toHaveBeenCalledWith(payload(1), expect.any(Function))
  })

  it('retries in place with 50/200/800ms then dead-letters', async () => {
    jest.useFakeTimers()
    const sendMessage = jest.fn().mockRejectedValue(new Error('write conflict'))
    const { handler, events } = makeHandler(sendMessage)

    const result = handler.handle(payload(1))
    await jest.advanceTimersByTimeAsync(49)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(200)
    expect(sendMessage).toHaveBeenCalledTimes(3)
    await jest.advanceTimersByTimeAsync(800)

    await expect(result).resolves.toBe('dead-letter')
    expect(sendMessage).toHaveBeenCalledTimes(4)
    expect(events.publishMessageError).toHaveBeenCalledTimes(1)
    expect(events.publishMessageError).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        clientMessageId: 'tmp-1',
        conversationId: 'c1',
        retryable: true,
      }),
    )
  })

  it('acks without retry on a 4xx HttpException and reports the error', async () => {
    const sendMessage = jest
      .fn()
      .mockRejectedValue(new HttpException('not a member', 403))
    const { handler, events } = makeHandler(sendMessage)

    await expect(handler.handle(payload(1))).resolves.toBe('ack')
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(events.publishMessageError).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ message: 'not a member' }),
    )
  })

  it('keeps conversation order across a retried message', async () => {
    jest.useFakeTimers()
    const saved: string[] = []
    let failedOnce = false
    const sendMessage = jest.fn((p: MessageSendPayload) => {
      if (p.clientMessageId === 'tmp-1' && !failedOnce) {
        failedOnce = true
        return Promise.reject(new Error('write conflict'))
      }
      saved.push(p.clientMessageId)
      return Promise.resolve({})
    })
    const { handler } = makeHandler(sendMessage)

    const both = Promise.all([
      handler.handle(payload(1)),
      handler.handle(payload(2)),
    ])
    await jest.advanceTimersByTimeAsync(50)

    await expect(both).resolves.toEqual(['ack', 'ack'])
    expect(saved).toEqual(['tmp-1', 'tmp-2'])
  })

  it('releases the conversation lane once the message is queued, before it is written', async () => {
    let finishFirst!: () => void
    const sendMessage = jest.fn(
      (p: MessageSendPayload, onQueued: () => void) => {
        onQueued()
        if (p.clientMessageId !== 'tmp-1') return Promise.resolve({})
        return new Promise((resolve) => (finishFirst = () => resolve({})))
      },
    )
    const { handler } = makeHandler(sendMessage)

    const first = handler.handle(payload(1))
    const second = handler.handle(payload(2))

    await expect(second).resolves.toBe('ack')
    finishFirst()
    await expect(first).resolves.toBe('ack')
  })

  it('holds the lane until the write finishes when the message is not queued in a batch', async () => {
    let finishFirst!: () => void
    const sendMessage = jest.fn((p: MessageSendPayload) => {
      if (p.clientMessageId !== 'tmp-1') return Promise.resolve({})
      return new Promise((resolve) => (finishFirst = () => resolve({})))
    })
    const { handler } = makeHandler(sendMessage)

    const first = handler.handle(payload(1))
    const second = handler.handle(payload(2))
    await new Promise((r) => setImmediate(r))
    expect(sendMessage).toHaveBeenCalledTimes(1)

    finishFirst()
    await expect(Promise.all([first, second])).resolves.toEqual(['ack', 'ack'])
  })

  it('dead-letters without retrying a send that failed after it was queued', async () => {
    const sendMessage = jest.fn(
      (_p: MessageSendPayload, onQueued: () => void) => {
        onQueued()
        return Promise.reject(new Error('insert failed'))
      },
    )
    const { handler, events } = makeHandler(sendMessage)

    await expect(handler.handle(payload(1))).resolves.toBe('dead-letter')
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(events.publishMessageError).toHaveBeenCalledTimes(1)
  })
})
