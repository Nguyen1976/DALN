import path from 'node:path'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { open, type CityResponse, type Reader } from 'maxmind'
import { LoggerService } from '@app/logger'
import type { GeoLocation } from '../domain/user.domain'

/**
 * Nơi đặt file GeoLite2-City. Mặc định nằm cạnh cwd như `gb.json` của
 * recommendation: trong container prod là /app/geoip (bind mount chỉ đọc từ
 * backend/geoip trên server), ở dev là backend/geoip. File không nằm trong
 * git: điều khoản GeoLite2 không cho phân phối lại, và file nặng ~60MB.
 */
export function geoIpDbPath(): string {
  return (
    process.env.GEOIP_DB_PATH?.trim() ||
    path.join(process.cwd(), 'geoip', 'GeoLite2-City.mmdb')
  )
}

/**
 * Tra vị trí ước tính của một IP từ file MaxMind đặt ngay trên server.
 *
 * Tra tại chỗ chứ không gọi API ngoài, nên IP của người dùng không rời hệ
 * thống — đúng tinh thần của một trang bảo mật.
 *
 * KHÔNG BAO GIỜ ném. Thiếu file (dev chưa tải, server chưa đặt) hay file hỏng
 * thì mọi lần tra trả `null`: trang "Thiết bị đang đăng nhập" mất bản đồ chứ
 * không được mất cả danh sách vì một tính năng phụ.
 */
@Injectable()
export class GeoIpService implements OnModuleInit {
  private reader: Reader<CityResponse> | null = null

  constructor(private readonly logger: LoggerService) {}

  async onModuleInit(): Promise<void> {
    await this.load(geoIpDbPath())
  }

  async load(dbPath: string): Promise<void> {
    try {
      this.reader = await open<CityResponse>(dbPath)
      this.logger.info('[geoip] đã nạp dữ liệu vị trí', { path: dbPath })
    } catch (error) {
      this.reader = null
      this.logger.warn(
        '[geoip] không mở được file dữ liệu, vị trí sẽ để trống',
        {
          path: dbPath,
          error: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  lookup(ip: string | null | undefined): GeoLocation | null {
    if (!ip || !this.reader) return null

    let record: CityResponse | null
    try {
      record = this.reader.get(ip)
    } catch {
      return null
    }

    const location = record?.location
    if (!record || !location) return null

    return {
      city: record.city?.names.en ?? null,
      country:
        record.country?.names.en ?? record.registered_country?.names.en ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyRadiusKm: location.accuracy_radius,
    }
  }
}
