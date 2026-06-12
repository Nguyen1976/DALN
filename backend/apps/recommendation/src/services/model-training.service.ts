import { Injectable, Logger } from '@nestjs/common'
import {
  f1Score,
  GradientBoostingClassifier,
  rocAucScore,
  StandardScaler,
  trainTestSplit,
} from '../ml/gradient-boosting'
import { SAFE_FEATURES } from './feature.service'
import { DatasetBuilderService, TrainingRow } from './dataset-builder.service'
import { GbRankerService } from './gb-ranker.service'

type Metrics = {
  train_f1: number
  test_f1: number
  train_auc: number
  test_auc: number
  rows: number
  positives: number
  negatives: number
}

@Injectable()
export class ModelTrainingService {
  private readonly logger = new Logger(ModelTrainingService.name)

  constructor(
    private readonly datasetBuilder: DatasetBuilderService,
    private readonly gbRanker: GbRankerService,
  ) {}

  private rowsToMatrix(rows: TrainingRow[]): {
    X: number[][]
    y: number[]
  } {
    const X = rows.map((row) =>
      SAFE_FEATURES.map((feature) => {
        const value = Number(row[feature] ?? -1)
        return Number.isFinite(value) ? value : -1
      }),
    )
    const y = rows.map((row) => row.label)
    return { X, y }
  }

  private evaluateSplit(
    model: GradientBoostingClassifier,
    X: number[][],
    y: number[],
  ) {
    const probs = model.predictProba(X).map((pair) => pair[1])
    const preds = probs.map((score) => (score >= 0.5 ? 1 : 0))
    return {
      f1: f1Score(y, preds),
      auc: rocAucScore(y, probs),
    }
  }

  async train(): Promise<{
    status: 'ok' | 'error'
    modelPath?: string
    metrics?: Metrics
    message?: string
  }> {
    try {
      const rows = await this.datasetBuilder.buildDataset()
      const { X, y } = this.rowsToMatrix(rows)
      const { XTrain, XTest, yTrain, yTest } = trainTestSplit(X, y, 0.2, 42)

      const scaler = new StandardScaler()
      scaler.fit(XTrain)
      const XTrainScaled = scaler.transform(XTrain)
      const XTestScaled = scaler.transform(XTest)

      const model = new GradientBoostingClassifier()
      model.fit(XTrainScaled, yTrain)

      const trainMetrics = this.evaluateSplit(model, XTrainScaled, yTrain)
      const testMetrics = this.evaluateSplit(model, XTestScaled, yTest)

      const modelPath = await this.gbRanker.saveModel(
        model.toJSON([...SAFE_FEATURES], scaler),
      )

      const metrics: Metrics = {
        train_f1: trainMetrics.f1,
        test_f1: testMetrics.f1,
        train_auc: trainMetrics.auc,
        test_auc: testMetrics.auc,
        rows: rows.length,
        positives: rows.filter((row) => row.label === 1).length,
        negatives: rows.filter((row) => row.label === 0).length,
      }

      this.logger.log(
        `Train complete path=${modelPath} test_f1=${metrics.test_f1.toFixed(4)} test_auc=${Number.isFinite(metrics.test_auc) ? metrics.test_auc.toFixed(4) : 'nan'}`,
      )

      return { status: 'ok', modelPath, metrics }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`train failed: ${message}`)
      return { status: 'error', message }
    }
  }

  async evaluate(): Promise<{
    status: 'ok' | 'error'
    metrics?: Metrics
    message?: string
  }> {
    try {
      const rows = await this.datasetBuilder.buildDataset()
      const { X, y } = this.rowsToMatrix(rows)
      const { XTrain, XTest, yTrain, yTest } = trainTestSplit(X, y, 0.2, 42)

      const bundle = await this.gbRanker.loadBundle()
      const XTestScaled = bundle.scaler.transform(XTest)
      const metricsSplit = this.evaluateSplit(bundle.model, XTestScaled, yTest)
      const XTrainScaled = bundle.scaler.transform(XTrain)
      const trainMetrics = this.evaluateSplit(bundle.model, XTrainScaled, yTrain)

      return {
        status: 'ok',
        metrics: {
          train_f1: trainMetrics.f1,
          test_f1: metricsSplit.f1,
          train_auc: trainMetrics.auc,
          test_auc: metricsSplit.auc,
          rows: rows.length,
          positives: rows.filter((row) => row.label === 1).length,
          negatives: rows.filter((row) => row.label === 0).length,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`evaluate failed: ${message}`)
      return { status: 'error', message }
    }
  }
}
