import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailerService as NestMailerService } from '@nestjs-modules/mailer';
import { MailerService } from './mailer.service';

describe('MailerService', () => {
  let service: MailerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        {
          provide: NestMailerService,
          useValue: { sendMail: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'FRONTEND_URL' ? 'http://localhost:5173' : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<MailerService>(MailerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
