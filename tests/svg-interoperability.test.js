// @vitest-environment jsdom

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { prepareDocumentSource } from '../src/js/document/DocumentParser.js'

const FIXTURE_DIRECTORY = join(process.cwd(), 'tests', 'fixtures')

async function fixture(name) {
  return readFile(join(FIXTURE_DIRECTORY, name), 'utf8')
}

function localReferences(root) {
  const references = new Set()
  root.querySelectorAll('*').forEach(element => {
    for (const name of ['href', 'xlink:href', 'fill', 'stroke', 'clip-path', 'marker-start', 'marker-mid', 'marker-end']) {
      const value = element.getAttribute(name)
      if (!value) continue
      const direct = name === 'href' || name === 'xlink:href' ? /^#(.+)$/.exec(value) : null
      const functional = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/.exec(value)
      const id = direct?.[1] || functional?.[1]
      if (id) references.add(id)
    }
  })
  return Array.from(references).sort()
}

describe('SVG interoperability profile', () => {
  test('keeps its authored semantic inventory and explicit physical units', async () => {
    const [source, manifestSource] = await Promise.all([
      fixture('interoperability-profile.svg'),
      fixture('interoperability-profile.expected.json'),
    ])
    const manifest = JSON.parse(manifestSource)
    const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement

    expect(source).toContain('SPDX-License-Identifier: GPL-3.0-only')
    expect(root.querySelector('parsererror')).toBeNull()
    expect(root.getAttribute('width')).toBe(`${manifest.physicalSize.width}mm`)
    expect(root.getAttribute('height')).toBe(`${manifest.physicalSize.height}mm`)
    expect(root.getAttribute('viewBox').split(/\s+/).map(Number)).toEqual(manifest.viewBox)
    Object.entries(manifest.supportedElementCounts).forEach(([name, count]) => {
      expect(root.querySelectorAll(name), name).toHaveLength(count)
    })
    expect(localReferences(root)).toEqual(manifest.localReferences)
  })

  test('imports the safe profile with its vectors and local references intact', async () => {
    const source = await fixture('interoperability-profile.svg')
    const candidate = prepareDocumentSource(source, {
      name: 'interoperability-profile.svg',
      type: 'image/svg+xml',
    })
    const root = candidate.root

    expect(candidate).toMatchObject({
      format: 'svg',
      isNative: false,
      kind: 'foreign-svg',
      requiresSave: true,
    })
    for (const id of ['profile-line', 'profile-circle', 'profile-ellipse', 'profile-arc', 'profile-spline', 'profile-label']) {
      expect(root.querySelector(`#${id}`), id).not.toBeNull()
    }
    for (const id of localReferences(root)) {
      expect(root.querySelector(`#${id}`), `local reference #${id}`).not.toBeNull()
    }
    expect(root.querySelector('#profile-rect').getAttribute('stroke-width')).toBe('0.8')
    expect(root.querySelector('#profile-transformed').getAttribute('transform')).toBe('translate(12 92) rotate(-8 24 12)')
    expect(root.querySelector('#profile-label').textContent).toBe('Room & curve <profile>')
  })

  test('reports and removes unsupported active/external content without losing the safe fallback', async () => {
    const source = await fixture('interoperability-unsupported.svg')
    const candidate = prepareDocumentSource(source, {
      name: 'interoperability-unsupported.svg',
      type: 'image/svg+xml',
    })
    const root = candidate.root

    expect(candidate.diagnostics.map(diagnostic => diagnostic.code)).toContain('sanitized-content')
    expect(candidate.requiresSave).toBe(true)
    expect(root.querySelector('#safe-fallback')).not.toBeNull()
    expect(root.querySelector('script, foreignObject')).toBeNull()
    expect(root.querySelector('[onload], [onclick], [onerror]')).toBeNull()
    expect(root.querySelector('image')?.getAttribute('href') || '').not.toMatch(/^https?:/)
  })

  test('keeps purpose-built qualification fixtures outside production assets', async () => {
    const publicEntries = await readdir(join(process.cwd(), 'public'), { recursive: true })
    expect(publicEntries).not.toEqual(expect.arrayContaining([
      expect.stringContaining('interoperability-profile'),
      expect.stringContaining('interoperability-unsupported'),
      expect.stringContaining('dxf-layers-units-r2000'),
    ]))
  })
})
