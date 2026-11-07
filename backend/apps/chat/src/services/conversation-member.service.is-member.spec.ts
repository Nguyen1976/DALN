import { ConversationMemberService } from './conversation-member.service'

const CONV = '6a35000000000000000c0001'
const USER = '6a35000000000000000a0001'

function setup(row: unknown) {
  const memberRepo = {
    findByConversationIdAndUserId: jest.fn().mockResolvedValue(row),
  }
  const service = new ConversationMemberService(
    {} as never,
    memberRepo as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { service, memberRepo }
}

describe('ConversationMemberService.isActiveMember', () => {
  it('có dòng thành viên đang hoạt động thì trả lời có', async () => {
    const { service } = setup({ userId: USER })
    await expect(service.isActiveMember(CONV, USER)).resolves.toEqual({
      member: true,
    })
  })

  it('không có dòng nào thì trả lời không', async () => {
    const { service } = setup(null)
    await expect(service.isActiveMember(CONV, USER)).resolves.toEqual({
      member: false,
    })
  })

  it('id từ socket sai định dạng: trả lời không, không đụng tới DB', async () => {
    const { service, memberRepo } = setup({ userId: USER })
    await expect(service.isActiveMember('rác', USER)).resolves.toEqual({
      member: false,
    })
    expect(memberRepo.findByConversationIdAndUserId).not.toHaveBeenCalled()
  })
})
