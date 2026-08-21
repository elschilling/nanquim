function roundMilliseconds(value) {
  return Math.round(value * 1000) / 1000
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new TypeError('At least one performance sample is required.')
  }
  const values = samples.map(Number)
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Performance samples must be finite non-negative milliseconds.')
  }
  return values.sort((a, b) => a - b)
}

function percentileNearestRank(sortedValues, percentile) {
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new RangeError('Percentile must be greater than zero and at most one.')
  }
  const rank = Math.max(1, Math.ceil(percentile * sortedValues.length))
  return sortedValues[rank - 1]
}

function summarizeSamples(samples) {
  const sorted = validateSamples(samples)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
  return Object.freeze({
    median: roundMilliseconds(median),
    p95: roundMilliseconds(percentileNearestRank(sorted, 0.95)),
    samples: Object.freeze(samples.map(value => roundMilliseconds(Number(value)))),
  })
}

function evaluateBudget(summary, budget) {
  if (!summary || !budget) throw new TypeError('A summary and budget are required.')
  const medianPassed = summary.median <= budget.median
  const p95Passed = summary.p95 <= budget.p95
  return Object.freeze({
    budget,
    medianPassed,
    p95Passed,
    passed: medianPassed && p95Passed,
  })
}

export { evaluateBudget, summarizeSamples }
