import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MailerService as NestMailerService } from '@nestjs-modules/mailer'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Logo gắn vào mail dưới dạng ảnh nhúng (CID): hiện được cả khi web chưa chạy
 * (dev) và không bị Outlook chặn như ảnh tải từ ngoài.
 */
const BRAND_MARK = { file: 'brand-mark.png', cid: 'daln-mark' }

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])

/** Chữ cái đầu của tên, làm avatar trong mail lời mời kết bạn. */
const initialOf = (name: string) =>
  (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase('vi')

@Injectable()
export class MailerService {
  constructor(
    private readonly mailer: NestMailerService,
    private readonly config: ConfigService,
  ) {}

  private resolveTemplate(filename: string): string {
    const candidates = [
      join(process.cwd(), 'libs/mailer/src/templates', filename),
      join(__dirname, 'templates', filename),
    ]
    const path = candidates.find((candidate) => existsSync(candidate))
    if (!path) {
      throw new Error(`Mail template not found: ${filename}`)
    }
    return path
  }

  private getFrontendBaseUrl(): string {
    const raw =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    return raw.replace(/\/+$/, '')
  }

  private buildFrontendUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${this.getFrontendBaseUrl()}${normalizedPath}`
  }

  /**
   * Điền `{{biến}}` vào template. Giá trị luôn được escape HTML (tên do người
   * dùng tự đặt) và thay qua hàm để `$&`, `$1`… trong giá trị giữ nguyên chữ.
   */
  private render(filename: string, vars: Record<string, string>): string {
    const appUrl = this.getFrontendBaseUrl()
    const values: Record<string, string> = {
      appUrl,
      appHost: appUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''),
      settingsUrl: this.buildFrontendUrl('/settings/notifications'),
      year: String(new Date().getFullYear()),
      ...vars,
    }
    return readFileSync(this.resolveTemplate(filename), 'utf8').replace(
      /{{\s*(\w+)\s*}}/g,
      (placeholder: string, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key)
          ? escapeHtml(values[key])
          : placeholder,
    )
  }

  private async send(to: string, subject: string, html: string) {
    await this.mailer.sendMail({
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'daln-chat.png',
          path: this.resolveTemplate(BRAND_MARK.file),
          cid: BRAND_MARK.cid,
          contentDisposition: 'inline',
        },
      ],
    })
  }

  async sendUserConfirmation(data: {
    email: string
    username: string
    fullName?: string
  }) {
    const html = this.render('welcome.html', {
      name: data.fullName?.trim() || data.username,
      loginUrl: this.buildFrontendUrl('/auth'),
    })
    await this.send(data.email, 'Chào mừng bạn đến với DALN Chat', html)
  }

  async sendMakeFriendNotification({
    senderName,
    friendEmail,
    receiverName,
    friendRequestId,
  }: {
    senderName: string
    friendEmail: string
    receiverName: string
    friendRequestId: string
  }) {
    const html = this.render('make-friend.html', {
      senderName,
      senderInitial: initialOf(senderName),
      receiverName,
      requestUrl: this.buildFrontendUrl(
        `/friend_requests?requestId=${encodeURIComponent(friendRequestId)}`,
      ),
    })
    await this.send(
      friendEmail,
      `${senderName} muốn kết bạn với bạn trên DALN Chat`,
      html,
    )
  }

  async sendRegistrationOtp(data: {
    email: string
    username: string
    otp: string
  }) {
    const html = this.render('register-otp.html', {
      name: data.username,
      otp: data.otp,
      email: data.email,
      verifyUrl: this.buildFrontendUrl(
        `/verify-otp?email=${encodeURIComponent(data.email)}`,
      ),
    })
    await this.send(data.email, 'Mã kích hoạt tài khoản DALN Chat', html)
  }
}
