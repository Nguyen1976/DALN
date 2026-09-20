/** A GeoJSON Point: `coordinates` is [longitude, latitude]. */
export type GeoPoint = { type: 'Point'; coordinates: [number, number] }

/**
 * Any location shape stored in the system — a GeoJSON Point (how the user
 * service stores it) or the older `{ lat, lon }` — as a GeoJSON Point; null
 * when there is none or it is not a valid pair. The single reader, so no
 * copy can again understand only one of the two shapes.
 */
export function toGeoPoint(location: unknown): GeoPoint | null {
  if (!location || typeof location !== 'object') return null

  const coordinates = (location as { coordinates?: unknown }).coordinates
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lng = Number(coordinates[0])
    const lat = Number(coordinates[1])
    return Number.isFinite(lng) && Number.isFinite(lat)
      ? { type: 'Point', coordinates: [lng, lat] }
      : null
  }

  const { lat, lon } = location as { lat?: unknown; lon?: unknown }
  if (lat === undefined || lon === undefined) return null
  const latN = Number(lat)
  const lonN = Number(lon)
  return Number.isFinite(latN) && Number.isFinite(lonN)
    ? { type: 'Point', coordinates: [lonN, latN] }
    : null
}
