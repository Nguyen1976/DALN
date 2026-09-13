import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, parseArgs, USAGE, type CliDeps } from './cli'
import { loadMigrations } from './discovery'
import { LEDGER_COLLECTION, readLedger } from './ledger'
import { buildMongoUrl, dbNameFromUrl, redactMongoUrl } from './services'
import { FakeDb } from './testing/fake-db'

let dir: string

function writeFixture(root: string, service: string, id: string, mode: string) {
  mkdirSync(join(root, service), { recursive: true })
  writeFileSync(
    join(root, service, `${id}.ts`),
    [
      'const migration = {',
      `  id: '${id}',`,
      `  description: 'fixture ${service}/${id}',`,
      `  mode: '${mode}',`,
      '  up: () => Promise.resolve(),',
      '}',
      '',
      'export default migration',
      '',
    ].join('\n'),
  )
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'daln-migrate-cli-'))
  writeFixture(dir, 'user', '0001-a', 'deploy')
  writeFixture(dir, 'user', '0002-b', 'manual')
  writeFixture(dir, 'chat', '0001-a', 'deploy')
  writeFixture(dir, 'chat', '0002-b', 'background')
  writeFixture(dir, 'chat', '0003-c', 'deploy')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function setup(
  options: {
    env?: Record<string, string>
    migrationsDir?: string
    connect?: CliDeps['connect']
  } = {},
) {
  const dbs = new Map<string, FakeDb>()
  const dbOf = (name: string) => {
    let db = dbs.get(name)
    if (!db) {
      db = new FakeDb(name)
      dbs.set(name, db)
    }
    return db
  }
  const out: string[] = []
  const err: string[] = []
  const urls: string[] = []
  const deps: CliDeps = {
    env: { MIGRATE_LOCK_WAIT_MS: '30', ...options.env },
    migrationsDir: options.migrationsDir ?? dir,
    connect:
      options.connect ??
      ((url, dbName) => {
        urls.push(url)
        return Promise.resolve({
          db: dbOf(dbName).asDb(),
          close: () => Promise.resolve(),
        })
      }),
    out: (line) => {
      out.push(line)
    },
    err: (line) => {
      err.push(line)
    },
    lockPollMs: 5,
  }
  return { dbOf, out, err, urls, cli: (...argv: string[]) => main(argv, deps) }
}

/** Ghi ledger "đã chạy", mặc định với đúng checksum của file hiện tại. */
function seedApplied(
  db: FakeDb,
  service: string,
  id: string,
  fields: Record<string, unknown> = {},
) {
  const migration = loadMigrations(dir, service).find((m) => m.id === id)!
  db.collection(LEDGER_COLLECTION).seed({
    _id: id,
    description: migration.description,
    mode: migration.mode,
    checksum: migration.checksum,
    status: 'applied',
    startedAt: new Date(),
    appliedAt: new Date(),
    durationMs: 1,
    ...fields,
  })
}

const ledgerIds = async (db: FakeDb) => [
  ...(await readLedger(db.asDb())).keys(),
]

describe('migrate status --pending-count', () => {
  it('stdout CHỈ có một số nguyên: tổng migration deploy chưa chạy của mọi service', async () => {
    const { cli, out, err } = setup()

    await expect(cli('status', '--pending-count')).resolves.toBe(0)

    // user/0001 + chat/0001 + chat/0003 (manual, background không tính).
    expect(out).toEqual(['3'])
    expect(err).toEqual([])
  })

  it('--service chỉ đếm service đó; failed vẫn là pending; applied thì không', async () => {
    const { cli, out, dbOf } = setup()
    seedApplied(dbOf('chat-service'), 'chat', '0001-a')
    seedApplied(dbOf('user-service'), 'user', '0001-a', {
      status: 'failed',
      error: 'nổ',
    })

    await cli('status', '--pending-count', '--service', 'chat')
    await cli('status', '--pending-count')

    expect(out).toEqual(['1', '2'])
  })
})

describe('migrate status', () => {
  it('in bảng theo service, báo cả migration bị sửa sau khi chạy — exit 0', async () => {
    const { cli, out, dbOf } = setup()
    seedApplied(dbOf('chat-service'), 'chat', '0001-a', {
      checksum: 'checksum-cu',
    })

    await expect(cli('status', '--service', 'chat')).resolves.toBe(0)

    expect(out).toEqual([
      '[migrate] chat (chat-service): 1 changed, 2 pending',
      expect.stringMatching(/^ {2}changed +deploy +0001-a +FILE ĐÃ BỊ SỬA/),
      '  pending  background 0002-b  chạy bởi migrate:background',
      '  pending  deploy     0003-c',
    ])
  })

  it('migration manual chưa chạy: gợi ý lệnh chạy tay', async () => {
    const { cli, out } = setup()

    await cli('status', '--service', 'user')

    expect(out).toContain(
      '  pending  manual     0002-b  chạy tay: npm run migrate:run -- 0002-b --service user',
    )
  })
})

describe('migrate up', () => {
  it('chạy migration deploy của mọi service theo thứ tự, ghi ledger vào DB của từng service', async () => {
    const { cli, out, dbOf, urls } = setup()

    await expect(cli('up')).resolves.toBe(0)

    expect(out.filter((line) => line.includes(' ... '))).toEqual([
      expect.stringMatching(
        /^\[migrate\] user 0001-a \.\.\. applied in \d+ms$/,
      ),
      expect.stringMatching(
        /^\[migrate\] chat 0001-a \.\.\. applied in \d+ms$/,
      ),
      expect.stringMatching(
        /^\[migrate\] chat 0003-c \.\.\. applied in \d+ms$/,
      ),
    ])
    expect(out).toContain(
      '[migrate] notification: không có migration nào (mode deploy)',
    )
    expect(await ledgerIds(dbOf('user-service'))).toEqual(['0001-a'])
    expect(await ledgerIds(dbOf('chat-service'))).toEqual(['0001-a', '0003-c'])
    expect(urls).toEqual([
      'mongodb://mongo:27017/user-service?replicaSet=rs0',
      'mongodb://mongo:27017/chat-service?replicaSet=rs0',
      'mongodb://mongo:27017/notification-service?replicaSet=rs0',
      'mongodb://mongo:27017/recommendation-service?replicaSet=rs0',
      'mongodb://mongo:27017/saga-orchestrator-service?replicaSet=rs0',
    ])
  })

  it('MONGO_URL_TEMPLATE đổi tên DB (vd /e2e-{db}) -> ghi đúng DB trong URL', async () => {
    const { cli, dbOf, out } = setup({
      env: {
        MONGO_URL_TEMPLATE: 'mongodb://h:27017/e2e-{db}?directConnection=true',
      },
    })

    await expect(cli('up', '--service', 'user')).resolves.toBe(0)
    await cli('status', '--service', 'user')

    expect(await ledgerIds(dbOf('e2e-user-service'))).toEqual(['0001-a'])
    expect(await ledgerIds(dbOf('user-service'))).toEqual([])
    expect(out).toContain(
      '[migrate] user (e2e-user-service): 1 applied, 1 pending',
    )
  })

  it('chạy lần hai: mọi thứ skipped', async () => {
    const { cli, out } = setup()
    await cli('up', '--service', 'chat')
    out.length = 0

    await expect(cli('up', '--service', 'chat')).resolves.toBe(0)

    expect(out).toEqual([
      '[migrate] chat 0001-a ... skipped (already applied)',
      '[migrate] chat 0003-c ... skipped (already applied)',
    ])
  })

  it('migration đã chạy bị sửa ở BẤT KỲ service nào -> exit 1, không service nào chạy gì', async () => {
    const { cli, err, dbOf } = setup()
    seedApplied(dbOf('chat-service'), 'chat', '0001-a', {
      checksum: 'checksum-cu',
    })

    await expect(cli('up')).resolves.toBe(1)

    expect(err).toEqual([
      expect.stringContaining('[migrate] chat 0001-a REFUSED'),
    ])
    // user đứng TRƯỚC chat trong thứ tự chạy mà vẫn chưa bị đụng tới.
    expect(await ledgerIds(dbOf('user-service'))).toEqual([])
  })

  it('--dry-run: không ghi gì vào DB nào', async () => {
    const { cli, out, dbOf } = setup()

    await expect(cli('up', '--dry-run')).resolves.toBe(0)

    expect(out.filter((line) => line.includes('dry-run in'))).toHaveLength(3)
    for (const name of [
      'user-service',
      'chat-service',
      'notification-service',
    ]) {
      expect(dbOf(name).snapshot()).toEqual({})
    }
  })

  it('lock của một DB đang bị giữ -> exit 1, thông báo có tên người giữ', async () => {
    const { cli, err, dbOf } = setup()
    dbOf('user-service')
      .collection('_migrations_lock')
      .seed({
        _id: 'lock',
        owner: 'deploy-khac:42:beef',
        command: 'up',
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })

    await expect(cli('up', '--service', 'user')).resolves.toBe(1)

    expect(err.join('\n')).toContain('deploy-khac:42:beef')
  })
})

describe('migrate background / run', () => {
  it('background chỉ chạy mode background', async () => {
    const { cli, dbOf } = setup()

    await expect(cli('background')).resolves.toBe(0)

    expect(await ledgerIds(dbOf('chat-service'))).toEqual(['0002-b'])
    expect(await ledgerIds(dbOf('user-service'))).toEqual([])
  })

  it('run <id> chạy được migration manual và ghi ledger', async () => {
    const { cli, dbOf } = setup()

    await expect(cli('run', '0002-b', '--service', 'user')).resolves.toBe(0)

    expect(
      (await readLedger(dbOf('user-service').asDb())).get('0002-b'),
    ).toMatchObject({
      status: 'applied',
      mode: 'manual',
    })
  })

  it('run với id không tồn tại -> exit 2', async () => {
    const { cli, err } = setup()

    await expect(
      cli('run', '0009-khong-co', '--service', 'user'),
    ).resolves.toBe(2)

    expect(err[0]).toContain("không có migration '0009-khong-co'")
  })
})

describe('cú pháp, file hỏng, kết nối', () => {
  it.each([
    [['lam-gi-do']],
    [['run', '0001-a']],
    [['up', '--service', 'khong-co']],
    [['up', '--service']],
    [['status', '--dry-run']],
    [['up', '--pending-count']],
    [['up', 'thua']],
  ])('%j -> exit 2 kèm hướng dẫn', async (argv) => {
    const { cli, err } = setup()

    await expect(cli(...argv)).resolves.toBe(2)

    expect(err).toContain(USAGE)
  })

  it('không tham số / --help -> in hướng dẫn, exit 0', async () => {
    const { cli, out } = setup()

    await expect(cli()).resolves.toBe(0)
    await expect(cli('up', '--help')).resolves.toBe(0)

    expect(out).toEqual([USAGE, USAGE])
  })

  it('--service=chat cũng được', () => {
    expect(parseArgs(['up', '--service=chat', '--dry-run'])).toEqual({
      command: 'up',
      service: 'chat',
      dryRun: true,
      pendingCount: false,
    })
  })

  it('npm nuốt cờ vì thiếu "--" (còn dấu vết npm_config_dry_run) -> exit 2, không chạy gì', async () => {
    const { cli, err, dbOf } = setup({ env: { npm_config_dry_run: 'true' } })

    await expect(cli('up')).resolves.toBe(2)

    expect(err).toEqual([
      '[migrate] npm đã nuốt --dry-run vì thiếu "--" trước cờ — không chạy gì. Viết lại: npm run migrate:up -- --dry-run ...',
    ])
    expect(await ledgerIds(dbOf('user-service'))).toEqual([])
  })

  it('file migration sai tên -> exit 1 trước khi kết nối DB', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'daln-migrate-bad-'))
    mkdirSync(join(bad, 'chat'))
    writeFileSync(join(bad, 'chat', '1-sai-ten.ts'), 'export default {}\n')
    const connect = jest.fn()
    const { cli, err } = setup({ migrationsDir: bad, connect })

    try {
      await expect(cli('up')).resolves.toBe(1)
      expect(connect).not.toHaveBeenCalled()
      expect(err[0]).toContain('migrations/chat/1-sai-ten.ts')
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })

  it('không kết nối được Mongo -> exit 1, in URL đã che mật khẩu', async () => {
    const { cli, err } = setup({
      env: { MONGO_URL_TEMPLATE: 'mongodb://admin:bimat@db:27017/{db}' },
      connect: () => Promise.reject(new Error('ECONNREFUSED')),
    })

    await expect(cli('status')).resolves.toBe(1)

    expect(err).toEqual([
      '[migrate] user: không kết nối được mongodb://***@db:27017/user-service: ECONNREFUSED',
    ])
  })
})

describe('buildMongoUrl', () => {
  it('mặc định: mongo:27017 + replicaSet rs0', () => {
    expect(buildMongoUrl('chat-service', {})).toBe(
      'mongodb://mongo:27017/chat-service?replicaSet=rs0',
    )
  })

  it('MONGO_HOST / MONGO_REPLICA_SET tuỳ chỉnh', () => {
    expect(
      buildMongoUrl('chat-service', {
        MONGO_HOST: 'db1:27017,db2:27017',
        MONGO_REPLICA_SET: 'prod',
      }),
    ).toBe('mongodb://db1:27017,db2:27017/chat-service?replicaSet=prod')
  })

  it('localhost (dev ngoài docker) hoặc MONGO_REPLICA_SET rỗng -> kết nối thẳng', () => {
    expect(
      buildMongoUrl('user-service', { MONGO_HOST: 'localhost:27017' }),
    ).toBe('mongodb://localhost:27017/user-service?directConnection=true')
    expect(
      buildMongoUrl('user-service', {
        MONGO_HOST: 'mongo:27017',
        MONGO_REPLICA_SET: '',
      }),
    ).toBe('mongodb://mongo:27017/user-service?directConnection=true')
  })

  it('MONGO_URL_TEMPLATE thay {db}; thiếu {db} thì báo lỗi', () => {
    expect(
      buildMongoUrl('chat-service', {
        MONGO_URL_TEMPLATE: 'mongodb://u:p@h:27017/{db}?authSource=admin',
        MONGO_HOST: 'bi-bo-qua:1',
      }),
    ).toBe('mongodb://u:p@h:27017/chat-service?authSource=admin')
    expect(() =>
      buildMongoUrl('chat-service', { MONGO_URL_TEMPLATE: 'mongodb://h/x' }),
    ).toThrow('{db}')
  })

  it('dbNameFromUrl lấy tên DB từ path của URL', () => {
    expect(
      dbNameFromUrl('mongodb://u:p@h:27017/e2e-chat-service?authSource=admin'),
    ).toBe('e2e-chat-service')
    expect(dbNameFromUrl('mongodb://a:1,b:2/user-service')).toBe('user-service')
    expect(dbNameFromUrl('mongodb://h:27017/?x=1')).toBeNull()
  })

  it('redactMongoUrl che user:password', () => {
    expect(redactMongoUrl('mongodb://u:p@h:27017/x')).toBe(
      'mongodb://***@h:27017/x',
    )
    expect(redactMongoUrl('mongodb://h:27017/x')).toBe('mongodb://h:27017/x')
  })
})
