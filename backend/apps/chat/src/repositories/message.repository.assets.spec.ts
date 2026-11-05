import { MessageRepository } from './message.repository'

const CONV = '6a35000000000000000c0001'

type AssetRow = {
  id: string
  isRevoked: boolean
  type: string
}

const ROWS: AssetRow[] = [
  { id: 'm1', isRevoked: false, type: 'IMAGE' },
  { id: 'm2', isRevoked: true, type: 'IMAGE' },
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
        const where = args.where as { isRevoked?: boolean }
        return Promise.resolve(
          ROWS.filter(
            (row) =>
              where.isRevoked === undefined ||
              row.isRevoked === where.isRevoked,
          ),
        )
      }),
    },
  }
}

/**
 * Ảnh đã "thu hồi với mọi người" vẫn nằm nguyên trong tab Ảnh/Video và trong
 * trình xem ảnh, vì truy vấn từng chỉ lọc `isDeleted`. Thu hồi mà bức ảnh vẫn xem
 * được đầy màn hình thì không phải là thu hồi.
 */
describe('MessageRepository.findConversationAssets', () => {
  it('bỏ tin đã thu hồi', async () => {
    const seen: { where?: Record<string, unknown> } = {}
    const repo = new MessageRepository(fakePrisma(seen) as never, {} as never)

    const rows = await repo.findConversationAssets(CONV, 'MEDIA', 20, null)

    expect(seen.where).toMatchObject({ isRevoked: false })
    // isDeleted không bao giờ được đặt true: lọc theo nó chỉ là rác.
    expect(seen.where).not.toHaveProperty('isDeleted')
    expect(rows.map((row) => (row as unknown as AssetRow).id)).toEqual(['m1'])
  })
})
