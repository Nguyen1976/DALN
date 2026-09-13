import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { loadMigrations } from './discovery'
import { createMigrationFile, nextMigrationId } from './new'
import { FakeDb } from './testing/fake-db'
import { makeContext } from './testing/helpers'

describe('migrate:new', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daln-migrate-new-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('service chưa có migration -> tạo 0001; file là migration hợp lệ nhưng ném lỗi tới khi được viết', async () => {
    const file = createMigrationFile(dir, 'chat', 'add-pinned-at')

    expect(basename(file)).toBe('0001-add-pinned-at.ts')
    const source = readFileSync(file, 'utf8')
    expect(source).toContain("import type { Migration } from '@app/migrations'")
    expect(source).toContain('IDEMPOTENT')
    expect(source).toContain(
      'npm run migrate:run -- 0001-add-pinned-at --service chat',
    )

    const [migration] = loadMigrations(dir, 'chat')
    expect(migration).toMatchObject({
      id: '0001-add-pinned-at',
      mode: 'deploy',
    })
    await expect(migration.up(makeContext(new FakeDb()).ctx)).rejects.toThrow(
      'Chưa viết migration 0001-add-pinned-at',
    )
  })

  it('số kế tiếp = số lớn nhất đang có + 1', () => {
    mkdirSync(join(dir, 'user'))
    writeFileSync(join(dir, 'user', '0001-a.ts'), '')
    writeFileSync(join(dir, 'user', '0007-b.ts'), '')

    expect(nextMigrationId(join(dir, 'user'), 'c')).toBe('0008-c')
    expect(basename(createMigrationFile(dir, 'user', 'c'))).toBe('0008-c.ts')
  })

  it('từ chối service hoặc slug sai', () => {
    expect(() => createMigrationFile(dir, 'khong-co', 'x')).toThrow(
      'Service không tồn tại',
    )
    expect(() => createMigrationFile(dir, 'chat', 'Sai_Slug')).toThrow(
      'không hợp lệ',
    )
  })
})
