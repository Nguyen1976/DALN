import { CallBusyStore } from './call-busy.store'

/**
 * Redis giả: string với SET NX, GET, và EVAL cho hai script CAS của store
 * (release = del khi khớp callId, refresh = expire khi khớp callId).
 */
class FakeRedis {
  private m = new Map<string, string>()

  set(key: string, value: string, ...args: unknown[]) {
    const nx = args.some((a) => String(a).toUpperCase() === 'NX')
    if (nx && this.m.has(key)) return Promise.resolve(null)
    this.m.set(key, value)
    return Promise.resolve('OK')
  }
  get(key: string) {
    return Promise.resolve(this.m.get(key) ?? null)
  }
  eval(script: string, _numkeys: number, key: string, arg: string) {
    const matches = this.m.get(key) === arg
    if (script.includes('del')) {
      if (matches) {
        this.m.delete(key)
        return Promise.resolve(1)
      }
      return Promise.resolve(0)
    }
    if (script.includes('expire')) return Promise.resolve(matches ? 1 : 0)
    return Promise.resolve(0)
  }
}

describe('call-busy.store', () => {
  let store: CallBusyStore

  beforeEach(() => {
    store = new CallBusyStore(new FakeRedis() as never)
  })

  it('acquire: lần đầu được, cùng callId idempotent, callId khác thì bận', async () => {
    expect(await store.acquire('u1', 'call-A')).toBe(true)
    expect(await store.acquire('u1', 'call-A')).toBe(true)
    expect(await store.acquire('u1', 'call-B')).toBe(false)
  })

  it('isBusy: đúng, và loại trừ chính callId của mình', async () => {
    await store.acquire('u1', 'call-A')
    expect(await store.isBusy('u1')).toBe(true)
    expect(await store.isBusy('u1', 'call-A')).toBe(false)
    expect(await store.isBusy('u2')).toBe(false)
  })

  it('release: chỉ mở khoá khi đúng callId (không lỡ mở hộ cuộc khác)', async () => {
    await store.acquire('u1', 'call-A')
    await store.release('u1', 'call-B')
    expect(await store.isBusy('u1')).toBe(true)
    await store.release('u1', 'call-A')
    expect(await store.isBusy('u1')).toBe(false)
    // Sau khi mở khoá, người này acquire cuộc mới được.
    expect(await store.acquire('u1', 'call-C')).toBe(true)
  })
})
