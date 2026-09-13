import { Nack } from '@golevelup/nestjs-rabbitmq'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { lastValueFrom, of } from 'rxjs'
import { ResponseInterceptor } from './response.interceptor'

function context(type: string, url = '/x', statusCode = 200) {
  return {
    getType: () => type,
    switchToHttp: () => ({
      getResponse: () => ({ statusCode }),
      getRequest: () => ({ url }),
    }),
  } as unknown as ExecutionContext
}

const handler = (value: unknown): CallHandler => ({ handle: () => of(value) })

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor()

  it('HTTP: bọc kết quả thành { statusCode, status, data }', async () => {
    const out = await lastValueFrom(
      interceptor.intercept(context('http', '/users', 201), handler({ id: 1 })),
    )

    expect(out).toEqual(
      expect.objectContaining({
        statusCode: 201,
        status: 'success',
        data: { id: 1 },
      }),
    )
  })

  it('HTTP /metrics: trả nguyên văn, không bọc JSON', async () => {
    const out = await lastValueFrom(
      interceptor.intercept(context('http', '/metrics'), handler('# metrics')),
    )

    expect(out).toBe('# metrics')
  })

  it('RabbitMQ: trả NGUYÊN giá trị handler để golevelup quyết định ack/nack', async () => {
    const nack = new Nack(false)

    const out = await lastValueFrom(
      interceptor.intercept(context('rmq'), handler(nack)),
    )

    expect(out).toBe(nack)
  })
})
