// ml-cart ships no typings. This covers what gradient-boosting.ts uses.
declare module 'ml-cart' {
  export interface DecisionTreeRegressionOptions {
    gainFunction?: 'regression'
    splitFunction?: 'mean'
    minNumSamples?: number
    maxDepth?: number
  }

  /** A trained tree, as `toJSON` writes it and `load` reads it back. */
  export interface DecisionTreeRegressionModel {
    name: 'DTRegression'
    options: DecisionTreeRegressionOptions & { kind: 'regression' }
    root: unknown
  }

  export class DecisionTreeRegression {
    constructor(options?: DecisionTreeRegressionOptions)
    train(trainingSet: number[][], trainingValues: number[]): void
    predict(toPredict: number[][]): number[]
    toJSON(): DecisionTreeRegressionModel
    static load(model: DecisionTreeRegressionModel): DecisionTreeRegression
  }
}
