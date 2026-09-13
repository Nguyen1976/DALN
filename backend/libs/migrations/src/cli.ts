import { MongoClient, type Db } from 'mongodb'
import {
  loadMigrations,
  MigrationLoadError,
  type LoadedMigration,
} from './discovery'
import { describeError, readLedger } from './ledger'
import { DEFAULT_LOCK_WAIT_MS } from './lock'
import {
  changedMessage,
  computeStatus,
  isPending,
  runService,
  type Selection,
  type StatusEntry,
} from './runner'
import {
  buildMongoUrl,
  dbNameFromUrl,
  DEFAULT_MIGRATIONS_DIR,
  findService,
  redactMongoUrl,
  SERVICES,
  type ServiceInfo,
} from './services'
import type { LedgerDoc } from './types'

export const USAGE = `Cách dùng (trong backend/, qua npm thì thêm "--" trước các cờ):
  migrate status     [--service <s>] [--pending-count]
  migrate up         [--service <s>] [--dry-run]
  migrate background [--service <s>] [--dry-run]
  migrate run <id>   --service <s> [--dry-run]

  <s>: ${SERVICES.map((service) => service.name).join(' | ')} (bỏ trống = tất cả, theo thứ tự này)

Env: MONGO_HOST (mặc định mongo:27017), MONGO_REPLICA_SET (mặc định rs0),
     MONGO_URL_TEMPLATE (vd mongodb://u:p@host:27017/{db}?authSource=admin),
     MIGRATE_LOCK_WAIT_MS (chờ lock tối đa, mặc định ${DEFAULT_LOCK_WAIT_MS})
Exit: 0 thành công | 1 migration lỗi, checksum lệch, lock bận, lỗi kết nối | 2 sai cú pháp`

export interface Connection {
  db: Db
  close(): Promise<void>
}

export interface CliDeps {
  env: Record<string, string | undefined>
  migrationsDir: string
  connect: (url: string, dbName: string) => Promise<Connection>
  out: (line: string) => void
  err: (line: string) => void
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  lockTtlMs?: number
  lockPollMs?: number
}

type Command = 'status' | 'up' | 'background' | 'run'

export interface ParsedArgs {
  command: Command | 'help'
  service?: string
  id?: string
  dryRun: boolean
  pendingCount: boolean
}

export class UsageError extends Error {
  override name = 'UsageError'
}

const COMMANDS: readonly string[] = ['status', 'up', 'background', 'run']

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv
  const help: ParsedArgs = {
    command: 'help',
    dryRun: false,
    pendingCount: false,
  }
  if (!command || ['help', '--help', '-h'].includes(command)) return help
  if (!COMMANDS.includes(command)) {
    throw new UsageError(`Lệnh không hợp lệ: ${command}`)
  }

  const parsed: ParsedArgs = {
    command: command as Command,
    dryRun: false,
    pendingCount: false,
  }
  const positionals: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--service' || arg.startsWith('--service=')) {
      const value =
        arg === '--service' ? rest[++i] : arg.slice('--service='.length)
      if (!value || value.startsWith('-')) {
        throw new UsageError('--service cần tên service')
      }
      if (parsed.service) throw new UsageError('Chỉ truyền --service một lần')
      parsed.service = value
    } else if (arg === '--dry-run' && command !== 'status') {
      parsed.dryRun = true
    } else if (arg === '--pending-count' && command === 'status') {
      parsed.pendingCount = true
    } else if (arg === '--help' || arg === '-h') {
      return help
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Cờ không hợp lệ cho lệnh ${command}: ${arg}`)
    } else {
      positionals.push(arg)
    }
  }

  if (parsed.command === 'run') {
    if (positionals.length !== 1) {
      throw new UsageError('run cần đúng một <id>')
    }
    if (!parsed.service) throw new UsageError('run cần --service <s>')
    parsed.id = positionals[0]
  } else if (positionals.length) {
    throw new UsageError(`Tham số thừa: ${positionals.join(' ')}`)
  }

  if (parsed.service && !findService(parsed.service)) {
    throw new UsageError(
      `Service không tồn tại: ${parsed.service} (hợp lệ: ${SERVICES.map((service) => service.name).join(', ')})`,
    )
  }
  return parsed
}

function lockWaitMs(env: Record<string, string | undefined>): number {
  const raw = env.MIGRATE_LOCK_WAIT_MS
  const value = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LOCK_WAIT_MS
}

/**
 * `npm run migrate:up --dry-run` (thiếu `--`): npm nuốt cờ, CLI không nhận
 * được gì, chỉ còn env `npm_config_dry_run=true` — migration sẽ chạy THẬT
 * (đo trên npm 11). Thấy dấu vết đó thì dừng hẳn thay vì đoán ý người gõ.
 */
const NPM_SWALLOWED_FLAGS = ['dry-run', 'service', 'pending-count']

function flagsSwallowedByNpm(
  env: Record<string, string | undefined>,
): string[] {
  return NPM_SWALLOWED_FLAGS.filter((flag) => {
    const value = env[`npm_config_${flag.replace(/-/g, '_')}`]
    return value !== undefined && value !== ''
  }).map((flag) => `--${flag}`)
}

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseArgs(argv)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    deps.err(`[migrate] ${error.message}`)
    deps.err(USAGE)
    return 2
  }
  if (args.command === 'help') {
    deps.out(USAGE)
    return 0
  }

  const swallowed = flagsSwallowedByNpm(deps.env)
  if (swallowed.length) {
    deps.err(
      `[migrate] npm đã nuốt ${swallowed.join(', ')} vì thiếu "--" trước cờ — không chạy gì. Viết lại: npm run migrate:${args.command} -- ${swallowed.join(' ')} ...`,
    )
    return 2
  }

  const services: ServiceInfo[] = args.service
    ? [findService(args.service)!]
    : [...SERVICES]

  // Nạp file trước khi kết nối: file sai tên/thiếu export thì dừng ngay,
  // chưa đụng tới DB nào.
  const loaded = new Map<string, LoadedMigration[]>()
  try {
    for (const service of services) {
      loaded.set(service.name, loadMigrations(deps.migrationsDir, service.name))
    }
  } catch (error) {
    if (!(error instanceof MigrationLoadError)) throw error
    deps.err(`[migrate] ${error.message}`)
    return 1
  }

  if (args.command === 'run') {
    const known = loaded.get(services[0].name) ?? []
    if (!known.some((migration) => migration.id === args.id)) {
      deps.err(
        `[migrate] ${services[0].name}: không có migration '${args.id}' trong migrations/${services[0].name}/`,
      )
      return 2
    }
  }

  const connections = new Map<string, Connection>()
  try {
    for (const service of services) {
      let shown: string = service.db
      try {
        const url = buildMongoUrl(service.db, deps.env)
        shown = redactMongoUrl(url)
        // Template kiểu `mongodb://h/e2e-{db}` đổi luôn tên DB: lấy tên theo
        // path của URL, không thì mặc định tên DB của service.
        const dbName = dbNameFromUrl(url) ?? service.db
        connections.set(service.name, await deps.connect(url, dbName))
      } catch (error) {
        deps.err(
          `[migrate] ${service.name}: không kết nối được ${shown}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return 1
      }
    }

    if (args.command === 'status') {
      return await status(args, services, loaded, connections, deps)
    }
    return await apply(args, services, loaded, connections, deps)
  } finally {
    await Promise.all(
      [...connections.values()].map((connection) =>
        connection.close().catch(() => undefined),
      ),
    )
  }
}

async function status(
  args: ParsedArgs,
  services: ServiceInfo[],
  loaded: Map<string, LoadedMigration[]>,
  connections: Map<string, Connection>,
  deps: CliDeps,
): Promise<number> {
  let pending = 0
  for (const service of services) {
    const { db } = connections.get(service.name)!
    const { entries, orphans } = computeStatus(
      loaded.get(service.name) ?? [],
      await readLedger(db),
    )
    pending += entries.filter(
      (entry) => entry.migration.mode === 'deploy' && isPending(entry.state),
    ).length
    if (!args.pendingCount) {
      printStatus(deps.out, service, db.databaseName, entries, orphans)
    }
  }
  // --pending-count: stdout CHỈ có một số nguyên để script deploy đọc.
  if (args.pendingCount) deps.out(String(pending))
  return 0
}

async function apply(
  args: ParsedArgs,
  services: ServiceInfo[],
  loaded: Map<string, LoadedMigration[]>,
  connections: Map<string, Connection>,
  deps: CliDeps,
): Promise<number> {
  // Kiểm tra checksum ở MỌI service trước khi ghi bất cứ gì: một migration đã
  // chạy bị sửa thì không chạy gì cả, tránh deploy nửa vời.
  let refused = false
  for (const service of services) {
    const { entries } = computeStatus(
      loaded.get(service.name) ?? [],
      await readLedger(connections.get(service.name)!.db),
    )
    for (const entry of entries) {
      if (entry.state !== 'changed') continue
      deps.err(changedMessage(service.name, entry))
      refused = true
    }
  }
  if (refused) return 1

  const selection: Selection =
    args.command === 'run'
      ? { id: args.id! }
      : { mode: args.command === 'up' ? 'deploy' : 'background' }

  for (const service of services) {
    const ok = await runService({
      db: connections.get(service.name)!.db,
      service: service.name,
      migrations: loaded.get(service.name) ?? [],
      selection,
      dryRun: args.dryRun,
      command: args.command,
      out: deps.out,
      err: deps.err,
      lockWaitMs: lockWaitMs(deps.env),
      lockTtlMs: deps.lockTtlMs,
      lockPollMs: deps.lockPollMs,
      signal: deps.signal,
      sleep: deps.sleep,
    })
    if (!ok) return 1
  }
  return 0
}

function firstLine(text: string | undefined): string {
  return (text ?? '').split('\n')[0]
}

function describeEntry(service: string, entry: StatusEntry): string {
  const { migration, ledger } = entry
  switch (entry.state) {
    case 'applied':
      return `${ledger?.appliedAt?.toISOString() ?? ''} ${ledger?.durationMs ?? '?'}ms`
    case 'changed':
      return 'FILE ĐÃ BỊ SỬA sau khi chạy — up/background/run sẽ từ chối'
    case 'failed':
      return `lỗi: ${firstLine(ledger?.error)}`
    case 'running':
      return `đang chạy hoặc đã dừng giữa chừng (từ ${ledger?.startedAt?.toISOString() ?? '?'})`
    case 'pending':
      if (migration.mode === 'manual') {
        return `chạy tay: npm run migrate:run -- ${migration.id} --service ${service}`
      }
      if (migration.mode === 'background') return 'chạy bởi migrate:background'
      return ''
  }
}

function printStatus(
  out: (line: string) => void,
  service: ServiceInfo,
  dbName: string,
  entries: StatusEntry[],
  orphans: LedgerDoc[],
): void {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1)
  }
  const summary = [...counts].map(([state, n]) => `${n} ${state}`).join(', ')
  out(
    `[migrate] ${service.name} (${dbName}): ${summary || 'chưa có migration'}`,
  )

  const width = Math.max(
    0,
    ...entries.map((entry) => entry.migration.id.length),
    ...orphans.map((doc) => doc._id.length),
  )
  for (const entry of entries) {
    const note = describeEntry(service.name, entry)
    out(
      `  ${entry.state.padEnd(8)} ${entry.migration.mode.padEnd(10)} ${entry.migration.id.padEnd(width)}  ${note}`.trimEnd(),
    )
  }
  for (const doc of orphans) {
    out(
      `  ${'missing'.padEnd(8)} ${String(doc.mode).padEnd(10)} ${doc._id.padEnd(width)}  có trong ledger nhưng không còn file`,
    )
  }
}

async function connectMongo(url: string, dbName: string): Promise<Connection> {
  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 10_000,
    appName: 'daln-migrate',
  })
  try {
    await client.connect()
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
  return { db: client.db(dbName), close: () => client.close() }
}

if (require.main === module) {
  const controller = new AbortController()
  const onSignal = (signal: NodeJS.Signals) => {
    // Lần hai thì thoát ngay; lock sẽ tự hết hạn.
    if (controller.signal.aborted) process.exit(130)
    process.stderr.write(
      `[migrate] Nhận ${signal}: dừng sau lô hiện tại, ghi ledger, nhả lock rồi thoát (gửi lần nữa để thoát ngay)\n`,
    )
    controller.abort(
      new Error(`Bị dừng bởi ${signal} — lần chạy sau làm tiếp từ checkpoint`),
    )
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  main(process.argv.slice(2), {
    env: process.env,
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    connect: connectMongo,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    signal: controller.signal,
  }).then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      process.stderr.write(
        `[migrate] Lỗi không mong đợi: ${describeError(error)}\n`,
      )
      process.exitCode = 1
    },
  )
}
