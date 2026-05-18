import { Injectable, Logger } from '@nestjs/common'

type CandidateFeatures = {
  candidateId: string
  jaccard: number
  cosine_graph: number
  adamic_adar: number
  pref_attach: number
  deg_u: number
  deg_v: number
  dist_km: number
  dist_bucket: number
  bio_cosine: number
  bio_dot: number
  bio_l2: number
  same_cluster: number
  group_inter: number
  group_jaccard: number
  same_group: number
}

@Injectable()
export class PythonRecommendationClient {
  private readonly logger = new Logger(PythonRecommendationClient.name)
  /** Gradient Boosting ranker — embedding-service POST /recommend/rank */
  private readonly recommendRankUrl =
    process.env.PYTHON_RECOMMEND_URL?.trim() ||
    process.env.PYTHON_TOPK_URL?.trim() ||
    'http://127.0.0.1:8000/recommend/rank'

  async predictTop100(
    candidates: CandidateFeatures[],
  ): Promise<CandidateFeatures[]> {
    if (!candidates.length) {
      this.logger.warn('Empty candidates list, returning empty result')
      return []
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      this.logger.log(
        `Calling embedding recommend/rank with ${candidates.length} candidates`,
      )

      const response = await fetch(this.recommendRankUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: candidates,
          k: 100,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `Recommend API error: status ${response.status} body=${errorBody}`,
        )
      }

      const result = await response.json()
      if (result?.status !== 'ok' || !Array.isArray(result?.data)) {
        this.logger.error('Invalid response from recommend/rank', result)
        return []
      }

      this.logger.log(`Received ${result.data.length} results from recommend/rank`)
      return result.data
    } catch (error) {
      this.logger.error('Python recommend/rank request failed:', error)
      return []
    } finally {
      clearTimeout(timeout)
    }
  }
}
