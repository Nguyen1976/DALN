import { Injectable } from '@nestjs/common'
import { MailerService as NestMailerService } from '@nestjs-modules/mailer'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

@Injectable()
export class MailerService {
  constructor(private mailer: NestMailerService) {}

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

  async sendUserConfirmation(data) {
    let html = this.readTemplate('welcome.html')

    html = html
      .replace(/{{\s*name\s*}}/g, data.username)
      .replace(/{{\s*loginUrl\s*}}/g, 'https://chat-app.com/login')
      .replace(/{{\s*year\s*}}/g, String(new Date().getFullYear()))

    await this.mailer.sendMail({
      to: data.email,
      subject: 'Chào mừng bạn đến với Chat App 🎉',
      html, // mail/templates/confirmation.hbs
    })
  }

  async sendMakeFriendNotification({ senderName, friendEmail, receiverName }) {
    let html = this.readTemplate('make-friend.html')

    html = html
      .replace(/{{\s*senderName\s*}}/g, senderName)
      .replace(/{{\s*receiverName\s*}}/g, receiverName)
      .replace(/{{\s*acceptUrl\s*}}/g, 'ok')
      .replace(/{{\s*rejectUrl\s*}}/g, 'ok')
      .replace(/{{\s*year\s*}}/g, String(new Date().getFullYear()))
    //ở template này sẽ thiết kế lại để redirect người dùng về đúng trang web của mình
    await this.mailer.sendMail({
      to: friendEmail,
      subject: 'Bạn có một lời mời kết bạn mới trên Chat App 🎉',
      html, // mail/templates/confirmation.hbs
    })
  }

  async sendRegistrationOtp(data: {
    email: string
    username: string
    otp: string
  }) {
    let html = this.readTemplate('register-otp.html')

    html = html
      .replace(/{{\s*name\s*}}/g, data.username)
      .replace(/{{\s*otp\s*}}/g, data.otp)
      .replace(/{{\s*year\s*}}/g, String(new Date().getFullYear()))

    await this.mailer.sendMail({
      to: data.email,
      subject: 'Mã OTP kích hoạt tài khoản Chat App',
      html,
    })
  }
}
