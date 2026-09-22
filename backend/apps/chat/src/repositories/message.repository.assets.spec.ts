import { MessageRepository } from './message.repository'

const CONV = '6a35000000000000000c0001'

type AssetRow = {
  id: string
  isDeleted: boolean
  isRevoked: boolean
  type: string
}

const ROWS: AssetRow[] = [
  { id: 'm1', isDeleted: false, isRevoked: false, type: 'IMAGE' },
  { id: 'm2', isDeleted: false, isRevoked: true, type: 'IMAGE' },
  { id: 'm3', isDeleted: true, isRevoked: false, type: 'IMAGE' },
]

/**
 * Chỉ đo phần lọc: trả về những hàng khớp các điều kiện `where` mà repo gửi
 * xuống, thay vì dựng cả Prisma.
 */
function fakePrisma(seen: { where?: Record<string, unknown> }) {
  return {
    message: {
      findMany: jest.fn((args: { where: Record<string, unknown> }) => {
        seen.where = args.where
        const where = args.where as {
          isDeleted?: boolean
          isRevoked?: boolean
        }
        return Promise.resolve(
          ROWS.filter(
            (row) =>
              row.isDeleted === where.isDeleted &&
              (where.isRevoked === undefined ||
                row.isRevoked === where.isRevoked),
          ),
        )
      }),
    },
  }
}

/**
 * Ảnh đã "thu hồi với mọi người" vẫn nằm nguyên trong tab Ảnh/Video và trong
 * trình xem ảnh, vì truy vấn chỉ lọc `isDeleted`. Thu hồi mà bức ảnh vẫn xem
 * được đầy màn hình thì không phải là thu hồi.
 */
describe('MessageRepository.findConversationAssets', () => {
  it('bỏ tin đã thu hồi cũng như tin đã xoá', async () => {
    const seen: { where?: Record<string, unknown> } = {}
    const repo = new MessageRepository(fakePrisma(seen) as never, {} as never)

    const rows = await repo.findConversationAssets(CONV, 'MEDIA', 20)

    expect(seen.where).toMatchObject({ isDeleted: false, isRevoked: false })
    expect(rows.map((row) => (row as unknown as AssetRow).id)).toEqual(['m1'])
  })
})
