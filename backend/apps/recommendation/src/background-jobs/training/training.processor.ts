import { Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { ModelTrainingService } from '../../services/model-training.service'
import { TRAINING_QUEUE, TrainingJobPayload } from './training.constants'

/**
 * Chỉ được đăng ký ở tiến trình có RECOMMENDATION_ROLE=worker.
 * `concurrency: 1` vì train là tác vụ CPU đồng bộ — chạy song song hai job
 * trên cùng một tiến trình Node không nhanh hơn, chỉ làm cả hai cùng chậm.
 */
@Processor(TRAINING_QUEUE, { concurrency: 1 })
export class TrainingProcessor extends WorkerHost {
  private readonly logger = new Logger(TrainingProcessor.name)

  constructor(private readonly modelTraining: ModelTrainingService) {
    super()
  }

  async process(job: Job<TrainingJobPayload>) {
    const { kind } = job.data
    this.logger.log(`Bắt đầu job ${kind} (id=${job.id})`)
    const startedAt = Date.now()

    const result =
      kind === 'evaluate'
        ? await this.modelTraining.evaluate()
        : await this.modelTraining.train()

    this.logger.log(
      `Job ${kind} (id=${job.id}) xong sau ${Date.now() - startedAt}ms — status=${result.status}`,
    )
    return result
  }
}
