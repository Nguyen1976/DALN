import { ConversationMemberService } from './conversation-member.service'

const CONV = '6a35000000000000000c0001'
const OWNER = '6a35000000000000000a0001'
const NEWBIE = '6a35000000000000000a0009'

/**
 * Người vừa được thêm vào nhóm không được có badge 1 vì chính tin hệ thống
 * "đã thêm bạn": tin đó ghi SAU khi họ vào (mốc đọc = lastSeq lúc vào), nên
 * nếu không đẩy mốc đọc của họ tới nó thì unread = latestSeq − lastReadSeq = 1.
 */
describe('ConversationMemberService.addMemberToConversation', () => {
  it('marks the "added" system message as read for the people it announces', async () => {
    const memberRepo = {
      findByConversationId: jest.fn(() =>
        Promise.resolve([{ userId: OWNER, role: 'OWNER' }]),
      ),
      addMembers: jest.fn(() => Promise.resolve(1)),
      markReadUpTo: jest.fn(() => Promise.resolve(1)),
    }
    const conversationRepo = {
      findById: jest.fn(() =>
        Promise.resolve({ id: CONV, type: 'GROUP', groupName: 'Nhóm' }),
      ),
      incrementMemberCount: jest.fn(() => Promise.resolve(null)),
      findByIdWithMembers: jest.fn(() =>
        Promise.resolve({ id: CONV, members: [] }),
      ),
    }
    const messageService = {
      createSystemMessageAndSync: jest.fn(() =>
        Promise.resolve({ id: 'sys', seq: 31 }),
      ),
    }
    const userDirectory = {
      getProfiles: jest.fn(() =>
        Promise.resolve([
          { userId: NEWBIE, username: 'n', fullName: 'N', avatar: null },
        ]),
      ),
    }
    const eventsPublisher = {
      publishMemberAddedToConversation: jest.fn(),
      publishUserJoinedGroup: jest.fn(),
    }
    const service = new ConversationMemberService(
      conversationRepo as never,
      memberRepo as never,
      eventsPublisher as never,
      messageService as never,
      userDirectory as never,
    )

    await service.addMemberToConversation({
      conversationId: CONV,
      userId: OWNER,
      memberIds: [NEWBIE],
    })

    expect(memberRepo.markReadUpTo).toHaveBeenCalledWith(CONV, [NEWBIE], 31)
  })
})
