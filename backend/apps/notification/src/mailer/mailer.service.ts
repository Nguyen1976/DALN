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
    // Hai bố cục chạy thật: mã nguồn (jest) có templates/ nằm cạnh file này;
    // bundle webpack (dev watch và prod) nằm ở dist/apps/notification, template
    // được nest-cli copy vào mailer/templates cạnh main.js. webpack của Nest
    // giữ __dirname thật (node.__dirname: false).
    const candidates = [
      join(__dirname, 'templates', filename),
      join(__dirname, 'mailer', 'templates', filename),
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

  /**
   * Mã xác nhận đổi mật khẩu.
   *
   * Không có nút bấm nào như mail kích hoạt: người nhận đang đứng sẵn ở hộp
   * thoại đổi mật khẩu trong ứng dụng. Thêm một liên kết ở đây chỉ dạy người
   * dùng thói quen bấm vào link trong thư nói về mật khẩu — đúng thứ mà mọi
   * trang lừa đảo đang trông chờ.
   */
  async sendChangePasswordOtp(data: {
    email: string
    username: string
    otp: string
  }) {
    const html = this.render('change-password-otp.html', {
      name: data.username,
      otp: data.otp,
      email: data.email,
    })
    await this.send(data.email, 'Mã xác nhận đổi mật khẩu DALN Chat', html)
  }

  /**
   * Mail mang liên kết đặt lại mật khẩu.
   *
   * URL ghép ở đây chứ không phải ở user-service: `FRONTEND_URL` chỉ sống
   * trong service này, và đây là khuôn mẫu `sendRegistrationOtp` đang dùng.
   *
   * `encodeURIComponent` để lại token base64url nguyên vẹn — bảng chữ cái của
   * nó (A–Z a–z 0–9 - _) không có ký tự nào cần mã hoá. Vẫn gọi để lỡ sau này
   * đổi cách sinh token thì URL không hỏng.
   */
  async sendPasswordReset(data: {
    email: string
    username: string
    token: string
    expiresInMinutes: number
  }) {
    const html = this.render('password-reset.html', {
      name: data.username,
      email: data.email,
      minutes: String(data.expiresInMinutes),
      resetUrl: this.buildFrontendUrl(
        `/reset-password?token=${encodeURIComponent(data.token)}`,
      ),
    })
    await this.send(data.email, 'Đặt lại mật khẩu DALN Chat', html)
  }

  /**
   * Mail này không phải trang trí: nó là kênh DUY NHẤT báo cho chủ tài khoản
   * biết có người vừa đặt lại mật khẩu của họ. Càng cần thiết khi phiên đăng
   * nhập cũ chưa bị thu hồi (xem §8.1 của spec).
   */
  async sendPasswordChanged(data: {
    email: string
    username: string
    changedAt: string
  }) {
    const html = this.render('password-changed.html', {
      name: data.username,
      email: data.email,
      changedAt: new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(data.changedAt)),
    })
    await this.send(data.email, 'Mật khẩu DALN Chat vừa được đổi', html)
  }

  /**
   * Cảnh báo khi phát hiện refresh token bị dùng lại.
   *
   * Rotation biến việc trộm token từ im lặng thành ồn ào, nhưng cái ồn ào đó
   * chỉ có ích nếu tới được chủ tài khoản. Không có mail này thì người dùng chỉ
   * thấy mình bị đăng xuất mà không biết vì sao — và không biết rằng nên đổi
   * mật khẩu.
   */
  async sendSessionRevoked(data: {
    email: string
    username: string
    revokedAt: string
  }) {
    const html = this.render('session-revoked.html', {
      name: data.username,
      email: data.email,
      revokedAt: new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(data.revokedAt)),
    })
    await this.send(
      data.email,
      'Phiên đăng nhập DALN Chat vừa bị thu hồi',
      html,
    )
  }
}
