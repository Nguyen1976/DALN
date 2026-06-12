import { Injectable, Logger } from '@nestjs/common'
import { QdrantService } from '@app/qdrant/qdrant.service'
import { UtilService } from '@app/util/util.service'

export type EmbedUserInput = {
  id: string
  bio: string
  age: number
}

export type EmbedAndSaveResult = {
  status: 'ok' | 'empty' | 'error'
  updated?: number
  matched?: number
  qdrant_upserted?: number
  skipped_empty_bio?: boolean
  message?: string
}

type FeatureExtractionPipeline = (
  input: string | string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly utilService: UtilService,
  ) {}

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const { pipeline } = await import('@huggingface/transformers')
        const modelName =
          process.env.EMBEDDING_MODEL_NAME?.trim() ||
          'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
        return pipeline('feature-extraction', modelName) as Promise<FeatureExtractionPipeline>
      })()
    }
    return this.extractorPromise
  }

  private buildEmbedText(bio: string, age: number): string {
    return `Tieu su: ${bio}. Doi tuong: ${age} tuoi.`
  }

  private tensorToVectors(
    output: { data: Float32Array; dims: number[] },
    batchSize: number,
  ): number[][] {
    const [rows, dims] = output.dims.length === 2
      ? output.dims
      : [batchSize, output.data.length / batchSize]
    const vectors: number[][] = []
    for (let i = 0; i < rows; i++) {
      const start = i * dims
      vectors.push(Array.from(output.data.slice(start, start + dims)))
    }
    return vectors
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    const extractor = await this.getExtractor()
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return this.tensorToVectors(output, texts.length)
  }

  async embedAndSave(users: EmbedUserInput[]): Promise<EmbedAndSaveResult> {
    if (!users.length) {
      return { status: 'empty' }
    }

    const substantial = users.filter((user) => (user.bio || '').trim())
    if (!substantial.length) {
      return {
        status: 'ok',
        updated: 0,
        matched: 0,
        qdrant_upserted: 0,
        skipped_empty_bio: true,
      }
    }

    try {
      const texts = substantial.map((user) =>
        this.buildEmbedText(user.bio, user.age),
      )
      const vectors = await this.embedTexts(texts)

      let qdrantUpserted = 0
      for (let i = 0; i < substantial.length; i++) {
        const user = substantial[i]
        const vector = vectors[i]
        if (!user.id || !vector?.length) continue

        const qdrantPointId = this.utilService.mongoIdToUuid(user.id)
        await this.qdrantService.upsertVector(qdrantPointId, vector, {
          mongoId: user.id,
        })
        qdrantUpserted++
      }

      return {
        status: 'ok',
        updated: substantial.length,
        matched: substantial.length,
        qdrant_upserted: qdrantUpserted,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`embedAndSave failed: ${message}`)
      return { status: 'error', message }
    }
  }
}
