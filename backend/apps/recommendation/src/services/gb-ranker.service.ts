import { Injectable, Logger } from '@nestjs/common'
import { readFile, writeFile, mkdir } from 'fs/promises'
import * as path from 'path'
import { SAFE_FEATURES } from './feature.service'
import {
  GradientBoostingClassifier,
  GradientBoostingModelJson,
  StandardScaler,
} from '../ml/gradient-boosting'

export type RankingCandidateInput = {
  candidateId: string
  jaccard?: number
  cosine_graph?: number
  adamic_adar?: number
  pref_attach?: number
  deg_u?: number
  deg_v?: number
  dist_km?: number
  dist_bucket?: number
  bio_cosine?: number
  bio_dot?: number
  bio_l2?: number
  same_cluster?: number
  group_inter?: number
  group_jaccard?: number
  same_group?: number
}

type LoadedBundle = {
  model: GradientBoostingClassifier
  scaler: StandardScaler
}

@Injectable()
export class GbRankerService {
  private readonly logger = new Logger(GbRankerService.name)
  private bundlePromise: Promise<LoadedBundle> | null = null

  getModelPath(): string {
    return (
      process.env.GB_MODEL_PATH?.trim() ||
      path.join(process.cwd(), 'apps/recommendation/models/gb.json')
    )
  }

  async saveModel(payload: GradientBoostingModelJson): Promise<string> {
    const modelPath = this.getModelPath()
    await mkdir(path.dirname(modelPath), { recursive: true })
    await writeFile(modelPath, JSON.stringify(payload), 'utf8')
    this.bundlePromise = null
    return modelPath
  }

  async loadBundle(): Promise<LoadedBundle> {
    if (!this.bundlePromise) {
      this.bundlePromise = (async () => {
        const modelPath = this.getModelPath()
        const raw = await readFile(modelPath, 'utf8')
        const payload = JSON.parse(raw) as GradientBoostingModelJson
        return GradientBoostingClassifier.fromJSON(payload)
      })()
    }
    return this.bundlePromise
  }

  async rankTopK(
    candidates: RankingCandidateInput[],
    k = 100,
  ): Promise<{ status: 'ok' | 'empty' | 'error'; data: any[]; message?: string }> {
    if (!candidates.length) {
      return { status: 'empty', data: [] }
    }

    try {
      const { model, scaler } = await this.loadBundle()
      const matrix = candidates.map((candidate) =>
        SAFE_FEATURES.map((feature) => {
          const raw = candidate[feature as keyof RankingCandidateInput]
          const value = Number(raw ?? 0)
          return Number.isFinite(value) ? value : -1
        }),
      )
      const scaled = scaler.transform(matrix)
      const probs = model.predictProba(scaled)

      const ranked = candidates
        .map((candidate, index) => ({
          ...candidate,
          score: probs[index]?.[1] ?? 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)

      return { status: 'ok', data: ranked }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`rankTopK failed: ${message}`)
      return { status: 'error', data: [], message }
    }
  }

  async predictTop100(
    candidates: RankingCandidateInput[],
  ): Promise<RankingCandidateInput[]> {
    const result = await this.rankTopK(candidates, 100)
    if (result.status !== 'ok') {
      return []
    }
    return result.data
  }
}
