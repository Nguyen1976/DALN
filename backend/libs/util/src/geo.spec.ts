import { toGeoPoint } from './geo'

describe('toGeoPoint', () => {
  it('reads a GeoJSON point', () => {
    expect(toGeoPoint({ type: 'Point', coordinates: [105.8, 21.0] })).toEqual({
      type: 'Point',
      coordinates: [105.8, 21.0],
    })
  })

  it('reads the older { lat, lon } shape', () => {
    expect(toGeoPoint({ lat: 21.0, lon: 105.8 })).toEqual({
      type: 'Point',
      coordinates: [105.8, 21.0],
    })
  })

  it('returns null for nothing or nonsense', () => {
    expect(toGeoPoint(null)).toBeNull()
    expect(toGeoPoint({})).toBeNull()
    expect(toGeoPoint({ lat: 'x', lon: 1 })).toBeNull()
    expect(toGeoPoint({ coordinates: [1] })).toBeNull()
  })
})
