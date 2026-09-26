import path from 'node:path'
import { GeoIpService, geoIpDbPath } from './geoip.service'

/**
 * Chạy trên file .mmdb THẬT: DB kiểm thử công khai của MaxMind
 * (github.com/maxmind/MaxMind-DB, Apache-2.0/MIT), cùng định dạng với
 * GeoLite2-City. Mock reader ở đây nghĩa là test lại chính cái mock.
 */
const FIXTURE = path.join(__dirname, '__fixtures__', 'GeoIP2-City-Test.mmdb')

function makeService() {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { service: new GeoIpService(logger as never), logger }
}

describe('GeoIpService — có file dữ liệu', () => {
  const { service, logger } = makeService()

  beforeAll(async () => {
    await service.load(FIXTURE)
  })

  it('nạp được file và không cảnh báo gì', () => {
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      '81.2.69.142',
      {
        city: 'London',
        country: 'United Kingdom',
        latitude: 51.5142,
        longitude: -0.0931,
        accuracyRadiusKm: 10,
      },
    ],
    [
      '89.160.20.112',
      {
        city: 'Linköping',
        country: 'Sweden',
        latitude: 58.4167,
        longitude: 15.6167,
        accuracyRadiusKm: 76,
      },
    ],
    [
      '175.16.199.0',
      {
        city: 'Changchun',
        country: 'China',
        latitude: 43.88,
        longitude: 125.3228,
        accuracyRadiusKm: 100,
      },
    ],
    // Chỉ biết tới quốc gia: city null, bán kính lớn — giao diện dựa vào
    // đây để lùi zoom thay vì cắm một điểm trông chính xác.
    [
      '67.43.156.0',
      {
        city: null,
        country: 'Bhutan',
        latitude: 27.5,
        longitude: 90.5,
        accuracyRadiusKm: 534,
      },
    ],
    [
      '2001:218::1',
      {
        city: null,
        country: 'Japan',
        latitude: 35.68536,
        longitude: 139.75309,
        accuracyRadiusKm: 100,
      },
    ],
  ])('%s -> đúng vị trí', (ip, expected) => {
    expect(service.lookup(ip)).toEqual(expected)
  })

  // Express trả dạng này khi socket là IPv6 còn client là IPv4.
  it('IPv4-mapped (::ffff:) cho cùng kết quả như IPv4', () => {
    expect(service.lookup('::ffff:81.2.69.142')).toEqual(
      service.lookup('81.2.69.142'),
    )
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['mạng docker', '172.22.0.1'],
    ['loopback IPv6', '::1'],
    ['dải tài liệu IPv6', '2001:db8::1'],
    ['chuỗi rác', 'not-an-ip'],
    ['chuỗi rỗng', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s -> null, không ném', (_label, ip) => {
    expect(service.lookup(ip)).toBeNull()
  })
})

describe('GeoIpService — không dùng được file dữ liệu', () => {
  it('thiếu file -> lookup luôn null, không ném, cảnh báo đúng một lần', async () => {
    const { service, logger } = makeService()

    await service.load('/khong/ton/tai/GeoLite2-City.mmdb')

    expect(service.lookup('81.2.69.142')).toBeNull()
    expect(service.lookup('89.160.20.112')).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('file hỏng -> lookup null, không ném', async () => {
    const { service, logger } = makeService()

    await service.load(__filename) // một file .ts, không phải .mmdb

    expect(service.lookup('81.2.69.142')).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('chưa nạp gì -> null', () => {
    const { service } = makeService()
    expect(service.lookup('81.2.69.142')).toBeNull()
  })
})

/**
 * Bản ghi MaxMind không đúng hình dạng mong đợi. File thật không có ca này,
 * nhưng một lần ném ở đây là 500 cho cả danh sách thiết bị, và toạ độ thiếu
 * thì giao diện vẽ NaN — nên cài một reader giả chỉ trả đúng bản ghi đó.
 */
describe('GeoIpService — bản ghi méo', () => {
  function withRecord(record: unknown) {
    const { service } = makeService()
    Object.assign(service, { reader: { get: () => record } })
    return service
  }

  it('city không có names -> không ném, city null', () => {
    const service = withRecord({
      city: {},
      country: { names: { en: 'Vietnam' } },
      location: { latitude: 21, longitude: 105.8, accuracy_radius: 50 },
    })

    expect(() => service.lookup('1.2.3.4')).not.toThrow()
    expect(service.lookup('1.2.3.4')).toMatchObject({
      city: null,
      country: 'Vietnam',
    })
  })

  it.each([
    ['thiếu latitude', { longitude: 105.8, accuracy_radius: 50 }],
    ['thiếu longitude', { latitude: 21, accuracy_radius: 50 }],
    ['thiếu accuracy_radius', { latitude: 21, longitude: 105.8 }],
  ])('location %s -> null thay vì toạ độ NaN', (_label, location) => {
    const service = withRecord({ location })
    expect(service.lookup('1.2.3.4')).toBeNull()
  })
})

describe('geoIpDbPath', () => {
  const original = process.env.GEOIP_DB_PATH

  afterEach(() => {
    if (original === undefined) delete process.env.GEOIP_DB_PATH
    else process.env.GEOIP_DB_PATH = original
  })

  it('mặc định nằm cạnh cwd — /app/geoip trong container', () => {
    delete process.env.GEOIP_DB_PATH
    expect(geoIpDbPath()).toBe(
      path.join(process.cwd(), 'geoip', 'GeoLite2-City.mmdb'),
    )
  })

  it('GEOIP_DB_PATH ghi đè được', () => {
    process.env.GEOIP_DB_PATH = '/data/khac.mmdb'
    expect(geoIpDbPath()).toBe('/data/khac.mmdb')
  })
})
