import { Injectable } from '@nestjs/common'

/** Must match GB training + inference contract (Python SAFE_FEATURES). */
export const SAFE_FEATURES = [
  'jaccard',
  'cosine_graph',
  'adamic_adar',
  'pref_attach',
  'deg_u',
  'deg_v',
  'dist_km',
  'dist_bucket',
  'bio_cosine',
  'bio_dot',
  'bio_l2',
  'same_cluster',
  'group_inter',
  'group_jaccard',
  'same_group',
] as const

export type SafeFeatureName = (typeof SAFE_FEATURES)[number]

export type PairFeatureRow = Record<SafeFeatureName, number>

@Injectable()
export class FeatureService {
  computeJaccard(neighU: Set<string>, neighV: Set<string>): number {
    if (neighU.size === 0 && neighV.size === 0) return 0
    const intersection = new Set([...neighU].filter((x) => neighV.has(x)))
    const union = new Set([...neighU, ...neighV])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  computeCosineGraph(neighU: Set<string>, neighV: Set<string>): number {
    const intersection = new Set([...neighU].filter((x) => neighV.has(x)))
    const denominator = Math.sqrt(neighU.size * neighV.size)
    return denominator > 0 ? intersection.size / denominator : 0
  }

  computeAdamicAdar(
    neighU: Set<string>,
    neighV: Set<string>,
    degrees: Map<string, number>,
  ): number {
    const common = new Set([...neighU].filter((x) => neighV.has(x)))
    let score = 0
    for (const z of common) {
      const deg = degrees.get(z) ?? 1
      if (deg > 1) {
        score += 1 / Math.log(deg)
      }
    }
    return score
  }

  computePreferentialAttachment(
    neighU: Set<string>,
    neighV: Set<string>,
  ): number {
    return neighU.size * neighV.size
  }

  computeDegree(neighbors: Set<string>): number {
    return neighbors.size
  }

  computeBioCosine(bioA: number[] | null, bioB: number[] | null): number {
    if (!bioA || !bioB || bioA.length === 0 || bioB.length === 0) return 0
    if (bioA.length !== bioB.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < bioA.length; i++) {
      dotProduct += bioA[i] * bioB[i]
      normA += bioA[i] * bioA[i]
      normB += bioB[i] * bioB[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    return denominator > 0 ? dotProduct / denominator : 0
  }

  computeBioDot(bioA: number[] | null, bioB: number[] | null): number {
    if (!bioA || !bioB || bioA.length === 0 || bioB.length === 0) return 0
    if (bioA.length !== bioB.length) return 0

    let dotProduct = 0
    for (let i = 0; i < bioA.length; i++) {
      dotProduct += bioA[i] * bioB[i]
    }
    return dotProduct
  }

  computeBioL2(bioA: number[] | null, bioB: number[] | null): number {
    if (!bioA || !bioB || bioA.length === 0 || bioB.length === 0) return 0
    if (bioA.length !== bioB.length) return 0

    let sumSquaredDiff = 0
    for (let i = 0; i < bioA.length; i++) {
      const diff = bioA[i] - bioB[i]
      sumSquaredDiff += diff * diff
    }
    return Math.sqrt(sumSquaredDiff)
  }

  computeDistanceBucket(km: number): number {
    if (km <= 1) return 0
    if (km <= 5) return 1
    if (km <= 20) return 2
    if (km <= 100) return 3
    return 4
  }

  computeSameGroup(
    userGroups: Set<string>,
    candidateGroups: Set<string>,
  ): number {
    for (const group of userGroups) {
      if (candidateGroups.has(group)) return 1
    }
    return 0
  }

  computeGroupIntersection(
    userGroups: Set<string>,
    candidateGroups: Set<string>,
  ): number {
    let count = 0
    for (const group of userGroups) {
      if (candidateGroups.has(group)) count++
    }
    return count
  }

  computeGroupJaccard(
    userGroups: Set<string>,
    candidateGroups: Set<string>,
  ): number {
    if (userGroups.size === 0 && candidateGroups.size === 0) return 0
    const intersection = new Set(
      [...userGroups].filter((x) => candidateGroups.has(x)),
    )
    const union = new Set([...userGroups, ...candidateGroups])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  getLngLatPair(location: unknown): [number, number] | null {
    const coordinates = (location as { coordinates?: unknown })?.coordinates
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const lng = Number(coordinates[0])
      const lat = Number(coordinates[1])
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        return [lng, lat]
      }
    }
    const lo = location as { lat?: unknown; lon?: unknown } | null
    const lat = typeof lo?.lat === 'number' ? lo.lat : Number(lo?.lat)
    const lon = typeof lo?.lon === 'number' ? lo.lon : Number(lo?.lon)
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return [lon, lat]
    }
    return null
  }

  haversineDistanceKm(from: [number, number], to: [number, number]): number {
    const [fromLng, fromLat] = from
    const [toLng, toLat] = to

    const toRad = (deg: number) => (deg * Math.PI) / 180
    const earthRadiusKm = 6371

    const dLat = toRad(toLat - fromLat)
    const dLng = toRad(toLng - fromLng)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(fromLat)) *
        Math.cos(toRad(toLat)) *
        Math.sin(dLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return earthRadiusKm * c
  }

  computePairFeatures(params: {
    neighU: Set<string>
    neighV: Set<string>
    degrees: Map<string, number>
    bioU: number[] | null
    bioV: number[] | null
    locationU: unknown
    locationV: unknown
    groupsU: Set<string>
    groupsV: Set<string>
    sameCluster?: number
  }): PairFeatureRow {
    const degU = this.computeDegree(params.neighU)
    const degV = this.computeDegree(params.neighV)
    const coordsU = this.getLngLatPair(params.locationU)
    const coordsV = this.getLngLatPair(params.locationV)
    const distKm =
      coordsU && coordsV
        ? this.haversineDistanceKm(coordsU, coordsV)
        : Number.NaN

    return {
      jaccard: this.computeJaccard(params.neighU, params.neighV),
      cosine_graph: this.computeCosineGraph(params.neighU, params.neighV),
      adamic_adar: this.computeAdamicAdar(
        params.neighU,
        params.neighV,
        params.degrees,
      ),
      pref_attach: this.computePreferentialAttachment(
        params.neighU,
        params.neighV,
      ),
      deg_u: degU,
      deg_v: degV,
      dist_km: Number.isFinite(distKm) ? distKm : -1,
      dist_bucket: Number.isFinite(distKm)
        ? this.computeDistanceBucket(distKm)
        : -1,
      bio_cosine: this.computeBioCosine(params.bioU, params.bioV),
      bio_dot: this.computeBioDot(params.bioU, params.bioV),
      bio_l2: this.computeBioL2(params.bioU, params.bioV),
      same_cluster: params.sameCluster ?? 0,
      group_inter: this.computeGroupIntersection(
        params.groupsU,
        params.groupsV,
      ),
      group_jaccard: this.computeGroupJaccard(params.groupsU, params.groupsV),
      same_group: this.computeSameGroup(params.groupsU, params.groupsV),
    }
  }
}
