import {
  conversationIdFromRoom,
  GroupCallStore,
  isGroupCallId,
  roomNameFor,
} from './group-call.store'

/**
 * Redis giả trong bộ nhớ: đủ cho string (get/set với NX), hash (hset/hdel/hgetall)
 * và set (sadd/smembers) mà store dùng, để kiểm logic phiên (một hội thoại một
 * phòng, con trỏ callId, đếm người từng vào, đóng phòng đúng một lần) không cần
 * Redis thật.
 */
class FakeRedis {
  private strings = new Map<string, string>()
  private hashes = new Map<string, Map<string, string>>()
  private sets = new Map<string, Set<string>>()

  get(key: string) {
    return Promise.resolve(this.strings.get(key) ?? null)
  }

  set(key: string, value: string, ...args: unknown[]) {
    // ...'EX', ttl, 'NX' — chỉ mô phỏng NX (bỏ qua TTL trong test).
    const nx = args.some((a) => String(a).toUpperCase() === 'NX')
    if (nx && this.strings.has(key)) return Promise.resolve(null)
    this.strings.set(key, value)
    return Promise.resolve('OK')
  }

  del(...keys: string[]) {
    let removed = 0
    for (const key of keys) {
      if (this.strings.delete(key)) removed++
      this.hashes.delete(key)
      this.sets.delete(key)
    }
    return Promise.resolve(removed)
  }

  expire() {
    return Promise.resolve(1)
  }

  hset(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    hash.set(field, value)
    this.hashes.set(key, hash)
    return Promise.resolve(1)
  }

  hdel(key: string, field: string) {
    return Promise.resolve(this.hashes.get(key)?.delete(field) ? 1 : 0)
  }

  hgetall(key: string) {
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []))
  }

  sadd(key: string, member: string) {
    const set = this.sets.get(key) ?? new Set<string>()
    const had = set.has(member)
    set.add(member)
    this.sets.set(key, set)
    return Promise.resolve(had ? 0 : 1)
  }

  smembers(key: string) {
    return Promise.resolve(Array.from(this.sets.get(key) ?? []))
  }
}

describe('group-call.store', () => {
  let store: GroupCallStore

  const members = [
    { id: 'alice', username: 'Alice' },
    { id: 'bob', username: 'Bob' },
  ]

  beforeEach(() => {
    store = new GroupCallStore(new FakeRedis() as never)
  })

  it('roomName ổn định theo hội thoại, và giải ngược được', () => {
    expect(roomNameFor('c1')).toBe('conv_c1')
    expect(conversationIdFromRoom('conv_c1')).toBe('c1')
    expect(conversationIdFromRoom('lobby')).toBeNull()
  })

  it('một hội thoại chỉ một phòng: getOrCreate lần hai trả đúng phiên cũ', async () => {
    const first = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'alice',
      members,
    })
    const second = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'bob',
      members,
    })

    expect(isGroupCallId(first.callId)).toBe(true)
    expect(second.callId).toBe(first.callId)
    expect(first.roomName).toBe('conv_c1')
    expect(first.startedBy).toBe('alice')
    // callType mặc định audio khi không truyền.
    expect(first.callType).toBe('audio')
  })

  it('callType được lưu và trả lại', async () => {
    const created = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'alice',
      members,
      callType: 'video',
    })
    expect(created.callType).toBe('video')
    expect((await store.getByConversationId('c1'))?.callType).toBe('video')
  })

  it('tra ngược callId -> phiên, và participant/seen cập nhật đúng', async () => {
    const created = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'alice',
      members,
    })

    expect((await store.getByCallId(created.callId))?.conversationId).toBe('c1')

    await store.addParticipant('c1', { id: 'alice', username: 'Alice' })
    await store.addParticipant('c1', { id: 'bob', username: 'Bob' })
    // Alice rời rồi vào lại: participants còn 1, nhưng "seen" vẫn đếm 2 người.
    await store.removeParticipant('c1', 'alice')
    const afterRejoin = await store.addParticipant('c1', {
      id: 'alice',
      username: 'Alice',
    })

    expect(GroupCallStore.participantList(afterRejoin!)).toHaveLength(2)
    expect(afterRejoin!.seen.sort()).toEqual(['alice', 'bob'])
  })

  it('finish đóng phòng đúng một lần: lời gọi thứ hai trả null', async () => {
    const created = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'alice',
      members,
    })
    await store.addParticipant('c1', { id: 'alice', username: 'Alice' })
    await store.addParticipant('c1', { id: 'bob', username: 'Bob' })

    const finished = await store.finish('c1')
    expect(finished?.callId).toBe(created.callId)
    // seen giữ để đếm "N người" khi ghi log.
    expect(finished?.seen.sort()).toEqual(['alice', 'bob'])

    // Webhook room_finished trùng: không còn phiên để ghi log lần hai.
    expect(await store.finish('c1')).toBeNull()
    expect(await store.getByConversationId('c1')).toBeNull()
    expect(await store.getByCallId(created.callId)).toBeNull()
  })

  it('delete dọn cả phiên lẫn con trỏ callId', async () => {
    const created = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'alice',
      members,
    })

    await store.delete('c1')

    expect(await store.getByConversationId('c1')).toBeNull()
    expect(await store.getByCallId(created.callId)).toBeNull()
  })

  it('isMember dựa trên danh sách thành viên đã lưu', async () => {
    const session = await store.getOrCreate({
      conversationId: 'c1',
      startedBy: 'alice',
      members,
    })

    expect(GroupCallStore.isMember(session, 'bob')).toBe(true)
    expect(GroupCallStore.isMember(session, 'stranger')).toBe(false)
  })
})
