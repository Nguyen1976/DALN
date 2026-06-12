/**
 * Bootstrap (tạm thời) GB model cho recommendation-service TỪ dataset đồ thị
 * có sẵn trong Neo4j (FRIEND graph + LINK đã gắn nhãn good/bad + split).
 *
 * Mục đích: có ngay 1 file `gb.json` đúng format để RCM dùng được, trong khi
 * dữ liệu production thật chưa đủ. Logic train-từ-production
 * (ModelTrainingService + DatasetBuilderService) KHÔNG bị đụng tới — vẫn để dùng
 * sau khi đã có đủ bạn bè/bio/nhóm thật.
 *
 * Vì Brightkite chỉ có topology nên các feature về vị trí/bio/nhóm được điền
 * GIÁ TRỊ MẶC ĐỊNH giống hệt lúc inference (dist=-1, bio=0, group=0, same_cluster=0),
 * model sẽ học chủ yếu từ các feature đồ thị (jaccard, adamic-adar, ...).
 *
 * Chạy:
 *   cd backend
 *   npm run rcm:train-bootstrap
 */
import neo4j from 'neo4j-driver'
import { mkdir, writeFile } from 'fs/promises'
import * as path from 'path'
import {
  FeatureService,
  SAFE_FEATURES,
} from '../apps/recommendation/src/services/feature.service'
import {
  GradientBoostingClassifier,
  StandardScaler,
  f1Score,
  rocAucScore,
} from '../apps/recommendation/src/ml/gradient-boosting'

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password123'
const MODEL_PATH =
  process.env.GB_MODEL_PATH?.trim() ||
  path.join(process.cwd(), 'apps/recommendation/models/gb.json')
// ml-cart rất chậm với dataset lớn, mà đây chỉ là model "tạm", nên subsample
// số cặp đã gắn nhãn cho mỗi class để train nhanh. Override bằng env nếu cần.
const MAX_PAIRS_PER_CLASS = Number(process.env.MAX_PAIRS_PER_CLASS || 3000)
const RANDOM_SEED = Number(process.env.RANDOM_SEED || 42)
// Số cây cho model tạm (ml-cart chậm). Chỉ áp dụng cho script này, không đổi
// hành vi mặc định của GradientBoostingClassifier dùng ở production.
const N_ESTIMATORS = Number(process.env.N_ESTIMATORS || 50)

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function subsampleBalanced(pairs: LabeledPair[]): LabeledPair[] {
  if (!Number.isFinite(MAX_PAIRS_PER_CLASS) || MAX_PAIRS_PER_CLASS <= 0) {
    return pairs
  }
  const rand = mulberry32(RANDOM_SEED)
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const result: LabeledPair[] = []
  for (const split of ['train', 'test']) {
    for (const label of [1, 0] as const) {
      const bucket = pairs.filter((p) => p.split === split && p.label === label)
      const cap =
        split === 'test'
          ? Math.ceil(MAX_PAIRS_PER_CLASS * 0.25)
          : MAX_PAIRS_PER_CLASS
      result.push(...shuffle(bucket).slice(0, cap))
    }
  }
  return result
}

type LabeledPair = { u: string; v: string; label: 0 | 1; split: string }

async function readFriendAdjacency(session: any): Promise<{
  adj: Map<string, Set<string>>
  degrees: Map<string, number>
}> {
  console.log('Đọc FRIEND graph từ Neo4j...')
  const adj = new Map<string, Set<string>>()
  const res = await session.run(
    'MATCH (a:User)-[:FRIEND]->(b:User) RETURN a.userId AS a, b.userId AS b',
  )
  for (const rec of res.records) {
    const a = String(rec.get('a'))
    const b = String(rec.get('b'))
    if (!a || !b || a === b) continue
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  const degrees = new Map<string, number>()
  for (const [id, neigh] of adj) degrees.set(id, neigh.size)
  console.log(`  nodes=${adj.size}`)
  return { adj, degrees }
}

async function readLabeledLinks(session: any): Promise<LabeledPair[]> {
  console.log('Đọc LINK đã gắn nhãn từ Neo4j...')
  const res = await session.run(
    'MATCH (a:User)-[r:LINK]->(b:User) ' +
      'RETURN a.userId AS a, b.userId AS b, r.label AS label, r.split AS split',
  )
  const rows: LabeledPair[] = res.records.map((rec: any) => ({
    u: String(rec.get('a')),
    v: String(rec.get('b')),
    label: (Number(rec.get('label')) === 1 ? 1 : 0) as 0 | 1,
    split: String(rec.get('split') ?? 'train'),
  }))
  console.log(`  labeled pairs=${rows.length}`)
  return rows
}

function buildRow(
  pair: LabeledPair,
  adj: Map<string, Set<string>>,
  degrees: Map<string, number>,
  feature: FeatureService,
): number[] {
  const neighU = new Set(adj.get(pair.u) ?? [])
  const neighV = new Set(adj.get(pair.v) ?? [])
  // anti-leakage: bỏ cạnh trực tiếp với cặp là bạn bè thật
  if (pair.label === 1) {
    neighU.delete(pair.v)
    neighV.delete(pair.u)
  }

  const features = feature.computePairFeatures({
    neighU,
    neighV,
    degrees,
    bioU: null,
    bioV: null,
    locationU: null,
    locationV: null,
    groupsU: new Set(),
    groupsV: new Set(),
    sameCluster: 0,
  })

  return SAFE_FEATURES.map((name) => {
    const value = Number((features as Record<string, number>)[name] ?? -1)
    return Number.isFinite(value) ? value : -1
  })
}

function evaluate(
  model: GradientBoostingClassifier,
  X: number[][],
  y: number[],
): { f1: number; auc: number } {
  if (!X.length) return { f1: NaN, auc: NaN }
  const probs = model.predictProba(X).map((pair) => pair[1])
  const preds = probs.map((p) => (p >= 0.5 ? 1 : 0))
  return { f1: f1Score(y, preds), auc: rocAucScore(y, probs) }
}

async function main() {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
  )
  const session = driver.session()

  try {
    const { adj, degrees } = await readFriendAdjacency(session)
    const allPairs = await readLabeledLinks(session)
    if (!allPairs.length) {
      throw new Error(
        'Không có LINK nào trong Neo4j. Hãy chạy training/1_load_and_label.py trước.',
      )
    }
    const pairs = subsampleBalanced(allPairs)
    console.log(
      `  dùng ${pairs.length}/${allPairs.length} cặp (subsample ${MAX_PAIRS_PER_CLASS}/class để train nhanh)`,
    )

    console.log('Tính 15 feature (topology thật + phần còn lại mặc định)...')
    const feature = new FeatureService()
    const XTrain: number[][] = []
    const yTrain: number[] = []
    const XTest: number[][] = []
    const yTest: number[] = []

    for (const pair of pairs) {
      const row = buildRow(pair, adj, degrees, feature)
      if (pair.split === 'test') {
        XTest.push(row)
        yTest.push(pair.label)
      } else {
        XTrain.push(row)
        yTrain.push(pair.label)
      }
    }
    console.log(
      `  train=${yTrain.length} (pos=${yTrain.filter((l) => l === 1).length}) ` +
        `test=${yTest.length} (pos=${yTest.filter((l) => l === 1).length})`,
    )

    const scaler = new StandardScaler()
    scaler.fit(XTrain)
    const XTrainScaled = scaler.transform(XTrain)
    const XTestScaled = scaler.transform(XTest)

    console.log(`Train GradientBoostingClassifier (giống RCM, nEstimators=${N_ESTIMATORS})...`)
    const model = new GradientBoostingClassifier()
    model.nEstimators = N_ESTIMATORS
    model.fit(XTrainScaled, yTrain)

    const trainMetrics = evaluate(model, XTrainScaled, yTrain)
    const testMetrics = evaluate(model, XTestScaled, yTest)

    const payload = model.toJSON([...SAFE_FEATURES], scaler)
    await mkdir(path.dirname(MODEL_PATH), { recursive: true })
    await writeFile(MODEL_PATH, JSON.stringify(payload), 'utf8')

    console.log('\n==============================================')
    console.log('BOOTSTRAP GB MODEL — HOÀN TẤT')
    console.log('==============================================')
    console.log(
      `  Train F1=${trainMetrics.f1.toFixed(4)}  AUC=${trainMetrics.auc.toFixed(4)}`,
    )
    console.log(
      `  Test  F1=${testMetrics.f1.toFixed(4)}  AUC=${testMetrics.auc.toFixed(4)}`,
    )
    console.log(`  Đã lưu model -> ${MODEL_PATH}`)
    console.log('  RCM sẽ tự nạp file này ở lần ranking tiếp theo.')
  } finally {
    await session.close()
    await driver.close()
  }
}

main().catch((err) => {
  console.error('❌ Lỗi:', err)
  process.exit(1)
})
