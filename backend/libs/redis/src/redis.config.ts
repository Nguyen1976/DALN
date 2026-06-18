import type { RedisOptions } from 'ioredis'
import Redis from 'ioredis'

/** ioredis / BullMQ accept `url` at runtime; typings omit it on older @types. */
export type RedisConnectionOptions = RedisOptions & { url?: string }

const commonOptions = (): Pick<
  RedisConnectionOptions,
  'connectTimeout' | 'maxRetriesPerRequest' | 'retryStrategy'
> => ({
  connectTimeout: 10_000,
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => Math.min(times * 200, 3_000),
})

/**
 * Options for BullMQ / fallback host-port mode.
 * Với REDIS_URL: trả về URL string (Bull chấp nhận trực tiếp).
 */
export function getRedisConnectionConfig():
  | string
  | RedisConnectionOptions {
  const url = process.env.REDIS_URL?.trim()
  if (url) {
    return url
  }

  return {
    ...commonOptions(),
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  }
}

/** @deprecated use getRedisConnectionConfig — kept for callers passing overrides */
export function getRedisOptions(
  overrides: RedisConnectionOptions = {},
): RedisConnectionOptions {
  const base = getRedisConnectionConfig()
  if (typeof base === 'string') {
    return { ...commonOptions(), ...overrides }
  }
  return { ...base, ...overrides }
}

/**
 * ioredis: `new Redis(urlString)` works; `new Redis({ url })` fails to connect
 * for Redis Cloud URLs — always use string constructor when REDIS_URL is set.
 */
export function createRedisClient(
  overrides: RedisConnectionOptions = {},
): Redis {
  const url = process.env.REDIS_URL?.trim()
  const shared = { ...commonOptions(), ...overrides }

  if (url) {
    const { url: _u, host: _h, port: _p, db: _db, ...rest } = shared
    return new Redis(url, rest)
  }

  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    ...shared,
  })
}
