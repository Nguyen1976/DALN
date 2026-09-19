import { MessageService } from './message.service'

const CONV = '6a35000000000000000c0001'
const SENDER = '6a35000000000000000a0001'
const OTHER = '6a35000000000000000a0002'

/**
 * The message a reply quotes reaches other members over the socket with its
 * sender's name. Mapping the message a second time on its way out used to
 * rebuild the quote from fields the first pass had dropped, so the name
 * arrived empty and the bubble read "Người dùng" until a reload.
 */
describe('MessageService — reply quotes survive the realtime path', () => {
  it('publishes the quoted sender name and attachment untouched', () => {
    const publishMessageSent = jest.fn()
    const service = new MessageService(
      {} as never,
      {} as never,
      { publishMessageSent } as never,
      {} as never,
      { pipeline: jest.fn().mockResolvedValue([]) } as never,
      {} as never, // pollRepo
    )

    const message = service.notifyMessageCreated({
      conversationId: CONV,
      senderId: SENDER,
      message: {
        id: '6a350000000000000000ab02',
        conversationId: CONV,
        senderId: SENDER,
        content: 'đồng ý',
        type: 'TEXT',
        createdAt: new Date('2026-09-01T10:00:00Z'),
        replyToMessageId: '6a350000000000000000ab01',
        replyTo: {
          id: '6a350000000000000000ab01',
          senderId: OTHER,
          content: 'gửi bạn tài liệu',
          type: 'FILE',
          senderMember: { userId: OTHER, fullName: 'Bình', username: 'binh' },
          medias: [{ fileName: 'baocao.pdf' }],
        },
      } as never,
      senderMember: { userId: SENDER, fullName: 'Alice' },
      memberIds: [SENDER, OTHER],
      clientMessageId: 'tmp-1',
    })

    const published = publishMessageSent.mock.calls[0][0]
    expect(published.replyTo).toMatchObject({
      senderName: 'Bình',
      attachmentName: 'baocao.pdf',
    })
    expect(published.clientMessageId).toBe('tmp-1')
    // The HTTP answer and the socket event carry the same object.
    expect(published).toBe(message)
  })
})
