const PERFORMANCE_DATASET_SIZES = Object.freeze([1000, 10000])

const PERFORMANCE_METRICS = Object.freeze([
  'load',
  'canonicalSave',
  'spatialIndexRebuild',
  'spatialIndexQuery',
  'pan',
  'zoom',
  'windowSelection',
  'snap',
  'outlinerSync',
  'geometryNodesEvaluation',
])

const DEFAULT_PERFORMANCE_SAMPLES = 5
const DEFAULT_PERFORMANCE_WARMUPS = 1
const MIN_PERFORMANCE_SAMPLES = 3
const MAX_PERFORMANCE_SAMPLES = 20

// These are regression tripwires, not optimization targets. They are
// deliberately tolerant of stock headless browsers on shared developer and CI
// machines while still catching order-of-magnitude regressions. Tightening a
// budget requires repeated evidence on every supported dataset size.
const PERFORMANCE_BUDGETS_MS = Object.freeze({
  1000: Object.freeze({
    load: Object.freeze({ median: 2500, p95: 5000 }),
    canonicalSave: Object.freeze({ median: 1200, p95: 2500 }),
    spatialIndexRebuild: Object.freeze({ median: 1200, p95: 2500 }),
    spatialIndexQuery: Object.freeze({ median: 100, p95: 300 }),
    pan: Object.freeze({ median: 500, p95: 1200 }),
    zoom: Object.freeze({ median: 500, p95: 1200 }),
    windowSelection: Object.freeze({ median: 1800, p95: 4000 }),
    snap: Object.freeze({ median: 700, p95: 1800 }),
    outlinerSync: Object.freeze({ median: 1800, p95: 4000 }),
    geometryNodesEvaluation: Object.freeze({ median: 1800, p95: 4000 }),
  }),
  10000: Object.freeze({
    load: Object.freeze({ median: 15000, p95: 30000 }),
    canonicalSave: Object.freeze({ median: 7000, p95: 15000 }),
    spatialIndexRebuild: Object.freeze({ median: 8000, p95: 18000 }),
    spatialIndexQuery: Object.freeze({ median: 500, p95: 1500 }),
    pan: Object.freeze({ median: 1500, p95: 4000 }),
    zoom: Object.freeze({ median: 1500, p95: 4000 }),
    windowSelection: Object.freeze({ median: 7000, p95: 18000 }),
    snap: Object.freeze({ median: 2500, p95: 7000 }),
    outlinerSync: Object.freeze({ median: 10000, p95: 25000 }),
    geometryNodesEvaluation: Object.freeze({ median: 10000, p95: 25000 }),
  }),
})

function assertPerformanceConfiguration() {
  for (const size of PERFORMANCE_DATASET_SIZES) {
    const budgets = PERFORMANCE_BUDGETS_MS[size]
    if (!budgets) throw new TypeError(`Missing performance budgets for ${size} elements.`)

    for (const metric of PERFORMANCE_METRICS) {
      const budget = budgets[metric]
      if (!budget) throw new TypeError(`Missing ${metric} budget for ${size} elements.`)
      if (
        !Number.isFinite(budget.median)
        || !Number.isFinite(budget.p95)
        || budget.median <= 0
        || budget.p95 < budget.median
      ) {
        throw new TypeError(`Invalid ${metric} budget for ${size} elements.`)
      }
    }
  }
  return true
}

export {
  DEFAULT_PERFORMANCE_SAMPLES,
  DEFAULT_PERFORMANCE_WARMUPS,
  MAX_PERFORMANCE_SAMPLES,
  MIN_PERFORMANCE_SAMPLES,
  PERFORMANCE_BUDGETS_MS,
  PERFORMANCE_DATASET_SIZES,
  PERFORMANCE_METRICS,
  assertPerformanceConfiguration,
}
