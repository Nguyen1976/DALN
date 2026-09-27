import { CallSessionStore } from './call-session.store'

class MemRedis {
  m = new Map<string, string>()
  get(k: string) {
    return Promise.resolve(this.m.get(k) ?? null)
  }
  set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.m.has(k)) return Promise.resolve(null)
    if (args.includes('XX') && !this.m.has(k)) return Promise.resolve(null)
    this.m.set(k, v)
    return Promise.resolve('OK')
  }
  del(...keys: string[]) {
    let n = 0
    for (const k of keys) if (this.m.delete(k)) n++
    return Promise.resolve(n)
  }
}

describe('CallSessionStore', () => {
  const CALL_ID = '11111111-2222-4333-8444-555555555555'

  it('releaseAccept nhả claim để tab khác nhận được', async () => {
    const store = new CallSessionStore(new MemRedis() as never)
    expect(await store.claimAccept(CALL_ID, 'sock-a')).toBe(true)
    expect(await store.claimAccept(CALL_ID, 'sock-b')).toBe(false)
    await store.releaseAccept(CALL_ID)
    expect(await store.claimAccept(CALL_ID, 'sock-b')).toBe(true)
  })

  it('rtkGrants được lưu và đọc lại cùng phiên', async () => {
    const store = new CallSessionStore(new MemRedis() as never)
    const grant = {
      meetingId: 'm1',
      participantId: 'p1',
      customParticipantId: 'u1.aa',
    }
    await store.create({
      callId: CALL_ID,
      callerId: 'u1',
      calleeId: 'u2',
      conversationId: 'c1',
      status: 'ringing',
      callType: 'audio',
      startedAt: 1,
      rtkGrants: [grant],
    })
    expect((await store.get(CALL_ID))?.rtkGrants).toEqual([grant])
  })

  it('markConnected không dựng lại phiên đã kết thúc (bên kia cúp máy giữa chừng)', async () => {
    const store = new CallSessionStore(new MemRedis() as never)
    const session = {
      callId: CALL_ID,
      callerId: 'u1',
      calleeId: 'u2',
      conversationId: 'c1',
      status: 'ringing' as const,
      callType: 'audio' as const,
      startedAt: 1,
    }
    await store.create(session)
    expect(await store.markConnected(session)).not.toBeNull()

    await store.end(CALL_ID)
    expect(await store.markConnected(session)).toBeNull()
    expect(await store.get(CALL_ID)).toBeNull()
  })
})
