import { DecisionTreeRegression } from 'ml-cart'

export type ScalerState = {
  mean: number[]
  std: number[]
}

export type GradientBoostingModelJson = {
  type: 'GradientBoostingClassifier'
  featureNames: string[]
  learningRate: number
  initialLogOdds: number
  scaler: ScalerState
  trees: ReturnType<DecisionTreeRegression['toJSON']>[]
}

export class StandardScaler {
  mean: number[] = []
  std: number[] = []

  fit(X: number[][]): void {
    if (!X.length) return
    const dims = X[0].length
    this.mean = new Array(dims).fill(0)
    this.std = new Array(dims).fill(1)

    for (let j = 0; j < dims; j++) {
      let sum = 0
      for (let i = 0; i < X.length; i++) {
        sum += X[i][j]
      }
      const mean = sum / X.length
      this.mean[j] = mean

      let varSum = 0
      for (let i = 0; i < X.length; i++) {
        varSum += (X[i][j] - mean) ** 2
      }
      const std = Math.sqrt(varSum / X.length)
      this.std[j] = std > 1e-12 ? std : 1
    }
  }

  transform(X: number[][]): number[][] {
    return X.map((row) =>
      row.map((value, j) => (value - this.mean[j]) / this.std[j]),
    )
  }

  toJSON(): ScalerState {
    return { mean: [...this.mean], std: [...this.std] }
  }

  static fromJSON(state: ScalerState): StandardScaler {
    const scaler = new StandardScaler()
    scaler.mean = [...state.mean]
    scaler.std = [...state.std]
    return scaler
  }
}

export class GradientBoostingClassifier {
  trees: DecisionTreeRegression[] = []
  learningRate = 0.1
  nEstimators = 100
  maxDepth = 3
  initialLogOdds = 0

  fit(X: number[][], y: number[]): void {
    if (!X.length) {
      throw new Error('Cannot train on empty dataset')
    }

    const positives = y.filter((label) => label === 1).length
    const p = Math.max(1e-15, Math.min(1 - 1e-15, positives / y.length))
    this.initialLogOdds = Math.log(p / (1 - p))

    const scores = new Array(y.length).fill(this.initialLogOdds)
    this.trees = []

    for (let t = 0; t < this.nEstimators; t++) {
      const residuals = scores.map((score, i) => {
        const prob = 1 / (1 + Math.exp(-score))
        return y[i] - prob
      })

      const tree = new DecisionTreeRegression({
        maxDepth: this.maxDepth,
        minNumSamples: 3,
      })
      tree.train(X, residuals)
      const treePred = tree.predict(X) as number[]

      for (let i = 0; i < scores.length; i++) {
        scores[i] += this.learningRate * Number(treePred[i] ?? 0)
      }
      this.trees.push(tree)
    }
  }

  rawScores(X: number[][]): number[] {
    const scores = X.map(() => this.initialLogOdds)
    for (const tree of this.trees) {
      const preds = tree.predict(X) as number[]
      for (let i = 0; i < scores.length; i++) {
        scores[i] += this.learningRate * Number(preds[i] ?? 0)
      }
    }
    return scores
  }

  predictProba(X: number[][]): number[][] {
    return this.rawScores(X).map((score) => {
      const p1 = 1 / (1 + Math.exp(-score))
      return [1 - p1, p1]
    })
  }

  toJSON(featureNames: string[], scaler: StandardScaler): GradientBoostingModelJson {
    return {
      type: 'GradientBoostingClassifier',
      featureNames: [...featureNames],
      learningRate: this.learningRate,
      initialLogOdds: this.initialLogOdds,
      scaler: scaler.toJSON(),
      trees: this.trees.map((tree) => tree.toJSON()),
    }
  }

  static fromJSON(payload: GradientBoostingModelJson): {
    model: GradientBoostingClassifier
    scaler: StandardScaler
  } {
    if (payload.type !== 'GradientBoostingClassifier') {
      throw new Error(`Unsupported model type: ${payload.type}`)
    }

    const model = new GradientBoostingClassifier()
    model.learningRate = payload.learningRate
    model.initialLogOdds = payload.initialLogOdds
    model.trees = payload.trees.map((tree) =>
      DecisionTreeRegression.load(tree),
    )
    model.nEstimators = model.trees.length

    return {
      model,
      scaler: StandardScaler.fromJSON(payload.scaler),
    }
  }
}

export function trainTestSplit(
  X: number[][],
  y: number[],
  testSize = 0.2,
  seed = 42,
): {
  XTrain: number[][]
  XTest: number[][]
  yTrain: number[]
  yTest: number[]
} {
  const indices = X.map((_, i) => i)
  let state = seed
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  indices.sort(() => rand() - 0.5)

  const testCount = Math.max(1, Math.floor(X.length * testSize))
  const testSet = new Set(indices.slice(0, testCount))

  const XTrain: number[][] = []
  const XTest: number[][] = []
  const yTrain: number[] = []
  const yTest: number[] = []

  for (let i = 0; i < X.length; i++) {
    if (testSet.has(i)) {
      XTest.push(X[i])
      yTest.push(y[i])
    } else {
      XTrain.push(X[i])
      yTrain.push(y[i])
    }
  }

  return { XTrain, XTest, yTrain, yTest }
}

export function f1Score(yTrue: number[], yPred: number[]): number {
  let tp = 0
  let fp = 0
  let fn = 0
  for (let i = 0; i < yTrue.length; i++) {
    if (yPred[i] === 1 && yTrue[i] === 1) tp++
    else if (yPred[i] === 1 && yTrue[i] === 0) fp++
    else if (yPred[i] === 0 && yTrue[i] === 1) fn++
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

export function rocAucScore(yTrue: number[], yScore: number[]): number {
  const pairs = yTrue
    .map((label, i) => ({ label, score: yScore[i] }))
    .sort((a, b) => b.score - a.score)

  let nPos = 0
  let nNeg = 0
  for (const pair of pairs) {
    if (pair.label === 1) nPos++
    else nNeg++
  }
  if (nPos === 0 || nNeg === 0) return Number.NaN

  let tp = 0
  let fp = 0
  let prevTp = 0
  let prevFp = 0
  let auc = 0
  let prevScore = Number.POSITIVE_INFINITY

  for (const pair of pairs) {
    if (pair.score !== prevScore) {
      auc +=
        (fp - prevFp) * (tp + prevTp) +
        (tp - prevTp) * (fp - prevFp) * 0.5
      prevScore = pair.score
      prevTp = tp
      prevFp = fp
    }
    if (pair.label === 1) tp++
    else fp++
  }

  auc +=
    (fp - prevFp) * (tp + prevTp) + (tp - prevTp) * (fp - prevFp) * 0.5
  return auc / (nPos * nNeg)
}
