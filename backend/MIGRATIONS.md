# Migration dữ liệu (MongoDB)

Prisma Migrate không hỗ trợ MongoDB. `prisma db push` (bước `db-push` mỗi lần
deploy) chỉ đồng bộ **collection + index**, không đụng tới dữ liệu. Muốn đổi
**dữ liệu** thì viết migration có version:

- File: `migrations/<service>/<NNNN>-<slug>.ts`, nằm ngoài `apps/` nên sửa
  migration không làm build lại image service.
- Chạy theo thứ tự tên file. `id` trong file phải trùng tên file (bỏ `.ts`).
- Mỗi DB service có ledger riêng, collection `_migrations`: một document mỗi
  migration (`status`, `checksum`, `appliedAt`, `durationMs`, `error`,
  `checkpoint`).
- Lock trong `_migrations_lock` (`_id: 'lock'`, hết hạn sau 10 phút, tự gia
  hạn khi đang chạy), nên hai lần migrate chạy cùng lúc thì một bên phải chờ.
- Code: `libs/migrations/src` (không phụ thuộc Nest, dùng driver `mongodb`).

## Lệnh

Chạy trong `backend/`. Qua npm thì MỌI cờ phải đứng SAU `--`. Thiếu `--` thì
npm nuốt cờ: `npm run migrate:up --dry-run` không truyền `--dry-run` tới CLI.
CLI thấy dấu vết đó (`npm_config_dry_run`...) thì dừng với exit 2, không chạy
gì.

| Lệnh                                                    | Việc                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run migrate:status -- [--service chat]`            | Bảng applied / pending / failed / changed theo service              |
| `npm run migrate:status -- --pending-count`             | Chỉ in MỘT số: số migration `deploy` chưa chạy (script deploy dùng) |
| `npm run migrate:up -- [--service chat] [--dry-run]`    | Chạy các migration `deploy` còn pending                             |
| `npm run migrate:background -- [--service chat]`        | Chạy các migration `background` còn pending                         |
| `npm run migrate:run -- <id> --service <s> [--dry-run]` | Chạy đúng một migration, kể cả `manual`                             |
| `npm run migrate:new -- <service> <slug>`               | Tạo file kế tiếp từ template                                        |

Không qua npm (vd trong image `schema`):
`npx ts-node --transpile-only -r tsconfig-paths/register libs/migrations/src/cli.ts <lệnh> [cờ]`.

Không có `--service` thì chạy lần lượt `user → chat → notification →
recommendation → saga-orchestrator`, dừng ở lỗi đầu tiên.

Mỗi migration in đúng một dòng: `[migrate] chat 0003-init-unread-count ...
applied in 12ms` (hoặc `skipped`, `dry-run`, `FAILED`).

Mã thoát: `0` thành công · `1` migration lỗi, file đã chạy bị sửa, lock bận,
file hỏng, không kết nối được · `2` sai cú pháp.

Env: `MONGO_HOST` (mặc định `mongo:27017`), `MONGO_REPLICA_SET` (mặc định
`rs0`), `MONGO_URL_TEMPLATE` (vd `mongodb://u:p@host:27017/{db}?authSource=admin`,
bắt buộc có `{db}`), `MIGRATE_LOCK_WAIT_MS` (chờ lock tối đa, mặc định 30000).

## Thêm một migration

```bash
npm run migrate:new -- chat add-pinned-at
# -> migrations/chat/0005-add-pinned-at.ts
```

Sửa file vừa tạo (template ném lỗi cho tới khi bạn viết xong), chạy thử với
`--dry-run` trên dev, viết test nếu logic không tầm thường (xem
`libs/migrations/src/migrations.spec.ts`), rồi commit.

Chọn `mode`:

| mode                | Khi nào chạy                            | Dùng cho                                           |
| ------------------- | --------------------------------------- | -------------------------------------------------- |
| `deploy` (mặc định) | Trong deploy, **trước** khi app mới lên | Dữ liệu mà code mới cần có sẵn. Phải nhanh.        |
| `background`        | Sau khi app đã lên                      | Backfill dài. Dùng `ctx.eachBatch`.                |
| `manual`            | Chỉ khi chạy `migrate:run`              | Việc tốn tải hoặc hiếm khi cần (vd resync bản sao) |

```ts
import type { Migration } from '@app/migrations'

const migration: Migration = {
  id: '0005-add-pinned-at',
  description: 'Đặt conversationMember.pinnedAt = null cho dòng cũ',
  mode: 'deploy',
  async up({ db, dryRun, log }) {
    const members = db.collection('conversationMember')
    const filter = { pinnedAt: { $exists: false } }
    if (dryRun) {
      log(`${await members.countDocuments(filter)} dòng sẽ được cập nhật`)
      return
    }
    const res = await members.updateMany(filter, { $set: { pinnedAt: null } })
    log(`Đã cập nhật ${res.modifiedCount} dòng`)
  },
}

export default migration
```

## Quy tắc

1. **Idempotent.** Chạy lại bao nhiêu lần cũng ra cùng kết quả. Lọc đúng những
   document còn cần sửa, không `$inc`/`$push` mù. Migration lỗi hoặc bị dừng
   giữa chừng sẽ được chạy lại từ đầu (hoặc từ checkpoint).
2. **Tôn trọng `ctx.dryRun`.** Khi `true` chỉ đọc và `ctx.log`, không ghi gì.
   Runner cũng không ghi ledger, không lấy lock.
3. **Không sửa migration đã chạy.** Checksum (sha256 nội dung file) nằm trong
   ledger. File đã `applied` mà bị sửa thì `status` báo `changed`, còn
   `up`/`background`/`run` từ chối chạy (exit 1) ở MỌI service. Muốn đổi thì
   hoàn tác file và viết migration mới. Migration còn `failed` thì sửa được.
4. **Chỉ DB của chính service** (`ctx.db`). Không bao giờ ghi sang DB của
   service khác, kể cả khi chỉ là sửa bản sao.
5. **Đổi tên / xoá field: expand → migrate → contract**, qua nhiều release,
   không làm một phát. Lúc deploy, container cũ và mới cùng chạy, và rollback
   phải còn đọc được dữ liệu.
6. **Backfill dài dùng `mode: 'background'` + `ctx.eachBatch`**, có
   `pauseMs` để nhường tải cho app. Bị dừng (SIGTERM, lỗi) thì lần sau làm
   tiếp từ checkpoint.

### Ví dụ expand → migrate → contract: `conversation.groupAvatar` → `avatarUrl`

**Release 1 — expand.** Schema thêm `avatarUrl String?`, vẫn giữ
`groupAvatar`. Code ghi CẢ HAI field và đọc `avatarUrl ?? groupAvatar`. Kèm
một migration background chép dữ liệu cũ:

```ts
// migrations/chat/0006-copy-group-avatar-to-avatar-url.ts
const migration: Migration = {
  id: '0006-copy-group-avatar-to-avatar-url',
  description: 'Chép conversation.groupAvatar sang avatarUrl',
  mode: 'background',
  async up({ db, dryRun, eachBatch }) {
    const conversations = db.collection('conversation')
    await eachBatch(
      {
        collection: 'conversation',
        filter: {
          groupAvatar: { $type: 'string' },
          avatarUrl: { $exists: false },
        },
        projection: { groupAvatar: 1 },
        batchSize: 500,
        pauseMs: 200,
      },
      async (docs) => {
        if (dryRun) return
        await conversations.bulkWrite(
          docs.map((doc) => ({
            updateOne: {
              // Điều kiện lặp lại trong filter -> idempotent, không đè giá trị app vừa ghi.
              filter: { _id: doc._id, avatarUrl: { $exists: false } },
              update: { $set: { avatarUrl: doc.groupAvatar } },
            },
          })),
        )
      },
    )
  },
}
```

**Release 2 — migrate xong.** Khi `migrate:status` trên prod báo `0006`
`applied`, code chỉ còn đọc và ghi `avatarUrl`.

**Release 3 — contract.** Xoá `groupAvatar` khỏi schema. Nếu muốn dọn dữ liệu
thừa thì thêm migration `$unset: { groupAvatar: '' }`, mode `background`.

## Bản sao ở service khác: đồng bộ lại bằng event

chat (`conversationMember.fullName/avatar`, `peer*`) và recommendation
(`userSnapshot`) giữ bản sao hồ sơ user. Khi bản sao lệch, KHÔNG sửa DB của
họ. Service sở hữu dữ liệu phát lại event qua outbox của chính mình, consumer
tự cập nhật:

```bash
npm run migrate:run -- 0002-resync-user-copies --service user --dry-run   # xem trước
npm run migrate:run -- 0002-resync-user-copies --service user
```

`migrations/user/0002-resync-user-copies.ts` (mode `manual`) xếp một event
`USER_UPDATED` cho mỗi user vào `OutboxEvent` của user-service, đúng hình dạng
`enqueueOutbox` ghi. `OutboxRelay` publish, `chat` và `recommendation` làm mới
bản sao. messageId cố định theo user nên chạy lại không sinh trùng. Chèn 100
event mỗi 5 giây để event saga thật không phải xếp hàng sau. Muốn resync lần
nữa thì tạo migration mới cùng kiểu (migration đã applied không chạy lại).

## Đổi contract của event

Đổi hình dạng payload thì tăng header `x-event-version`. Consumer phải chấp
nhận CẢ phiên bản cũ lẫn mới trước; chỉ khi consumer mới đã deploy khắp nơi
thì producer mới được gửi phiên bản mới. Bỏ nhánh xử lý phiên bản cũ ở release
sau đó.

## Thứ tự trong deploy

```
db-push  ->  migrate (up, mode deploy)  ->  apps  ->  migrate-background
```

- `migrate` lỗi (exit 1) thì app mới không lên.
- Trước khi deploy, nếu `migrate:status -- --pending-count` > 0 thì một bản
  `mongodump` được tạo tự động.
- `migrate-background` chạy song song với app. Nhận SIGTERM thì dừng sau lô
  hiện tại, ghi ledger `failed`, nhả lock. Lần sau chạy tiếp từ checkpoint.
- Lock là theo DB và dùng chung cho mọi lệnh: đang có `background` chạy trên
  một DB thì `up` của DB đó chờ tối đa `MIGRATE_LOCK_WAIT_MS` rồi báo bận.
  `deploy/deploy.sh` tự dừng êm `migrate-background` cũ trước bước migrate;
  chạy `migrate up` bằng tay thì dừng nó trước (`dc stop migrate-background`).

## Chạy local với stack dev

Mongo dev nghe ở `localhost:27017` (replica set `rs0`). Replica set quảng bá
host `mongo:27017`, máy ngoài docker không phân giải được, nên với
`localhost` CLI tự kết nối thẳng (`directConnection=true`).

```bash
MONGO_HOST=localhost:27017 npm run migrate:status
MONGO_HOST=localhost:27017 npm run migrate:up -- --dry-run
MONGO_HOST=localhost:27017 npm run migrate:up -- --service chat
```

## Khi có sự cố

- **`FAILED`:** xem `error` trong `_migrations` (hoặc `migrate:status`). Sửa
  dữ liệu hay sửa migration (được, vì nó chưa `applied`), rồi chạy lại.
- **`changed`:** ai đó đã sửa file migration đã chạy. Hoàn tác file đó và viết
  migration mới.
- **Lock bận:** thông báo có tên người giữ và giờ hết hạn. Tiến trình giữ lock
  đã chết thì chờ lock hết hạn (tối đa 10 phút). Chỉ xoá tay
  `db._migrations_lock.deleteOne({ _id: 'lock' })` khi chắc chắn không còn lần
  migrate nào đang chạy.
