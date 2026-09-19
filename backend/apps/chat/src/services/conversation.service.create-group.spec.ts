import { BadRequestException } from '@nestjs/common'
import { ConversationService } from './conversation.service'

const OWNER = '6a35000000000000000a0001'
const A = '6a35000000000000000a0002'
const B = '6a35000000000000000a0003'

const profile = (userId: string, name: string) => ({
  userId,
  username: name.toLowerCase(),
  fullName: name,
  avatar: `https://cdn/${name}.png`,
})

function setup(
  profiles = [profile(OWNER, 'Owner'), profile(A, 'An'), profile(B, 'Bình')],
) {
  const conversationRepo = {
    create: jest.fn().mockResolvedValue({ id: 'c1', groupName: 'Nhóm' }),
    findByIdWithMembers: jest
      .fn()
      .mockResolvedValue({ id: 'c1', type: 'GROUP' }),
  }
  const memberRepo = { createMany: jest.fn() }
  const eventsPublisher = {
    publishConversationCreated: jest.fn(),
    publishUserJoinedGroup: jest.fn(),
  }
  const userDirectory = { getProfiles: jest.fn().mockResolvedValue(profiles) }
  const service = new ConversationService(
    conversationRepo as never,
    memberRepo as never,
    eventsPublisher as never,
    {} as never, // messageMediaService
    {} as never, // s3StorageService
    userDirectory as never,
  )
  return { service, memberRepo, userDirectory, eventsPublisher }
}

describe('ConversationService.createGroup', () => {
  it('takes every profile, the owner included, from the user service', async () => {
    const { service, memberRepo, userDirectory, eventsPublisher } = setup()

    await service.createGroup(OWNER, {
      groupName: 'Nhóm',
      memberIds: [A, B, A, OWNER],
    })

    expect(userDirectory.getProfiles).toHaveBeenCalledWith([OWNER, A, B])
    const [, stored, options] = memberRepo.createMany.mock.calls[0]
    expect(stored[0]).toEqual(profile(OWNER, 'Owner'))
    expect(options).toEqual({ type: 'GROUP', ownerId: OWNER })
    // Everyone but the owner hears about it over the socket.
    expect(eventsPublisher.publishConversationCreated).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: [A, B] }),
    )
  })

  it('needs at least two other people', async () => {
    const { service } = setup()
    await expect(
      service.createGroup(OWNER, { groupName: 'Nhóm', memberIds: [A] }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses ids the user service does not know', async () => {
    const { service, memberRepo } = setup([
      profile(OWNER, 'Owner'),
      profile(A, 'An'),
    ])
    await expect(
      service.createGroup(OWNER, { groupName: 'Nhóm', memberIds: [A, B] }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(memberRepo.createMany).not.toHaveBeenCalled()
  })
})
