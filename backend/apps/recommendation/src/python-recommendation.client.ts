import { Injectable, Logger } from '@nestjs/common'

type CandidateFeatures = {
  candidateId: string
  mutualFriends: number
  mutualGroups: number
  interestSimilarity: number
  distanceKm: number
}

@Injectable()
export class PythonRecommendationClient {
  private readonly logger = new Logger(PythonRecommendationClient.name)
  private readonly pythonTopKUrl =
    process.env.PYTHON_TOPK_URL ?? 'http://127.0.0.1:8000/top-k'

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
      this.logger.log(`Calling Python API with ${candidates.length} candidates`)

      const response = await fetch(this.pythonTopKUrl, {
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
          `Python API error: status ${response.status} body=${errorBody}`,
        )
      }

      const result = await response.json()
      if (result?.status !== 'ok' || !Array.isArray(result?.data)) {
        this.logger.error('Invalid response from Python API', result)
        return []
      }

      this.logger.log(`Received ${result.data.length} results from Python`)
      return result.data
    } catch (error) {
      this.logger.error('Python top-k request failed:', error)
      return []
    } finally {
      clearTimeout(timeout)
    }
  }
}
