import { Module } from '@nestjs/common'
import { CommonService } from './common.service'
import { JwtModule } from '@nestjs/jwt'

/**
 * Signing key for every session token in the system.
 *
 * It used to be the literal string 'my_key', committed to the repository:
 * anyone who read the source could mint a valid token for any account. It now
 * comes from the environment, and production refuses to boot without it — a
 * loud failure at startup beats a silently forgeable session.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
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
  providers: [CommonService],
  exports: [CommonService],
})
export class CommonModule {}
