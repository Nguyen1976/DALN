import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MailerService as NestMailerService } from '@nestjs-modules/mailer'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

@Injectable()
export class MailerService {
  constructor(
    private readonly mailer: NestMailerService,
    private readonly config: ConfigService,
  ) {}

  private readTemplate(filename: string): string {
    const candidates = [
      join(process.cwd(), 'libs/mailer/src/templates', filename),
      join(__dirname, 'templates', filename),
    ]
    const path = candidates.find((candidate) => existsSync(candidate))
    if (!path) {
      throw new Error(`Mail template not found: ${filename}`)
    }
    return readFileSync(path, 'utf8')
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

  async sendUserConfirmation(data) {
    let html = this.readTemplate('welcome.html')

    html = html
      .replace(/{{\s*name\s*}}/g, data.username)
      .replace(/{{\s*loginUrl\s*}}/g, this.buildFrontendUrl('/auth'))
      .replace(/{{\s*year\s*}}/g, String(new Date().getFullYear()))

    await this.mailer.sendMail({
      to: data.email,
      subject: 'Chào mừng bạn đến với Chat App 🎉',
      html,
    })
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
    let html = this.readTemplate('make-friend.html')

    const friendRequestUrl = this.buildFrontendUrl(
      `/friend_requests?requestId=${encodeURIComponent(friendRequestId)}`,
    )

    html = html
      .replace(/{{\s*senderName\s*}}/g, senderName)
      .replace(/{{\s*receiverName\s*}}/g, receiverName)
      .replace(/{{\s*acceptUrl\s*}}/g, friendRequestUrl)
      .replace(/{{\s*rejectUrl\s*}}/g, friendRequestUrl)
      .replace(/{{\s*year\s*}}/g, String(new Date().getFullYear()))

    await this.mailer.sendMail({
      to: friendEmail,
      subject: 'Bạn có một lời mời kết bạn mới trên Chat App 🎉',
      html,
    })
  }

  async sendRegistrationOtp(data: {
    email: string
    username: string
    otp: string
  }) {
    let html = this.readTemplate('register-otp.html')

    const verifyUrl = this.buildFrontendUrl(
      `/verify-otp?email=${encodeURIComponent(data.email)}`,
    )

    html = html
      .replace(/{{\s*name\s*}}/g, data.username)
      .replace(/{{\s*otp\s*}}/g, data.otp)
      .replace(/{{\s*verifyUrl\s*}}/g, verifyUrl)
      .replace(/{{\s*year\s*}}/g, String(new Date().getFullYear()))

    await this.mailer.sendMail({
      to: data.email,
      subject: 'Mã OTP kích hoạt tài khoản Chat App',
      html,
    })
  }
}
