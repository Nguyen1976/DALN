import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { MailerService as NestMailerService } from '@nestjs-modules/mailer'
import { MailerService } from './mailer.service'

type SentMail = {
  to: string
  subject: string
  html: string
  attachments: Record<string, unknown>[]
}

describe('MailerService', () => {
  let service: MailerService
  let sendMail: jest.Mock<Promise<void>, [SentMail]>

  beforeEach(async () => {
    sendMail = jest.fn<Promise<void>, [SentMail]>().mockResolvedValue(undefined)
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        { provide: NestMailerService, useValue: { sendMail } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'FRONTEND_URL' ? 'https://chat.example.test/' : undefined,
            ),
          },
        },
      ],
    }).compile()

    service = module.get<MailerService>(MailerService)
  })

  const lastMail = (): SentMail =>
    sendMail.mock.calls[sendMail.mock.calls.length - 1][0]

  const sendAll = async () => {
    await service.sendRegistrationOtp({
      email: 'an@example.test',
      username: 'an',
      otp: '482913',
    })
    await service.sendUserConfirmation({
      email: 'an@example.test',
      username: 'an',
      fullName: 'Nguyễn An',
    })
    await service.sendMakeFriendNotification({
      senderName: 'binh',
      friendEmail: 'an@example.test',
      receiverName: 'an',
      friendRequestId: 'req 1',
    })
  }

  it('điền đủ biến cho mọi template và nhúng logo', async () => {
    await sendAll()

    expect(sendMail).toHaveBeenCalledTimes(3)
    for (const [mail] of sendMail.mock.calls) {
      expect(mail.html).not.toMatch(/{{|}}/)
      expect(mail.html).toContain('src="cid:daln-mark"')
      expect(mail.html).toContain('href="https://chat.example.test"')
      expect(mail.attachments).toEqual([
        expect.objectContaining({
          cid: 'daln-mark',
          contentDisposition: 'inline',
        }),
      ])
    }
  })

  it('link lấy từ FRONTEND_URL và mã hoá tham số', async () => {
    await service.sendRegistrationOtp({
      email: 'an+qc@example.test',
      username: 'an',
      otp: '482913',
    })

    expect(lastMail().html).toContain(
      'href="https://chat.example.test/verify-otp?email=an%2Bqc%40example.test"',
    )
    expect(lastMail().html).toContain('482913')
  })

  it('lời mời kết bạn chỉ còn một đích: trang của đúng lời mời', async () => {
    await service.sendMakeFriendNotification({
      senderName: 'binh',
      friendEmail: 'an@example.test',
      receiverName: 'an',
      friendRequestId: 'req 1',
    })

    const html = lastMail().html
    const targets = new Set(
      [...html.matchAll(/href="([^"]*friend_requests[^"]*)"/g)].map(
        (m) => m[1],
      ),
    )
    expect([...targets]).toEqual([
      'https://chat.example.test/friend_requests?requestId=req%201',
    ])
    expect(html).toContain(
      'href="https://chat.example.test/settings/notifications"',
    )
    expect(lastMail().subject).toBe('binh muốn kết bạn với bạn trên DALN Chat')
  })

  it('escape HTML trong tên do người dùng đặt', async () => {
    await service.sendMakeFriendNotification({
      senderName: '<a href="https://evil.test">Nhận quà</a>',
      friendEmail: 'an@example.test',
      receiverName: 'an',
      friendRequestId: 'req-1',
    })

    const html = lastMail().html
    expect(html).not.toContain('<a href="https://evil.test">')
    expect(html).toContain(
      '&lt;a href=&quot;https://evil.test&quot;&gt;Nhận quà&lt;/a&gt;',
    )
    // Avatar lấy chữ đầu của tên: "<" cũng phải được escape.
    expect(html).toContain('>&lt;</td>')
  })

  it('giữ nguyên chữ $& và $1 trong giá trị', async () => {
    await service.sendRegistrationOtp({
      email: 'an@example.test',
      username: '$&$1',
      otp: '482913',
    })

    expect(lastMail().html).toContain('Chào $&amp;$1,')
  })
})
