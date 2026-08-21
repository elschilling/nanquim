import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_PERFORMANCE_SAMPLES,
  PERFORMANCE_BUDGETS_MS,
  PERFORMANCE_DATASET_SIZES,
  PERFORMANCE_METRICS,
  assertPerformanceConfiguration,
} from '../scripts/performance/config.mjs'
import {
  createDatasetDefinition,
  createNativeSvgDataset,
  elementDescriptorAt,
  iterateElementDescriptors,
} from '../scripts/performance/dataset.mjs'
import { evaluateBudget, summarizeSamples } from '../scripts/performance/statistics.mjs'
import { assertSafeArtifactsDirectory } from '../scripts/browser/path-safety.mjs'

describe('deterministic performance datasets', () => {
  test.each([
    [1000, 'fnv1a-e81dcdcc', 50263],
    [10000, 'fnv1a-f55245f4', 521846],
  ])('generates %i stable elements without a stored fixture', (count, checksum, sourceBytes) => {
    const first = createNativeSvgDataset(count)
    const second = createNativeSvgDataset(count)
    const elementMarkup = first.source.match(/<(?:line|rect|circle|polyline)\b/g) || []

    expect(first.checksum).toBe(checksum)
    expect(first.sourceBytes).toBe(sourceBytes)
    expect(first.source).toBe(second.source)
    expect(elementMarkup).toHaveLength(count)
    expect(first.sourceBytes).toBeLessThan(1024 * 1024)
    expect(first.source).toContain(`data-element-index="${count + 1}"`)
  })

  test('uses stable mixed geometry on a bounded grid', () => {
    const definition = createDatasetDefinition(1000)
    expect(definition).toMatchObject({ columns: 32, count: 1000, rows: 32, spacing: 12 })
    expect(elementDescriptorAt(0, definition)).toEqual({
      id: '1', type: 'line', x1: 0, y1: 0, x2: 8, y2: 4,
    })
    expect(elementDescriptorAt(1, definition)).toEqual({
      id: '2', type: 'rect', x: 12, y: 0, width: 8, height: 6,
    })
    expect(elementDescriptorAt(2, definition)).toEqual({
      id: '3', type: 'circle', cx: 28, cy: 4, r: 3,
    })
    expect(elementDescriptorAt(3, definition)).toEqual({
      id: '4', type: 'polyline', points: [[36, 0], [40, 7], [44, 2]],
    })
    expect(Array.from(iterateElementDescriptors(definition))).toHaveLength(1000)
  })

  test.each([0, 999, 1001, 9999, 10001, NaN])('rejects unsupported size %s', size => {
    expect(() => createDatasetDefinition(size)).toThrow(/exactly 1,000 or 10,000/)
  })
})

describe('performance statistics and policy', () => {
  test('reports a deterministic median and nearest-rank p95', () => {
    expect(summarizeSamples([9.87654, 1, 5, 3, 7])).toEqual({
      median: 5,
      p95: 9.877,
      samples: [9.877, 1, 5, 3, 7],
    })
    expect(summarizeSamples([2, 4, 6, 8])).toMatchObject({ median: 5, p95: 8 })
  })

  test('evaluates median and p95 independently', () => {
    expect(evaluateBudget({ median: 10, p95: 20 }, { median: 10, p95: 20 })).toMatchObject({
      medianPassed: true,
      p95Passed: true,
      passed: true,
    })
    expect(evaluateBudget({ median: 11, p95: 19 }, { median: 10, p95: 20 })).toMatchObject({
      medianPassed: false,
      p95Passed: true,
      passed: false,
    })
  })

  test('has an explicit valid budget for every metric and dataset size', () => {
    expect(assertPerformanceConfiguration()).toBe(true)
    expect(DEFAULT_PERFORMANCE_SAMPLES).toBeGreaterThanOrEqual(5)
    expect(PERFORMANCE_DATASET_SIZES).toEqual([1000, 10000])
    for (const size of PERFORMANCE_DATASET_SIZES) {
      expect(Object.keys(PERFORMANCE_BUDGETS_MS[size]).sort()).toEqual([...PERFORMANCE_METRICS].sort())
    }
  })
})

describe('performance evidence safety and repository wiring', () => {
  const temporaryDirectories = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => (
      rm(path, { recursive: true, force: true })
    )))
  })

  test('allows only a strict run directory below the performance artifact root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nanquim-performance-safety-'))
    temporaryDirectories.push(root)
    const repositoryRoot = join(root, 'repository')
    const artifactsRoot = join(repositoryRoot, 'test-results/performance')
    const candidate = join(artifactsRoot, 'chromium')
    await mkdir(artifactsRoot, { recursive: true })

    await expect(assertSafeArtifactsDirectory(candidate, {
      artifactsRoot,
      repositoryRoot,
    })).resolves.toBe(candidate)
    await expect(assertSafeArtifactsDirectory(artifactsRoot, {
      artifactsRoot,
      repositoryRoot,
    })).rejects.toThrow('strict child')
  })

  test('wires a production-build script, ignored evidence, and no public fixture output', async () => {
    const [packageSource, ignoreSource, runnerSource, documentation] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/performance/run-benchmarks.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../docs/performance.md', import.meta.url), 'utf8'),
    ])
    const packageJson = JSON.parse(packageSource)

    expect(packageJson.scripts['test:performance']).toBe(
      'pnpm build && node scripts/performance/run-benchmarks.mjs --browser=chromium',
    )
    expect(ignoreSource).toMatch(/^\/test-results\/$/m)
    expect(runnerSource).toContain("join(ROOT, 'test-results/performance')")
    expect(runnerSource).toContain('assertSafeArtifactsDirectory')
    expect(runnerSource).not.toMatch(/public[/\\].*performance/i)
    expect(documentation).toContain('never included in the report')
  })
})
