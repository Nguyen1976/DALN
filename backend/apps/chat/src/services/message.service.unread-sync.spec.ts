import { MessageService } from './message.service'
import {
  DIRTY_CONVERSATIONS_KEY,
  SET_LAST_MESSAGE_SCRIPT,
  SET_NEWEST_SEQ_SCRIPT,
} from '../background-jobs/unread/unread.constants'

const CONV = '6a35000000000000000c0001'
const SENDER = '6a35000000000000000a0001'
const OTHER = '6a35000000000000000a0002'
const MSG = '6a350000000000000000ab01'

type Command = (string | number)[]

function setup() {
  const redisService = {
    pipeline: jest
      .fn<Promise<[Error | null, unknown][]>, [Command[]]>()
      .mockResolvedValue([]),
  }
  const eventsPublisher = { publishMessageSent: jest.fn() }
  const service = new MessageService(
    {} as never, // memberRepo
    {} as never, // messageRepo
    eventsPublisher as never,
    {} as never, // messageMediaService
    redisService as never,
    {} as never, // pollRepo
  )
  return { service, redisService }
}

function send(service: MessageService, id: string, seq?: number) {
  return service.notifyMessageCreated({
    conversationId: CONV,
    senderId: SENDER,
    message: {
      id,
      conversationId: CONV,
      senderId: SENDER,
      content: 'xin chào',
      type: 'TEXT',
      createdAt: new Date('2026-09-01T10:00:00Z'),
      seq,
    },
    senderMember: { userId: SENDER, fullName: 'Alice' },
    memberIds: [SENDER, OTHER],
  })
}

describe('MessageService — đồng bộ tin cuối và mốc đọc người gửi qua Redis', () => {
  it('seq mới nhất của người gửi và tin cuối đều "chỉ khi lớn hơn", không còn đếm unread, SADD cuối cùng', () => {
    const { service, redisService } = setup()

    send(service, MSG, 17)

    expect(redisService.pipeline).toHaveBeenCalledTimes(1)
    const [commands] = redisService.pipeline.mock.calls[0]
    expect(commands.map((command) => command[0])).toEqual([
      'eval',
      'eval',
      'sadd',
    ])
    expect(commands[0]).toEqual([
      'eval',
      SET_NEWEST_SEQ_SCRIPT,
      1,
      `unread_last:${CONV}`,
      SENDER,
      17,
    ])
    expect(commands[1].slice(0, 5)).toEqual([
      'eval',
      SET_LAST_MESSAGE_SCRIPT,
      1,
      `last_message:${CONV}`,
      17,
    ])
    const lastMessage = JSON.parse(String(commands[1][5])) as {
      lastMessageId: string
      seq: number
    }
    expect(lastMessage).toMatchObject({ lastMessageId: MSG, seq: 17 })
    expect(commands[2]).toEqual(['sadd', DIRTY_CONVERSATIONS_KEY, CONV])
    expect(commands.some((command) => command[0] === 'hincrby')).toBe(false)
  })

  it('tin chưa có seq -> không có mốc người gửi, tin cuối chỉ ghi khi chưa có bản nào', () => {
    const { service, redisService } = setup()

    send(service, MSG)

    const [commands] = redisService.pipeline.mock.calls[0]
    expect(commands.map((command) => command[0])).toEqual(['eval', 'sadd'])
    expect(commands[0][4]).toBe(0)
  })
})
