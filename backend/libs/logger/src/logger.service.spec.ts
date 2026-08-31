import { Test, TestingModule } from '@nestjs/testing'
import { LoggerService } from './logger.service'

/**
 * Smoke test: the service can be constructed with its one dependency.
 *
 * The winston instance is stubbed rather than built for real — this asserts
 * the wiring, not that winston writes files.
 */
describe('LoggerService', () => {
  let service: LoggerService

  const winstonStub = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggerService,
        { provide: 'WINSTON_LOGGER', useValue: winstonStub },
      ],
    }).compile()

    service = module.get<LoggerService>(LoggerService)
  })

  it('khởi tạo được', () => {
    expect(service).toBeDefined()
  })

  it('chuyển tiếp log tới winston', () => {
    service.info('xin chao', { a: 1 })
    expect(winstonStub.info).toHaveBeenCalled()
  })
})
