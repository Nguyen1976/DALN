import { Logger, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { SessionStore } from './auth/session.store'

/**
 * Signing key for every session token in the system.
 *
 * It used to be the literal string 'my_key', committed to the repository:
 * anyone who read the source could mint a valid token for any account. It now
 * comes from the environment, and production refuses to boot without it — a
 * loud failure at startup beats a silently forgeable session.
 */
/**
 * Chuỗi từng được commit vào `.env.docker`, nên coi như ai cũng biết.
 *
 * Ai đọc được nó thì ký được token cho bất kỳ tài khoản nào. Nó đã bị lấy ra
 * khỏi file, nhưng vẫn còn trong lịch sử git và trong env của những máy đã
 * từng chạy — nên chặn thẳng ở chỗ khởi động là cách duy nhất chắc chắn.
 */
const LEAKED_SECRETS = new Set([
  'daln-dev-only-jwt-secret-doi-o-production',
  'my_key',
])

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()

  // Cứng ở production, ồn ào ở dev: máy dev đang chạy vẫn phải khởi động được,
  // nhưng không được im lặng — im lặng là cách một secret đã lộ sống thêm vài
  // tháng nữa.
  const reject = (reason: string) => {
    const message = `JWT_SECRET ${reason}. Sinh khoá mới bằng \`openssl rand -hex 32\`.`
    if (process.env.NODE_ENV === 'production') throw new Error(message)
    new Logger('CommonModule').error(message)
  }

  if (fromEnv && LEAKED_SECRETS.has(fromEnv)) {
    reject(
      'đang là một chuỗi đã từng nằm trong repo — ai đọc được nó thì ký được ' +
        'token cho bất kỳ tài khoản nào',
    )
  } else if (fromEnv && fromEnv.length < 32) {
    // Khoá ngắn thì brute-force được offline từ một token bắt được.
    reject('quá ngắn (cần tối thiểu 32 ký tự)')
  }

  if (fromEnv) return fromEnv

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET chưa được cấu hình. Sinh khoá bằng `openssl rand -hex 32` ' +
        'và đưa vào secret manager trước khi chạy production.',
    )
  }

  // Dev fallback so `docker compose up` works out of the box. Never used when
  // JWT_SECRET is set, and never reachable in production.
  return 'daln-dev-only-jwt-secret-doi-o-production'
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: resolveJwtSecret(),
    }),
  ],
  // AuthGuard được cung cấp qua APP_GUARD ở từng app, nên SessionStore phải
  // nhìn thấy được từ đó. RedisModule là @Global nên không cần import thêm.
  providers: [SessionStore],
  exports: [SessionStore],
})
export class CommonModule {}
