import {
  conversationIdFromRoom,
  GroupCallStore,
  isGroupCallId,
  roomNameFor,
} from './group-call.store'

/**
 * Redis giả trong bộ nhớ: đủ cho get/set/del mà store dùng, để kiểm logic phiên
 * (một hội thoại một phòng, con trỏ callId, đếm người từng vào) không cần Redis thật.
 */
class FakeRedis {
  private store = new Map<string, string>()

  async get(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  async set(key: string, value: string) {
    this.store.set(key, value)
    return 'OK'
  }

  async del(key: string) {
    return this.store.delete(key) ? 1 : 0
  }
}

describe('group-call.store', () => {
  let store: GroupCallStore

  const members = [
    { id: 'alice', username: 'Alice' },
    { id: 'bob', username: 'Bob' },
  ]

  beforeEach(() => {
    store = new GroupCallStore(new FakeRedis())
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
