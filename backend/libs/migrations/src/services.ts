import { resolve } from 'node:path'

/** backend/migrations — nằm ngoài apps/ nên sửa migration không build lại image service. */
export const DEFAULT_MIGRATIONS_DIR = resolve(__dirname, '../../../migrations')

/**
 * Mỗi service một DB riêng. Thứ tự này là thứ tự chạy khi không truyền
 * --service, trùng thứ tự trong docker/db-push.sh.
 */
export const SERVICES = [
  { name: 'user', db: 'user-service' },
  { name: 'chat', db: 'chat-service' },
  { name: 'notification', db: 'notification-service' },
  { name: 'recommendation', db: 'recommendation-service' },
  { name: 'saga-orchestrator', db: 'saga-orchestrator-service' },
] as const

export type ServiceInfo = (typeof SERVICES)[number]

export function findService(name: string): ServiceInfo | undefined {
  return SERVICES.find((service) => service.name === name)
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * URL Mongo của một DB service.
 *
 * - `MONGO_URL_TEMPLATE` (vd `mongodb://u:p@host/{db}?authSource=admin`) thắng
 *   tất cả; bắt buộc có `{db}` để mỗi service vào đúng DB của mình.
 * - Mặc định: `mongodb://${MONGO_HOST}/<db>?replicaSet=${MONGO_REPLICA_SET}`.
 * - MONGO_HOST là localhost, hoặc MONGO_REPLICA_SET rỗng: kết nối thẳng
 *   (directConnection). Replica set dev quảng bá host `mongo:27017`, máy host
 *   không phân giải được tên đó, nên `?replicaSet=rs0` từ ngoài docker sẽ treo
 *   tới khi hết giờ chọn server.
 */
export function buildMongoUrl(
  dbName: string,
  env: Record<string, string | undefined>,
): string {
  const template = env.MONGO_URL_TEMPLATE
  if (template) {
    if (!template.includes('{db}')) {
      throw new Error(
        'MONGO_URL_TEMPLATE phải chứa {db} (vd mongodb://host:27017/{db}?replicaSet=rs0)',
      )
    }
    return template.replaceAll('{db}', dbName)
  }

  const host = env.MONGO_HOST || 'mongo:27017'
  const replicaSet = env.MONGO_REPLICA_SET ?? 'rs0'
  if (replicaSet === '' || LOCAL_HOST.test(host)) {
    return `mongodb://${host}/${dbName}?directConnection=true`
  }
  return `mongodb://${host}/${dbName}?replicaSet=${encodeURIComponent(replicaSet)}`
}

/** Tên DB trong path của URL (`mongodb://host/<db>?...`); không có thì null. */
export function dbNameFromUrl(url: string): string | null {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]*)/.exec(url)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** Che user:password trước khi in URL ra log. */
export function redactMongoUrl(url: string): string {
  return url.replace(/\/\/[^@/]+@/, '//***@')
}
