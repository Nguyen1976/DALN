import { ArgumentsHost, BadRequestException } from '@nestjs/common'
import { NonRetryableError } from '../rmq/non-retryable.error'
import { AppHttpExceptionFilter } from './http-exception.filter'

function httpHost() {
  const response = { status: jest.fn(), json: jest.fn() }
  response.status.mockReturnValue(response)
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost
  return { host, response }
}

// golevelup dựng handler RabbitMQ qua context của Nest với type 'rmq': không có
// HTTP response nào để ghi.
const rmqHost = {
  getType: () => 'rmq',
  switchToHttp: () => ({ getResponse: () => ({}) }),
} as unknown as ArgumentsHost

describe('AppHttpExceptionFilter', () => {
  const filter = new AppHttpExceptionFilter()

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  it('HTTP + HttpException: trả đúng status và body', () => {
    const { host, response } = httpHost()

    filter.catch(new BadRequestException('sai'), host)

    expect(response.status).toHaveBeenCalledWith(400)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: 'sai' }),
    )
  })

  it('HTTP + lỗi lạ: trả 500 chung, không lộ chi tiết', () => {
    const { host, response } = httpHost()

    filter.catch(new Error('mongo down'), host)

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    })
  })

  it('RabbitMQ: ném lại NGUYÊN lỗi để retryThenDeadLetter nhận đúng loại lỗi', () => {
    const error = new NonRetryableError('version 99 chưa hỗ trợ')

    expect(() => {
      filter.catch(error, rmqHost)
    }).toThrow(error)
  })
})
