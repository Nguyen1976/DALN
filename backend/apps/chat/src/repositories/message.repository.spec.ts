import { MessageRepository } from './message.repository'

const CONV = '6a35000000000000000c0001'
const SENDER = '6a35000000000000000a0001'

const media = {
  mediaType: 'IMAGE' as const,
  objectKey: 'chat/a.png',
  url: 'http://minio/a.png',
  mimeType: 'image/png',
  size: '10',
}

describe('MessageRepository.create', () => {
  it('returns the existing message when a media message is retried', async () => {
    const existing = {
      id: 'old',
      conversationId: CONV,
      senderId: SENDER,
      clientMessageId: 'c1',
      medias: [{ id: 'media-1' }],
      poll: null,
    }
    const prisma = {
      message: {
        create: jest.fn(() =>
          Promise.reject(
            Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            }),
          ),
        ),
        findFirst: jest.fn(() => Promise.resolve(existing)),
      },
    }
    const repo = new MessageRepository(prisma as never, {} as never)

    const saved = await repo.create({
      conversationId: CONV,
      senderId: SENDER,
      type: 'IMAGE',
      medias: [media],
      clientMessageId: 'c1',
    })

    expect(saved.id).toBe('old')
    expect(saved).toHaveProperty('replayed', true)
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { senderId: SENDER, clientMessageId: 'c1' },
      }),
    )
  })

  it('still rejects other write errors', async () => {
    const prisma = {
      message: {
        create: jest.fn(() => Promise.reject(new Error('connection lost'))),
        findFirst: jest.fn(),
      },
    }
    const repo = new MessageRepository(prisma as never, {} as never)

    await expect(
      repo.create({
        conversationId: CONV,
        senderId: SENDER,
        type: 'IMAGE',
        medias: [media],
        clientMessageId: 'c1',
      }),
    ).rejects.toThrow('connection lost')
    expect(prisma.message.findFirst).not.toHaveBeenCalled()
  })
})

describe('MessageRepository.create onQueued', () => {
  it('signals as soon as a text message is in the write batch, before it is written', () => {
    const batchWriter = { enqueue: jest.fn(() => new Promise(() => {})) }
    const repo = new MessageRepository({} as never, batchWriter as never)
    const onQueued = jest.fn()

    void repo.create(
      {
        conversationId: CONV,
        senderId: SENDER,
        type: 'TEXT',
        content: 'hi',
        clientMessageId: 'c1',
      },
      onQueued,
    )

    expect(batchWriter.enqueue).toHaveBeenCalledTimes(1)
    expect(onQueued).toHaveBeenCalledTimes(1)
  })

  it('does not signal for a media message, whose createdAt is set when it is written', async () => {
    const prisma = {
      message: { create: jest.fn(() => Promise.resolve({ id: 'm1' })) },
    }
    const repo = new MessageRepository(prisma as never, {} as never)
    const onQueued = jest.fn()

    await repo.create(
      {
        conversationId: CONV,
        senderId: SENDER,
        type: 'IMAGE',
        medias: [media],
        clientMessageId: 'c1',
      },
      onQueued,
    )

    expect(onQueued).not.toHaveBeenCalled()
  })
})
