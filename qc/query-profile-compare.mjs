/**
 * So hai lần chạy query-profile.mjs:  node qc/query-profile-compare.mjs before after
 * In bảng và ghi qc/.profile-runs/compare.json (artifact đọc file này).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [A = 'before', B = 'after'] = process.argv.slice(2)
const dir = new URL('./.profile-runs/', import.meta.url).pathname
const load = (l) => JSON.parse(readFileSync(`${dir}${l}.json`, 'utf8'))
const a = load(A)
const b = load(B)
const byId = (run) => Object.fromEntries(run.results.map((r) => [r.id, r]))
const ra = byId(a)
const rb = byId(b)

const ratio = (x, y) => (x && y !== undefined && y !== null ? Math.round((x / Math.max(y, 0.0001)) * 10) / 10 : null)
const rows = []
for (const id of [...new Set([...Object.keys(ra), ...Object.keys(rb)])]) {
  const x = ra[id] ?? {}
  const y = rb[id] ?? {}
  if (x.perOp || y.perOp) {
    rows.push({
      id,
      wallP50: [x.wallP50 ?? x.apiMs ?? null, y.wallP50 ?? y.apiMs ?? null],
      commands: [x.perOp?.commands, y.perOp?.commands],
      docs: [x.perOp?.docs, y.perOp?.docs],
      keys: [x.perOp?.keys, y.perOp?.keys],
      dbMs: [x.perOp?.dbMs, y.perOp?.dbMs],
      txn: [x.perOp?.txnStarted, y.perOp?.txnStarted],
      lookup: [Boolean(x.lookup), Boolean(y.lookup)],
      collscan: [Boolean(x.collscan), Boolean(y.collscan)],
      error: [x.error ?? null, y.error ?? null],
      extra: id === 'delete-group' ? { before: { hiddenMs: x.hiddenMs, purgedMs: x.purgedMs, left: x.left }, after: { hiddenMs: y.hiddenMs, purgedMs: y.purgedMs, left: y.left } } : undefined,
      speedup: ratio(x.wallP50 ?? x.apiMs, y.wallP50 ?? y.apiMs),
    })
  } else {
    rows.push({
      id,
      throughput: [x.stored, y.stored],
      ackP95: [x.ackP95, y.ackP95],
      txn: [x.txnStarted, y.txnStarted],
      aborted: [x.txnAborted, y.txnAborted],
      lost: [x.summary?.lost, y.summary?.lost],
      reorder: [x.summary?.reorder, y.summary?.reorder],
    })
  }
}

const f = (v) => (v === undefined || v === null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v)
console.table(rows.map((r) => (r.throughput
  ? { id: r.id, 'msg/s': `${f(r.throughput[0])} → ${f(r.throughput[1])}`, 'ack p95': `${f(r.ackP95[0])} → ${f(r.ackP95[1])}`, txn: `${f(r.txn[0])} → ${f(r.txn[1])}`, abort: `${f(r.aborted[0])} → ${f(r.aborted[1])}`, lost: `${f(r.lost[0])} → ${f(r.lost[1])}` }
  : { id: r.id, 'p50 ms': `${f(r.wallP50[0])} → ${f(r.wallP50[1])}`, 'lệnh': `${f(r.commands[0])} → ${f(r.commands[1])}`, docs: `${f(r.docs[0])} → ${f(r.docs[1])}`, txn: `${f(r.txn[0])} → ${f(r.txn[1])}`, '$lookup': `${r.lookup[0]} → ${r.lookup[1]}`, COLLSCAN: `${r.collscan[0]} → ${r.collscan[1]}`, 'lỗi': r.error.some(Boolean) ? `${r.error[0] ? 'có' : '—'} → ${r.error[1] ? 'có' : '—'}` : '' })))
writeFileSync(`${dir}compare.json`, JSON.stringify({ before: A, after: B, at: new Date().toISOString(), rows }, null, 2))
console.log(`→ ${dir}compare.json`)
