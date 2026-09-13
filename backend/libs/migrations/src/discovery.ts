import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIGRATION_MODES } from './types'
import type { Migration, MigrationMode } from './types'

/** `NNNN-slug.ts`, slug chữ thường/số nối bằng gạch ngang. */
export const MIGRATION_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/

export interface LoadedMigration {
  id: string
  /** Đường dẫn tuyệt đối tới file. */
  file: string
  description: string
  mode: MigrationMode
  checksum: string
  up: Migration['up']
}

export class MigrationLoadError extends Error {
  override name = 'MigrationLoadError'
}

/**
 * sha256 nội dung file. Chuẩn hoá CRLF -> LF để checkout trên Windows không
 * làm mọi migration "bị sửa".
 */
export function checksumOf(source: string | Buffer): string {
  const text = source.toString().replace(/\r\n/g, '\n')
  return createHash('sha256').update(text).digest('hex')
}

function requireFile(file: string): unknown {
  // Nạp đồng bộ qua require: chạy dưới ts-node (CLI) hay jest đều có hook
  // biên dịch .ts sẵn. import() động sẽ đi đường ESM và không hiểu .ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(file) as unknown
}

function pickExport(mod: unknown): unknown {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    return (mod as { default: unknown }).default
  }
  return mod
}

/**
 * Nạp mọi migration của một service, sắp theo tên file. File sai tên, trùng
 * số thứ tự, thiếu default export hay id lệch tên file đều là lỗi — thà dừng
 * còn hơn lặng lẽ bỏ qua một migration.
 */
export function loadMigrations(
  migrationsDir: string,
  service: string,
  load: (file: string) => unknown = requireFile,
): LoadedMigration[] {
  const dir = join(migrationsDir, service)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.d.ts') &&
        !file.endsWith('.spec.ts'),
    )
    .sort()

  const byNumber = new Map<string, string>()
  return files.map((file) => {
    const where = `migrations/${service}/${file}`
    const match = MIGRATION_FILE.exec(file)
    if (!match) {
      throw new MigrationLoadError(
        `${where}: tên file phải có dạng NNNN-slug.ts (vd 0003-init-unread-count.ts)`,
      )
    }
    const clash = byNumber.get(match[1])
    if (clash) {
      throw new MigrationLoadError(
        `migrations/${service}: ${clash} và ${file} trùng số ${match[1]} — đổi số một file để thứ tự chạy rõ ràng`,
      )
    }
    byNumber.set(match[1], file)

    const full = join(dir, file)
    const id = file.slice(0, -'.ts'.length)
    const migration = pickExport(load(full)) as Partial<Migration> | undefined

    if (!migration || typeof migration !== 'object') {
      throw new MigrationLoadError(
        `${where}: thiếu \`export default\` một Migration`,
      )
    }
    if (migration.id !== id) {
      throw new MigrationLoadError(
        `${where}: id '${String(migration.id)}' phải trùng tên file '${id}'`,
      )
    }
    if (typeof migration.description !== 'string' || !migration.description) {
      throw new MigrationLoadError(`${where}: thiếu description`)
    }
    if (typeof migration.up !== 'function') {
      throw new MigrationLoadError(`${where}: thiếu hàm up(ctx)`)
    }
    const mode = migration.mode ?? 'deploy'
    if (!MIGRATION_MODES.includes(mode)) {
      throw new MigrationLoadError(
        `${where}: mode '${String(mode)}' không hợp lệ (deploy | background | manual)`,
      )
    }

    return {
      id,
      file: full,
      description: migration.description,
      mode,
      checksum: checksumOf(readFileSync(full)),
      up: migration.up.bind(migration) as Migration['up'],
    }
  })
}
