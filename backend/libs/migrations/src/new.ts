import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { MIGRATION_FILE } from './discovery'
import { DEFAULT_MIGRATIONS_DIR, findService, SERVICES } from './services'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Số kế tiếp = số lớn nhất đang có + 1, đệm 4 chữ số. */
export function nextMigrationId(dir: string, slug: string): string {
  const numbers = existsSync(dir)
    ? readdirSync(dir)
        .map((file) => MIGRATION_FILE.exec(file)?.[1])
        .filter((n): n is string => Boolean(n))
        .map(Number)
    : []
  const next = Math.max(0, ...numbers) + 1
  return `${String(next).padStart(4, '0')}-${slug}`
}

export function renderTemplate(id: string, service: string): string {
  return [
    `import type { Migration } from '@app/migrations'`,
    ``,
    `// TODO: migration này làm gì và vì sao cần.`,
    `//`,
    `// Quy tắc (chi tiết: backend/MIGRATIONS.md):`,
    `// - IDEMPOTENT: chạy lại bao nhiêu lần cũng ra cùng kết quả. Lọc đúng những`,
    `//   document còn cần sửa; không $inc/$push mù.`,
    `// - Tôn trọng ctx.dryRun: khi true chỉ đọc và ctx.log, KHÔNG ghi gì.`,
    `// - Chỉ đụng DB của chính service ${service} (ctx.db). Bản sao dữ liệu nằm ở`,
    `//   service khác thì đồng bộ lại bằng event, không ghi thẳng sang DB khác`,
    `//   (xem migrations/user/0002-resync-user-copies.ts).`,
    `// - Đã chạy ở prod thì KHÔNG sửa file này nữa: checksum lệch và migrate:up`,
    `//   sẽ từ chối chạy. Muốn đổi gì thì viết migration mới.`,
    `// - Đổi tên / xoá field: expand -> migrate -> contract, không làm một phát.`,
    `//`,
    `// mode:`,
    `// - 'deploy' (mặc định): chạy trước khi app mới lên. Phải nhanh.`,
    `// - 'background': chạy sau khi app đã lên. Việc dài thì dùng ctx.eachBatch`,
    `//   (chạy theo lô, bị dừng thì lần sau làm tiếp từ checkpoint).`,
    `// - 'manual': chỉ chạy tay: npm run migrate:run -- ${id} --service ${service}`,
    `const migration: Migration = {`,
    `  id: '${id}',`,
    `  description: 'TODO: mô tả ngắn',`,
    `  mode: 'deploy',`,
    `  async up(ctx) {`,
    `    // Ví dụ:`,
    `    // const coll = ctx.db.collection('tenCollection')`,
    `    // const filter = { newField: { $exists: false } }`,
    `    // if (ctx.dryRun) {`,
    `    //   ctx.log(\`\${await coll.countDocuments(filter)} document sẽ được cập nhật\`)`,
    `    //   return`,
    `    // }`,
    `    // const res = await coll.updateMany(filter, { $set: { newField: 0 } })`,
    `    // ctx.log(\`Đã cập nhật \${res.modifiedCount} document\`)`,
    `    throw new Error('Chưa viết migration ${id} (ctx.db: ' + ctx.db.databaseName + ')')`,
    `  },`,
    `}`,
    ``,
    `export default migration`,
    ``,
  ].join('\n')
}

/** Tạo file migration kế tiếp cho service, trả về đường dẫn file. */
export function createMigrationFile(
  migrationsDir: string,
  service: string,
  slug: string,
): string {
  if (!findService(service)) {
    throw new Error(
      `Service không tồn tại: ${service} (hợp lệ: ${SERVICES.map((s) => s.name).join(', ')})`,
    )
  }
  if (!SLUG.test(slug)) {
    throw new Error(
      `Slug '${slug}' không hợp lệ: chỉ chữ thường, số và gạch ngang (vd add-last-seen-index)`,
    )
  }
  const dir = join(migrationsDir, service)
  const id = nextMigrationId(dir, slug)
  const file = join(dir, `${id}.ts`)
  mkdirSync(dir, { recursive: true })
  // flag 'wx': không bao giờ ghi đè file có sẵn.
  writeFileSync(file, renderTemplate(id, service), { flag: 'wx' })
  return file
}

if (require.main === module) {
  const [service, slug, ...extra] = process.argv.slice(2)
  if (!service || !slug || extra.length) {
    process.stderr.write(
      'Cách dùng: npm run migrate:new -- <service> <slug>\n' +
        `  <service>: ${SERVICES.map((s) => s.name).join(' | ')}\n` +
        '  vd: npm run migrate:new -- chat add-pinned-at\n',
    )
    process.exitCode = 2
  } else {
    try {
      const file = createMigrationFile(DEFAULT_MIGRATIONS_DIR, service, slug)
      process.stdout.write(
        `[migrate] Đã tạo ${relative(process.cwd(), file)}\n`,
      )
    } catch (error) {
      process.stderr.write(
        `[migrate] ${error instanceof Error ? error.message : String(error)}\n`,
      )
      process.exitCode = 1
    }
  }
}
