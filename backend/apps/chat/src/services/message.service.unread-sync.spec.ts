import { MessageService } from './message.service'
import {
  DIRTY_CONVERSATIONS_KEY,
  SET_NEWEST_ID_SCRIPT,
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

function send(service: MessageService, id: string | undefined) {
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
    },
    senderMember: { userId: SENDER, fullName: 'Alice' },
    memberIds: [SENDER, OTHER],
  })
}

describe('MessageService — đồng bộ unread qua Redis', () => {
  it('pipeline ghi id tin mới nhất theo người gửi (set-if-greater), trước SADD', () => {
    const { service, redisService } = setup()

    send(service, MSG)

    expect(redisService.pipeline).toHaveBeenCalledTimes(1)
    const [commands] = redisService.pipeline.mock.calls[0]
    expect(commands.map((command) => command[0])).toEqual([
      'eval',
      'hincrby',
      'set',
      'sadd',
    ])
    expect(commands[0]).toEqual([
      'eval',
      SET_NEWEST_ID_SCRIPT,
      1,
      `unread_last:${CONV}`,
      SENDER,
      MSG,
    ])
    expect(commands[1]).toEqual(['hincrby', `unread_count:${CONV}`, SENDER, 1])
    expect(commands[2].slice(0, 2)).toEqual(['set', `last_message:${CONV}`])
    const lastMessage = JSON.parse(String(commands[2][2])) as {
      lastMessageId: string
    }
    expect(lastMessage.lastMessageId).toBe(MSG)
    expect(commands[3]).toEqual(['sadd', DIRTY_CONVERSATIONS_KEY, CONV])
  })

  it('tin không có id hợp lệ -> bỏ lệnh id mới nhất, phần còn lại giữ nguyên', () => {
    const { service, redisService } = setup()

    send(service, undefined)

    const [commands] = redisService.pipeline.mock.calls[0]
    expect(commands.map((command) => command[0])).toEqual([
      'hincrby',
      'set',
      'sadd',
    ])
  })
})
