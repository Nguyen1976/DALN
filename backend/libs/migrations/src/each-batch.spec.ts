import { ObjectId } from 'mongodb'
import { createEachBatch } from './each-batch'
import { FakeDb, type FakeDoc } from './testing/fake-db'
import { memoryCheckpoint } from './testing/helpers'

/** n ObjectId tăng dần, cố định giữa các lần chạy. */
const ascendingIds = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    ObjectId.createFromTime(1_700_000_000 + i),
  )

function setup(docs: FakeDoc[], initialCheckpoint?: unknown) {
  const db = new FakeDb()
  db.collection('items').seed(...docs)
  const checkpoint = memoryCheckpoint(initialCheckpoint)
  const sleep = jest.fn((ms: number) => {
    void ms
    return Promise.resolve()
  })
  const controller = new AbortController()
  const eachBatch = createEachBatch({
    db: db.asDb(),
    checkpoint,
    sleep,
    signal: controller.signal,
  })
  return { eachBatch, checkpoint, sleep, controller }
}

const idsOf = (docs: { _id: unknown }[]) => docs.map((doc) => String(doc._id))

describe('eachBatch', () => {
  it('duyệt theo _id tăng dần, đúng kích thước lô, lưu _id cuối sau mỗi lô', async () => {
    const ids = ascendingIds(5)
    const { eachBatch, checkpoint } = setup(
      [ids[3], ids[0], ids[4], ids[1], ids[2]].map((_id) => ({ _id })),
    )
    const batches: string[][] = []

    const result = await eachBatch(
      { collection: 'items', batchSize: 2 },
      (docs) => {
        batches.push(idsOf(docs))
        return Promise.resolve()
      },
    )

    expect(batches).toEqual([
      [String(ids[0]), String(ids[1])],
      [String(ids[2]), String(ids[3])],
      [String(ids[4])],
    ])
    expect(result).toEqual({ batches: 3, docs: 5 })
    expect(
      checkpoint.set.mock.calls.map(([value]) =>
        String((value as { items: ObjectId }).items),
      ),
    ).toEqual([String(ids[1]), String(ids[3]), String(ids[4])])
  })

  it('chạy lại sau khi lỗi giữa chừng: tiếp từ checkpoint, không làm lại lô đã xong', async () => {
    const ids = ascendingIds(5)
    const { eachBatch, checkpoint } = setup(ids.map((_id) => ({ _id })))
    const seen: string[] = []
    let calls = 0

    await expect(
      eachBatch({ collection: 'items', batchSize: 2 }, (docs) => {
        calls += 1
        if (calls === 2) return Promise.reject(new Error('dừng giữa chừng'))
        seen.push(...idsOf(docs))
        return Promise.resolve()
      }),
    ).rejects.toThrow('dừng giữa chừng')
    expect(String((checkpoint.peek() as { items: ObjectId }).items)).toBe(
      String(ids[1]),
    )

    await eachBatch({ collection: 'items', batchSize: 2 }, (docs) => {
      seen.push(...idsOf(docs))
      return Promise.resolve()
    })

    expect(seen).toEqual(ids.map(String))
  })

  it('chạy tiếp vẫn giữ filter, và không đụng checkpoint của collection khác', async () => {
    const ids = ascendingIds(6)
    const { eachBatch, checkpoint } = setup(
      ids.map((_id, i) => ({ _id, keep: i % 2 === 0 })),
      { other: 'giữ nguyên', items: ids[1] },
    )
    const seen: string[] = []

    await eachBatch(
      { collection: 'items', filter: { keep: true }, batchSize: 10 },
      (docs) => {
        seen.push(...idsOf(docs))
        return Promise.resolve()
      },
    )

    expect(seen).toEqual([String(ids[2]), String(ids[4])])
    expect(checkpoint.peek()).toEqual({ other: 'giữ nguyên', items: ids[4] })
  })

  it('nghỉ pauseMs giữa các lô, không nghỉ sau lô cuối chưa đầy', async () => {
    const { eachBatch, sleep } = setup(ascendingIds(5).map((_id) => ({ _id })))

    await eachBatch({ collection: 'items', batchSize: 2, pauseMs: 250 }, () =>
      Promise.resolve(),
    )

    expect(sleep.mock.calls).toEqual([[250], [250]])
  })

  it('bị huỷ (SIGTERM, mất lock) -> dừng trước lô kế tiếp', async () => {
    const { eachBatch, controller } = setup(
      ascendingIds(4).map((_id) => ({ _id })),
    )
    let batches = 0

    await expect(
      eachBatch({ collection: 'items', batchSize: 1 }, () => {
        batches += 1
        controller.abort(new Error('Bị dừng bởi SIGTERM'))
        return Promise.resolve()
      }),
    ).rejects.toThrow('Bị dừng bởi SIGTERM')
    expect(batches).toBe(1)
  })

  it('projection bỏ mất _id hoặc batchSize sai -> báo lỗi', async () => {
    const { eachBatch } = setup(ascendingIds(2).map((_id) => ({ _id, a: 1 })))
    const noop = () => Promise.resolve()

    await expect(
      eachBatch({ collection: 'items', projection: { _id: 0, a: 1 } }, noop),
    ).rejects.toThrow('projection phải giữ lại _id')
    await expect(
      eachBatch({ collection: 'items', batchSize: 0 }, noop),
    ).rejects.toThrow('batchSize')
  })
})
