import { resolveMentions } from './mention.resolver'

const ME = '6a35000000000000000a0001'
const ALICE = '6a35000000000000000a0002'
const BINH = '6a35000000000000000a0003'
const NOUSER = '6a35000000000000000a0004'

const members = [
  { userId: ME, username: 'me', fullName: 'Chính Tôi' },
  { userId: ALICE, username: 'alice', fullName: 'Alice Smith' },
  { userId: BINH, username: 'binh.tran', fullName: 'Nguyễn Văn Bình' },
  { userId: NOUSER, username: '', fullName: 'Lê Thị Hoa' },
]

describe('resolveMentions', () => {
  it('bắt @username thường', () => {
    const r = resolveMentions('chào @alice nhé', members, ME)
    expect(r.userIds).toEqual([ALICE])
    expect(r.mentions).toEqual([{ userId: ALICE, label: 'alice' }])
  })

  it('bắt tên tiếng Việt CÓ DẤU và CÓ KHOẢNG TRẮNG', () => {
    const r = resolveMentions('@Nguyễn Văn Bình xem giúp', members, ME)
    expect(r.userIds).toEqual([BINH])
    expect(r.mentions[0].label).toBe('Nguyễn Văn Bình')
  })

  it('bắt được người không có username (chỉ fullName)', () => {
    const r = resolveMentions('gửi @Lê Thị Hoa', members, ME)
    expect(r.userIds).toEqual([NOUSER])
  })

  it('KHÔNG tự nhắc chính mình', () => {
    expect(resolveMentions('@me ping', members, ME).userIds).toEqual([])
  })

  it('KHÔNG nhắc người ngoài danh sách thành viên', () => {
    expect(resolveMentions('@nguoila hi', members, ME).userIds).toEqual([])
  })

  it('bỏ trùng khi tag một người nhiều lần', () => {
    const r = resolveMentions('@alice và @alice nữa', members, ME)
    expect(r.userIds).toEqual([ALICE])
    expect(r.mentions).toHaveLength(1)
  })

  it('gõ tay (không chọn dropdown) vẫn tính là mention', () => {
    // client không gửi id nào — server tự suy từ text
    expect(resolveMentions('@binh.tran ơi', members, ME).userIds).toEqual([BINH])
  })

  it('KHÔNG ăn nhầm trong email', () => {
    expect(resolveMentions('mail me@alice.com nhé', members, ME).userIds).toEqual([])
  })

  it('KHÔNG khớp một phần (prefix) của tên', () => {
    expect(resolveMentions('@ali chưa đủ', members, ME).userIds).toEqual([])
  })

  it('ưu tiên khớp DÀI nhất', () => {
    const two = [
      { userId: ALICE, username: 'an', fullName: 'An' },
      { userId: BINH, username: 'an.tran', fullName: 'An Trần' },
    ]
    const r = resolveMentions('@an.tran xem', two, ME)
    expect(r.userIds).toEqual([BINH])
  })

  it('@all nhắc mọi thành viên trừ người gửi', () => {
    const r = resolveMentions('@all họp nhé', members, ME)
    expect(r.userIds.sort()).toEqual([ALICE, BINH, NOUSER].sort())
    expect(r.mentions.some((m) => 'all' in m)).toBe(true)
  })

  it('@tất cả cũng là all', () => {
    expect(resolveMentions('@tất cả ơi', members, ME).userIds).toHaveLength(3)
  })

  it('text rỗng/null -> không có mention', () => {
    expect(resolveMentions(null, members, ME).userIds).toEqual([])
    expect(resolveMentions('   ', members, ME).userIds).toEqual([])
  })

  it('nhiều người trong một tin', () => {
    const r = resolveMentions('@alice @binh.tran cùng xem', members, ME)
    expect(r.userIds.sort()).toEqual([ALICE, BINH].sort())
  })
})
