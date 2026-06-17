import type { RedisOptions } from 'ioredis'

/** ioredis / BullMQ accept `url` at runtime; typings omit it on older @types. */
export type RedisConnectionOptions = RedisOptions & { url?: string }

/**
 * Redis connection for local Docker (REDIS_HOST) or managed cloud (REDIS_URL / rediss://).
 */
export function getRedisOptions(
  overrides: RedisConnectionOptions = {},
): RedisConnectionOptions {
  const url = process.env.REDIS_URL?.trim()
  if (url) {
    return { url, ...overrides }
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    ...overrides,
  }
}
