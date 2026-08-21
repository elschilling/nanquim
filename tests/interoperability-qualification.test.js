import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  assertBlenderInventory,
  assertPinnedToolVersion,
  compareInkscapeBounds,
  detectLibreCadVersion,
  parseInkscapeBounds,
  semanticSvgInventory,
} from '../scripts/qualification/run-interoperability.mjs'

describe('external interoperability qualification contract', () => {
  test('matches the authored SVG semantic manifest before external tools run', async () => {
    const [source, manifestSource] = await Promise.all([
      readFile(join(process.cwd(), 'tests/fixtures/interoperability-profile.svg'), 'utf8'),
      readFile(join(process.cwd(), 'tests/fixtures/interoperability-profile.expected.json'), 'utf8'),
    ])
    const inventory = semanticSvgInventory(source)
    const manifest = JSON.parse(manifestSource)

    expect(inventory.counts).toEqual(manifest.supportedElementCounts)
    expect(inventory.viewBox).toEqual(manifest.viewBox)
    expect(inventory.width).toBe(`${manifest.physicalSize.width}mm`)
    expect(inventory.height).toBe(`${manifest.physicalSize.height}mm`)
    expect(inventory.references).toEqual(manifest.localReferences)
    expect(inventory.missingReferences).toEqual([])
    expect(manifest.blenderImport).toEqual({ objects: 17, curves: 14, splines: 14 })
    expect(manifest.toolVersions).toEqual({
      inkscape: '^Inkscape 1\\.4\\.4(?:[ (]|$)',
      blender: '^Blender 5\\.2\\.0 LTS(?:[ (]|$)',
    })
  })

  test('requires an ignored strict-child artifact directory and records the manual LibreCAD boundary', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/qualification/run-interoperability.mjs'),
      'utf8',
    )

    expect(source).toContain('test-results/interoperability')
    expect(source).toContain('assertSafeArtifactsDirectory')
    expect(source).toContain("status: 'manual-required'")
    expect(source).toContain("'-noaudio'")
    expect(source).not.toMatch(/https?:\/\//)
  })

  test('compares Inkscape query bounds with the authored tolerance', () => {
    const before = parseInkscapeBounds([
      'profile-line,10,20,30,0.5',
      'profile-arc,40,50,60,70',
    ].join('\n'))
    const after = parseInkscapeBounds([
      'profile-line,10.004,20,30,0.5',
      'profile-arc,40,50.002,60,70',
    ].join('\n'))

    expect(compareInkscapeBounds(before, after, 0.01)).toEqual({
      compared: 2,
      maxDelta: expect.closeTo(0.004, 8),
    })
    expect(() => compareInkscapeBounds(before, new Map(), 0.01))
      .toThrow(/omitted qualified geometry bounds/)
    expect(() => compareInkscapeBounds(before, parseInkscapeBounds(
      'profile-line,10.02,20,30,0.5\nprofile-arc,40,50,60,70',
    ), 0.01)).toThrow(/changed qualified geometry bounds/)
  })

  test('requires the exact pinned Blender import inventory', () => {
    const expected = { objects: 17, curves: 14, splines: 14 }
    expect(assertBlenderInventory({ result: ['FINISHED'], ...expected }, expected)).toMatchObject(expected)
    expect(() => assertBlenderInventory({ result: ['FINISHED'], ...expected, objects: 16 }, expected))
      .toThrow(/objects count/)
    expect(() => assertBlenderInventory({ result: ['CANCELLED'], ...expected }, expected))
      .toThrow(/did not finish/)
  })

  test('keeps LibreCAD detection best-effort across package-manager platforms', () => {
    const calls = []
    const runner = (command) => {
      calls.push(command)
      if (command === 'librecad') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      if (command === 'rpm') return { status: 1, stdout: '', stderr: 'not installed' }
      if (command === 'dpkg-query') return { status: 0, stdout: '2.2.1.2', stderr: '' }
      throw new Error('unexpected command')
    }

    expect(detectLibreCadVersion(runner)).toBe('2.2.1.2')
    expect(calls).toEqual(['librecad', 'rpm', 'dpkg-query'])
    expect(detectLibreCadVersion(() => { throw new Error('missing') })).toBe('not detected')
  })

  test('rejects external tool versions outside the pinned profile', () => {
    expect(assertPinnedToolVersion('Inkscape', 'Inkscape 1.4.4 (build)', '^Inkscape 1\\.4\\.4(?:[ (]|$)'))
      .toBe('Inkscape 1.4.4 (build)')
    expect(() => assertPinnedToolVersion('Inkscape', 'Inkscape 1.5', '^Inkscape 1\\.4\\.4(?:[ (]|$)'))
      .toThrow(/does not match/)
    expect(() => assertPinnedToolVersion('Blender', 'Blender 5.2.0 LTS', 'x'.repeat(257)))
      .toThrow(/pattern is invalid/)
  })
})
