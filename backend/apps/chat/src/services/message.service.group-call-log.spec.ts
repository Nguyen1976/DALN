import { BadRequestException } from '@nestjs/common'
import { MessageService } from './message.service'

const CONV = '6a35000000000000000c0001'
const M1 = '6a35000000000000000a0001'
const M2 = '6a35000000000000000a0002'

/**
 * MessageService kéo theo Prisma, Redis và RabbitMQ; logGroupCall chỉ đọc danh
 * sách thành viên rồi uỷ thác cho createSystemMessageAndSync — spy hàm đó để
 * kiểm nội dung tin mà không chạy pipeline Redis thật.
 */
function setup() {
  const memberRepo = { findByConversationId: jest.fn() }
  // claimOnce mặc định thắng (true) để nhánh idempotency không chặn tin; test
  // nào cần mô phỏng webhook gửi lại thì override cho trả false.
  const redisService = { claimOnce: jest.fn().mockResolvedValue(true) }
  const service = new MessageService(
    memberRepo as never,
    {} as never, // messageRepo
    {} as never, // eventsPublisher
    {} as never, // messageMediaService
    redisService as never,
    {} as never, // pollRepo
  )
  const sync = jest
    .spyOn(service, 'createCallLogAndSync')
    .mockResolvedValue(undefined as never)
  return { service, memberRepo, redisService, sync }
}

describe('MessageService.logGroupCall', () => {
  it('còn thành viên -> ghi tin "Cuộc gọi nhóm — N người · phút giây" và trả ok:true', async () => {
    const { service, memberRepo, sync } = setup()
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: M1 },
      { userId: M2 },
    ])

    await expect(
      service.logGroupCall({
        conversationId: CONV,
        participantCount: 3,
        durationSeconds: 125,
      }),
    ).resolves.toEqual({ ok: true })

    expect(sync).toHaveBeenCalledWith(
      CONV,
      M1,
      'Cuộc gọi nhóm — 3 người · 2 phút 5 giây',
      expect.objectContaining({ scope: 'group', callType: 'audio' }),
    )
  })

  it('dưới một phút -> thời lượng chỉ hiện giây', async () => {
    const { service, memberRepo, sync } = setup()
    memberRepo.findByConversationId.mockResolvedValue([{ userId: M1 }])

    await service.logGroupCall({
      conversationId: CONV,
      participantCount: 2,
      durationSeconds: 45,
    })

    expect(sync).toHaveBeenCalledWith(
      CONV,
      M1,
      'Cuộc gọi nhóm — 2 người · 45 giây',
      expect.objectContaining({ scope: 'group', callType: 'audio' }),
    )
  })

  it('số âm/không hợp lệ được kẹp về 0', async () => {
    const { service, memberRepo, sync } = setup()
    memberRepo.findByConversationId.mockResolvedValue([{ userId: M1 }])

    await service.logGroupCall({
      conversationId: CONV,
      participantCount: -5 as never,
      durationSeconds: Number.NaN as never,
    })

    expect(sync).toHaveBeenCalledWith(
      CONV,
      M1,
      'Cuộc gọi nhóm — 0 người · 0 giây',
      expect.objectContaining({ scope: 'group', callType: 'audio' }),
    )
  })

  it('không còn thành viên (hội thoại đã biến mất) -> ok:false, không ghi gì', async () => {
    const { service, memberRepo, sync } = setup()
    memberRepo.findByConversationId.mockResolvedValue([])

    await expect(
      service.logGroupCall({
        conversationId: CONV,
        participantCount: 3,
        durationSeconds: 10,
      }),
    ).resolves.toEqual({ ok: false })
    expect(sync).not.toHaveBeenCalled()
  })

  it('conversationId không phải ObjectId -> 400, không chạm repo', async () => {
    const { service, memberRepo } = setup()

    await expect(
      service.logGroupCall({
        conversationId: 'khong-hop-le',
        participantCount: 3,
        durationSeconds: 10,
      }),
    ).rejects.toThrow(BadRequestException)
    expect(memberRepo.findByConversationId).not.toHaveBeenCalled()
  })

  it('thiếu conversationId -> 400', async () => {
    const { service } = setup()

    await expect(
      service.logGroupCall({
        conversationId: '',
        participantCount: 3,
        durationSeconds: 10,
      }),
    ).rejects.toThrow(BadRequestException)
  })

  it('callType video -> ghi "Cuộc gọi video nhóm — N người · phút giây"', async () => {
    const { service, memberRepo, sync } = setup()
    memberRepo.findByConversationId.mockResolvedValue([
      { userId: M1 },
      { userId: M2 },
    ])

    await expect(
      service.logGroupCall({
        conversationId: CONV,
        participantCount: 3,
        durationSeconds: 125,
        callType: 'video',
      }),
    ).resolves.toEqual({ ok: true })

    expect(sync).toHaveBeenCalledWith(
      CONV,
      M1,
      'Cuộc gọi video nhóm — 3 người · 2 phút 5 giây',
      expect.objectContaining({ scope: 'group', callType: 'video' }),
    )
  })

  it('cùng callId gọi lần hai -> idempotent: claimOnce trả false, không ghi gì, vẫn ok:true', async () => {
    const { service, memberRepo, redisService, sync } = setup()
    memberRepo.findByConversationId.mockResolvedValue([{ userId: M1 }])
    // Lần đầu thắng claim, lần hai (webhook gửi lại) thua.
    redisService.claimOnce
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(
      service.logGroupCall({
        conversationId: CONV,
        participantCount: 2,
        durationSeconds: 30,
        callId: 'call-abc',
      }),
    ).resolves.toEqual({ ok: true })

    await expect(
      service.logGroupCall({
        conversationId: CONV,
        participantCount: 2,
        durationSeconds: 30,
        callId: 'call-abc',
      }),
    ).resolves.toEqual({ ok: true })

    expect(redisService.claimOnce).toHaveBeenCalledWith(
      'chat:groupcalllog:call-abc',
      86400,
    )
    // Chỉ tin đầu tiên được ghi; lần trùng không tạo tin thứ hai.
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
