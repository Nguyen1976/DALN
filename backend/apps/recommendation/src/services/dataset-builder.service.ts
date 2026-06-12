import { Injectable, Logger } from '@nestjs/common'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'
import { PrismaService } from '../../prisma/prisma.service'
import { FeatureService, SAFE_FEATURES } from './feature.service'
import { FriendGraphService } from './friend-graph.service'

export type TrainingRow = {
  u: string
  v: string
  label: 0 | 1
} & Record<(typeof SAFE_FEATURES)[number], number>

type BuildDatasetOptions = {
  negativeRatio?: number
  randomSeed?: number
  hardNegativeHops?: number[]
}

@Injectable()
export class DatasetBuilderService {
  private readonly logger = new Logger(DatasetBuilderService.name)

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
    private readonly prisma: PrismaService,
    private readonly featureService: FeatureService,
    private readonly friendGraph: FriendGraphService,
  ) {}

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }

  private orderedPair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a]
  }

  private mulberry32(seed: number): () => number {
    let t = seed >>> 0
    return () => {
      t += 0x6d2b79f5
      let r = Math.imul(t ^ (t >>> 15), 1 | t)
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
  }

  private buildNeighborDict(
    edges: Array<{ user1: string; user2: string }>,
  ): Map<string, Set<string>> {
    const neighbors = new Map<string, Set<string>>()
    const ensure = (id: string) => {
      if (!neighbors.has(id)) neighbors.set(id, new Set())
      return neighbors.get(id)!
    }

    for (const edge of edges) {
      if (!edge.user1 || !edge.user2 || edge.user1 === edge.user2) continue
      ensure(edge.user1).add(edge.user2)
      ensure(edge.user2).add(edge.user1)
    }
    return neighbors
  }

  private bfsDistances(
    graph: Map<string, Set<string>>,
    source: string,
    maxDepth: number,
  ): Map<string, number> {
    const distances = new Map<string, number>()
    const queue: Array<{ node: string; depth: number }> = [{ node: source, depth: 0 }]
    const visited = new Set<string>([source])

    while (queue.length) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue
      for (const next of graph.get(current.node) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        const depth = current.depth + 1
        distances.set(next, depth)
        queue.push({ node: next, depth })
      }
    }
    return distances
  }

  private connectedComponents(
    graph: Map<string, Set<string>>,
  ): Map<string, number> {
    const componentByNode = new Map<string, number>()
    let componentId = 0

    for (const node of graph.keys()) {
      if (componentByNode.has(node)) continue
      const stack = [node]
      componentByNode.set(node, componentId)
      while (stack.length) {
        const current = stack.pop()!
        for (const next of graph.get(current) ?? []) {
          if (componentByNode.has(next)) continue
          componentByNode.set(next, componentId)
          stack.push(next)
        }
      }
      componentId++
    }
    return componentByNode
  }

  private async fetchFriendEdges(): Promise<
    Array<{ user1: string; user2: string }>
  > {
    return this.friendGraph.getAllFriendEdges()
  }

  private async fetchGroupsByUser(
    userIds: string[],
  ): Promise<Map<string, Set<string>>> {
    return this.friendGraph.getGroupsBatch(userIds)
  }

  private async fetchSnapshots(userIds: string[]) {
    if (!userIds.length) return new Map<string, { location: unknown }>()
    const rows = await this.prisma.userSnapshot.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, location: true },
    })
    return new Map(rows.map((row) => [row.userId, { location: row.location }]))
  }

  private async fetchBioVectors(
    userIds: string[],
  ): Promise<Map<string, number[]>> {
    const vectors = new Map<string, number[]>()
    if (!userIds.length) return vectors

    const qdrantIds = userIds.map((id) => this.utilService.mongoIdToUuid(id))
    const points = await this.qdrantService.getVectorsBatch(qdrantIds)
    for (const point of points) {
      const mongoId = point.payload?.mongoId
      if (typeof mongoId !== 'string' || !Array.isArray(point.vector)) continue
      vectors.set(mongoId, point.vector as number[])
    }
    return vectors
  }

  private computeFeaturesForPair(params: {
    u: string
    v: string
    label: 0 | 1
    neighbors: Map<string, Set<string>>
    degrees: Map<string, number>
    bioVectors: Map<string, number[]>
    snapshots: Map<string, { location: unknown }>
    groupsByUser: Map<string, Set<string>>
  }): TrainingRow {
    const neighU = new Set(params.neighbors.get(params.u) ?? [])
    const neighV = new Set(params.neighbors.get(params.v) ?? [])

    if (params.label === 1) {
      neighU.delete(params.v)
      neighV.delete(params.u)
    }

    const features = this.featureService.computePairFeatures({
      neighU,
      neighV,
      degrees: params.degrees,
      bioU: params.bioVectors.get(params.u) ?? null,
      bioV: params.bioVectors.get(params.v) ?? null,
      locationU: params.snapshots.get(params.u)?.location ?? null,
      locationV: params.snapshots.get(params.v)?.location ?? null,
      groupsU: params.groupsByUser.get(params.u) ?? new Set(),
      groupsV: params.groupsByUser.get(params.v) ?? new Set(),
      sameCluster: 0,
    })

    return {
      u: params.u,
      v: params.v,
      label: params.label,
      ...features,
    }
  }

  async buildDataset(
    options: BuildDatasetOptions = {},
  ): Promise<TrainingRow[]> {
    const negativeRatio = options.negativeRatio ?? 1
    const randomSeed = options.randomSeed ?? 42
    const hardNegativeHops = options.hardNegativeHops ?? [2, 3]
    const rand = this.mulberry32(randomSeed)

    const edges = await this.fetchFriendEdges()
    if (!edges.length) {
      throw new Error('No friend edges found in MongoDB friendship replica')
    }

    const neighbors = this.buildNeighborDict(edges)
    const degrees = new Map<string, number>()
    for (const [userId, neigh] of neighbors.entries()) {
      degrees.set(userId, neigh.size)
    }

    const positivePairs = edges.map((edge) =>
      this.orderedPair(edge.user1, edge.user2),
    )
    const positiveSet = new Set(
      positivePairs.map(([u, v]) => this.pairKey(u, v)),
    )

    const allUsers = [...neighbors.keys()]
    const components = this.connectedComponents(neighbors)
    const targetNegativeCount = positivePairs.length * negativeRatio
    const negatives = new Set<string>()

    for (const source of allUsers) {
      const distances = this.bfsDistances(
        neighbors,
        source,
        Math.max(...hardNegativeHops),
      )
      for (const [target, hop] of distances.entries()) {
        if (!hardNegativeHops.includes(hop)) continue
        const key = this.pairKey(source, target)
        if (!positiveSet.has(key)) negatives.add(key)
      }
    }

    const negativeList = [...negatives]
    for (let i = negativeList.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[negativeList[i], negativeList[j]] = [negativeList[j], negativeList[i]]
    }
    const sampledNegatives = negativeList.slice(0, targetNegativeCount)

    let attempts = 0
    const maxAttempts = Math.max(targetNegativeCount * 200, 1000)
    while (sampledNegatives.length < targetNegativeCount && attempts < maxAttempts) {
      attempts++
      const a = allUsers[Math.floor(rand() * allUsers.length)]
      const b = allUsers[Math.floor(rand() * allUsers.length)]
      if (!a || !b || a === b) continue
      const key = this.pairKey(a, b)
      if (positiveSet.has(key) || sampledNegatives.includes(key)) continue
      if (components.get(a) !== components.get(b)) continue
      if (neighbors.get(a)?.has(b)) continue
      const hop = this.bfsDistances(neighbors, a, Math.max(...hardNegativeHops)).get(b)
      if (!hop || !hardNegativeHops.includes(hop)) continue
      sampledNegatives.push(key)
    }

    if (sampledNegatives.length < targetNegativeCount) {
      this.logger.warn(
        `Only sampled ${sampledNegatives.length}/${targetNegativeCount} negatives`,
      )
    }

    const involvedUsers = new Set<string>()
    for (const [u, v] of positivePairs) {
      involvedUsers.add(u)
      involvedUsers.add(v)
    }
    for (const key of sampledNegatives) {
      const [u, v] = key.split('|')
      involvedUsers.add(u)
      involvedUsers.add(v)
    }

    const userIds = [...involvedUsers]
    const [snapshots, groupsByUser, bioVectors] = await Promise.all([
      this.fetchSnapshots(userIds),
      this.fetchGroupsByUser(userIds),
      this.fetchBioVectors(userIds),
    ])

    const records: TrainingRow[] = []
    for (const [u, v] of positivePairs) {
      records.push(
        this.computeFeaturesForPair({
          u,
          v,
          label: 1,
          neighbors,
          degrees,
          bioVectors,
          snapshots,
          groupsByUser,
        }),
      )
    }

    for (const key of sampledNegatives) {
      const [u, v] = key.split('|')
      records.push(
        this.computeFeaturesForPair({
          u,
          v,
          label: 0,
          neighbors,
          degrees,
          bioVectors,
          snapshots,
          groupsByUser,
        }),
      )
    }

    this.logger.log(
      `Built dataset rows=${records.length} positives=${positivePairs.length} negatives=${sampledNegatives.length}`,
    )
    return records
  }
}
