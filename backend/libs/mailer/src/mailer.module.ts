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
          host: config.get<string>('SMTP_HOST'),
          port: Number(config.get<string>('SMTP_PORT')) || 587,
          // MailHog/Mailpit ở local không có AUTH — gửi khối `auth` rỗng sẽ
          // làm nodemailer báo "Missing credentials for PLAIN". Chỉ đính kèm
          // thông tin đăng nhập khi thực sự có.
          ...(config.get<string>('SMTP_USER')
            ? {
                auth: {
                  user: config.get<string>('SMTP_USER'),
                  pass: config.get<string>('SMTP_PASS'),
                },
              }
            : {}),
        },
        defaults: {
          from: '"DALN Chat" <no-reply@chat.com>',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
