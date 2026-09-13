import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { checksumOf, loadMigrations, MigrationLoadError } from './discovery'
import { DEFAULT_MIGRATIONS_DIR, SERVICES } from './services'

describe('loadMigrations', () => {
  let dir: string
  /** Module giả theo tên file; không có thì id = tên file. */
  let modules: Map<string, unknown>

  const load = (file: string): unknown => {
    const name = basename(file)
    if (modules.has(name)) return modules.get(name)
    return {
      default: {
        id: basename(file, '.ts'),
        description: `mô tả ${name}`,
        up: () => Promise.resolve(),
      },
    }
  }
  const write = (file: string, content = `// ${file}\n`) =>
    writeFileSync(join(dir, 'chat', file), content)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daln-migrate-discovery-'))
    mkdirSync(join(dir, 'chat'))
    modules = new Map()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sắp theo tên file, mode mặc định deploy, bỏ qua .spec.ts / .d.ts / file không phải .ts', () => {
    for (const file of [
      '0010-c.ts',
      '0002-b.ts',
      '0001-a.ts',
      '0003-x.spec.ts',
      'types.d.ts',
      'README.md',
    ]) {
      write(file)
    }
    modules.set('0002-b.ts', {
      default: {
        id: '0002-b',
        description: 'b',
        mode: 'background',
        up: () => Promise.resolve(),
      },
    })

    const loaded = loadMigrations(dir, 'chat', load)

    expect(loaded.map((m) => [m.id, m.mode])).toEqual([
      ['0001-a', 'deploy'],
      ['0002-b', 'background'],
      ['0010-c', 'deploy'],
    ])
    expect(loaded[0].file).toBe(join(dir, 'chat', '0001-a.ts'))
  })

  it('service chưa có thư mục -> không có migration', () => {
    expect(loadMigrations(dir, 'user', load)).toEqual([])
  })

  it.each(['3-ngan.ts', '0003_gach_duoi.ts', '0003-ChuHoa.ts', 'helper.ts'])(
    'tên file sai (%s) -> lỗi, không lặng lẽ bỏ qua',
    (file) => {
      write(file)
      expect(() => loadMigrations(dir, 'chat', load)).toThrow(
        MigrationLoadError,
      )
    },
  )

  it('hai file trùng số thứ tự -> lỗi', () => {
    write('0003-a.ts')
    write('0003-b.ts')
    expect(() => loadMigrations(dir, 'chat', load)).toThrow(/trùng số 0003/)
  })

  it('id khác tên file -> lỗi', () => {
    write('0001-a.ts')
    modules.set('0001-a.ts', {
      default: {
        id: '0001-khac',
        description: 'x',
        up: () => Promise.resolve(),
      },
    })
    expect(() => loadMigrations(dir, 'chat', load)).toThrow(
      /phải trùng tên file '0001-a'/,
    )
  })

  it.each([
    ['thiếu export default', undefined],
    ['thiếu up', { default: { id: '0001-a', description: 'x' } }],
    [
      'thiếu description',
      { default: { id: '0001-a', up: () => Promise.resolve() } },
    ],
    [
      'mode lạ',
      {
        default: {
          id: '0001-a',
          description: 'x',
          mode: 'sometimes',
          up: () => Promise.resolve(),
        },
      },
    ],
  ])('%s -> lỗi', (_name, mod) => {
    write('0001-a.ts')
    modules.set('0001-a.ts', mod)
    expect(() => loadMigrations(dir, 'chat', load)).toThrow(MigrationLoadError)
  })

  it('checksum = sha256 nội dung file, không đổi theo CRLF, đổi khi sửa file', () => {
    write('0001-a.ts', 'const a = 1\n')
    const [first] = loadMigrations(dir, 'chat', load)
    expect(first.checksum).toBe(
      createHash('sha256').update('const a = 1\n').digest('hex'),
    )
    expect(checksumOf('const a = 1\r\n')).toBe(first.checksum)

    write('0001-a.ts', 'const a = 2\n')
    expect(loadMigrations(dir, 'chat', load)[0].checksum).not.toBe(
      first.checksum,
    )
  })
})

describe('migrations/ thật trong repo', () => {
  it('mọi file nạp được (id trùng tên file, không trùng số), đúng mode', () => {
    const byService = Object.fromEntries(
      SERVICES.map((service) => [
        service.name,
        loadMigrations(DEFAULT_MIGRATIONS_DIR, service.name).map(
          (migration) => `${migration.id}:${migration.mode}`,
        ),
      ]),
    )

    expect(byService.user).toEqual(
      expect.arrayContaining([
        '0001-normalize-user-emails:deploy',
        '0002-resync-user-copies:manual',
      ]),
    )
    expect(byService.chat).toEqual(
      expect.arrayContaining([
        '0001-backfill-conversation-updated-at:deploy',
        '0002-normalize-participant-role:deploy',
        '0003-init-unread-count:deploy',
        '0004-repair-unread-counts:background',
      ]),
    )
  })
})
