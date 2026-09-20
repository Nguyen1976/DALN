import { MessageService } from './message.service'
import type { MessageDto } from '../domain/message.mapper'

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
    const publishMessageSent = jest.fn<void, [MessageDto, string[]]>()
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

  /**
   * Replying to a photo used to quote the file name — "IMG_3946.jpeg" — because
   * the quote carried nothing but `fileName`. The bubble needs the picture
   * itself, so the flattened quote passes the media's URL along too.
   */
  it('publishes the quoted media so a reply can show the picture', () => {
    const publishMessageSent = jest.fn<void, [MessageDto, string[]]>()
    const service = new MessageService(
      {} as never,
      {} as never,
      { publishMessageSent } as never,
      {} as never,
      { pipeline: jest.fn().mockResolvedValue([]) } as never,
      {} as never, // pollRepo
    )

    service.notifyMessageCreated({
      conversationId: CONV,
      senderId: SENDER,
      message: {
        id: '6a350000000000000000ab04',
        conversationId: CONV,
        senderId: SENDER,
        content: 'ok',
        type: 'TEXT',
        createdAt: new Date('2026-09-01T10:00:00Z'),
        replyToMessageId: '6a350000000000000000ab03',
        replyTo: {
          id: '6a350000000000000000ab03',
          senderId: OTHER,
          content: '',
          type: 'IMAGE',
          senderMember: { userId: OTHER, fullName: 'Bình', username: 'binh' },
          medias: [
            {
              mediaType: 'IMAGE',
              fileName: 'IMG_3946.jpeg',
              url: 'https://cdn.test/IMG_3946.jpeg',
              mimeType: 'image/jpeg',
              thumbnailUrl: null,
            },
          ],
        },
      } as never,
      senderMember: { userId: SENDER, fullName: 'Alice' },
      memberIds: [SENDER, OTHER],
      clientMessageId: 'tmp-2',
    })

    expect(publishMessageSent.mock.calls[0][0].replyTo).toMatchObject({
      attachmentType: 'IMAGE',
      attachmentUrl: 'https://cdn.test/IMG_3946.jpeg',
      attachmentName: 'IMG_3946.jpeg',
    })
  })
})
