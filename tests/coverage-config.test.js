import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import viteConfig from '../vite.config.js'

const METRICS = ['branches', 'functions', 'lines', 'statements']
const PHASE_2_FLOORS = {
  'src/js/commands/CompositeCommand.js': {
    branches: 93,
    functions: 100,
    lines: 85,
    statements: 85,
  },
  'src/js/commands/EditRectangleCommand.js': {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
  'src/js/commands/TrimTransaction.js': {
    branches: 88,
    functions: 90,
    lines: 91,
    statements: 90,
  },
  'src/js/commands/VertexEditTransaction.js': {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
  'src/js/utils/geometryTransformQualification.js': {
    branches: 87,
    functions: 100,
    lines: 100,
    statements: 92,
  },
  'src/js/utils/hatchTransformQualification.js': {
    branches: 80,
    functions: 96,
    lines: 88,
    statements: 83,
  },
  'src/js/utils/invalidateSpatialIndexes.js': {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
  'src/js/utils/vertexCoordinateSpace.js': {
    branches: 88,
    functions: 100,
    lines: 100,
    statements: 100,
  },
}

describe('Vitest coverage policy', () => {
  test('covers application modules while excluding vendored and generated surfaces', () => {
    const coverage = viteConfig.test.coverage

    expect(coverage).toMatchObject({
      provider: 'v8',
      enabled: false,
      include: ['src/js/**/*.js'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
    })
    expect(coverage.exclude).toEqual(expect.arrayContaining([
      'src/js/libs/**',
      'public/**',
      'dist/**',
      'coverage/**',
      'tests/browser/**',
    ]))
    expect(coverage.reporter).toEqual(expect.arrayContaining(['text', 'json-summary', 'html']))
  })

  test('enforces the global baseline and exact one-file module floors', () => {
    const thresholds = viteConfig.test.coverage.thresholds
    const localThresholds = Object.entries(thresholds)
      .filter(([, value]) => typeof value === 'object')

    expect(METRICS.map((metric) => thresholds[metric])).toEqual([48, 66, 58, 56])
    expect(localThresholds.length).toBeGreaterThanOrEqual(20)

    for (const [path, local] of localThresholds) {
      expect(path).toMatch(/^src\/js\/.+\.js$/)
      expect(path).not.toMatch(/[?*{}[\]]/)
      expect(existsSync(join(process.cwd(), path)), `${path} coverage target`).toBe(true)
      expect(local).not.toHaveProperty('perFile')
      expect(local.statements).toBeGreaterThanOrEqual(80)
      expect(local.branches).toBeGreaterThanOrEqual(70)
      expect(local.functions).toBeGreaterThanOrEqual(80)
      expect(local.lines).toBeGreaterThanOrEqual(80)
    }
  })

  test('keeps each Phase 2 transaction and coordinate module on its measured floor', () => {
    const thresholds = viteConfig.test.coverage.thresholds

    for (const [pattern, floors] of Object.entries(PHASE_2_FLOORS)) {
      expect(thresholds).toHaveProperty(pattern)
      expect(thresholds[pattern]).toEqual(floors)
    }
  })

  test('publishes the command and keeps generated reports out of Git', async () => {
    const [gitignore, packageSource, testingGuide] = await Promise.all([
      readFile(join(process.cwd(), '.gitignore'), 'utf8'),
      readFile(join(process.cwd(), 'package.json'), 'utf8'),
      readFile(join(process.cwd(), 'docs', 'testing.md'), 'utf8'),
    ])
    const packageMetadata = JSON.parse(packageSource)

    expect(packageMetadata.scripts['test:coverage']).toBe('vitest run --coverage')
    expect(gitignore).toMatch(/^\/coverage\/$/m)
    expect(testingGuide).toContain('Coverage baseline and ratchet')
    expect(testingGuide).toContain('expectNoInteractionLeaks()')
  })
})
