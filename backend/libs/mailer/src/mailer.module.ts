import { Module } from '@nestjs/common'
import { MailerService } from './mailer.service'
import { MailerModule as NestMailerModule } from '@nestjs-modules/mailer'
import { ConfigModule, ConfigService } from '@nestjs/config'

@Module({
  imports: [
    ConfigModule, // hoặc ConfigModule.forRoot() nếu muốn tự load env trong lib
    NestMailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('SMTP_HOST'),
          port: Number(config.get('SMTP_PORT')) || 587,
          // MailHog/Mailpit ở local không có AUTH — gửi khối `auth` rỗng sẽ
          // làm nodemailer báo "Missing credentials for PLAIN". Chỉ đính kèm
          // thông tin đăng nhập khi thực sự có.
          ...(config.get('SMTP_USER')
            ? {
                auth: {
                  user: config.get('SMTP_USER'),
                  pass: config.get('SMTP_PASS'),
                },
              }
            : {}),
        },
        defaults: {
          from: '"Chat App" <no-reply@chat.com>',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
