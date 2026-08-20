// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import DxfHelper from '../src/js/libs/dxf/src/Helper.js'
import { parseSafeJson, sanitizeSvgDocument } from '../src/js/utils/sanitizeSvg.js'

async function readFixture(name) {
  const source = await readFile(join(process.cwd(), 'tests', 'fixtures', name), 'utf8')
  expect(source).toContain('SPDX-FileCopyrightText: 2026 Nanquim contributors')
  expect(source).toContain('SPDX-License-Identifier: GPL-3.0-only')
  return source
}

function parseSvg(source) {
  const documentRef = new DOMParser().parseFromString(source, 'image/svg+xml')
  expect(documentRef.querySelector('parsererror')).toBeNull()
  return sanitizeSvgDocument(documentRef)
}

function directCollections(root) {
  return Array.from(root.children).filter(
    (child) => child.localName === 'g' && child.getAttribute('data-collection') === 'true',
  )
}

function expectValidNativeRoot(root, version) {
  expect(root.localName).toBe('svg')
  expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg')
  expect(root.getAttribute('data-nanquim-version')).toBe(String(version))

  const ids = Array.from(root.querySelectorAll('[id]'), (element) => element.id)
  expect(ids.every(Boolean)).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)

  const numericIds = ids.filter((id) => /^\d+$/.test(id)).map(Number)
  const nextElementIndex = Number(root.getAttribute('data-element-index'))
  expect(Number.isSafeInteger(nextElementIndex)).toBe(true)
  expect(nextElementIndex).toBeGreaterThan(Math.max(...numericIds))

  const paperConfig = parseSafeJson(root.getAttribute('data-paper-config'))
  const paperViewports = parseSafeJson(root.getAttribute('data-paper-viewports'))
  expect(paperConfig).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
  expect(Array.isArray(paperViewports)).toBe(true)
  expect(directCollections(root).length).toBeGreaterThan(0)
}

describe('Phase 0 format fixtures', () => {
  test('parses and preserves the purpose-built native schema-v1 document', async () => {
    const root = parseSvg(await readFixture('native-v1.svg'))
    expectValidNativeRoot(root, 1)

    const [collection] = directCollections(root)
    expect(collection.getAttribute('name')).toBe('Fixture v1')
    expect(collection.getAttribute('data-locked')).toBe('false')

    const line = collection.querySelector('line')
    expect([line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')])
      .toEqual(['10', '15', '90', '15'])

    const circle = collection.querySelector('circle')
    expect([circle.getAttribute('cx'), circle.getAttribute('cy'), circle.getAttribute('r')])
      .toEqual(['35', '45', '12'])

    const polyline = collection.querySelector('polyline')
    expect(polyline.getAttribute('points').trim().split(/\s+/)).toEqual(['60,55', '80,35', '105,55'])

    expect(parseSafeJson(root.getAttribute('data-paper-config'))).toMatchObject({
      size: 'A4',
      orientation: 'portrait',
      unitsPerCm: 1,
    })
  })

  test('parses historical schema-v2 definitions, styles, Paper data, and graph metadata', async () => {
    const root = parseSvg(await readFixture('native-v2.svg'))
    expectValidNativeRoot(root, 2)

    expect(directCollections(root).map((collection) => ({
      name: collection.getAttribute('name'),
      locked: collection.getAttribute('data-locked'),
    }))).toEqual([
      { name: 'Fixture geometry', locked: 'false' },
      { name: 'Fixture guides', locked: 'true' },
    ])

    const gradient = root.querySelector('defs linearGradient#fixture-gradient')
    expect(Array.from(gradient.querySelectorAll('stop'), (stop) => stop.getAttribute('stop-color')))
      .toEqual(['#ffffff', '#777777'])
    expect(root.querySelector('[id="5"]').getAttribute('fill')).toBe('url(#fixture-gradient)')

    const blockDefinition = root.querySelector('[data-block-def="true"]')
    const blockInstance = root.querySelector('[data-block-instance="true"]')
    expect(blockDefinition.id).toBe('block-Chair')
    expect(blockDefinition.children).toHaveLength(2)
    expect(blockInstance.getAttribute('href')).toBe('#block-Chair')
    expect(blockInstance.getAttribute('data-block-name')).toBe('Chair')

    const blockMetadata = parseSafeJson(root.getAttribute('data-block-definitions'))
    expect(blockMetadata).toEqual([[
      'Chair',
      { defId: 'block-Chair', basePoint: { x: 0, y: 0 }, elementCount: 2 },
    ]])

    const textStyles = parseSafeJson(root.getAttribute('data-text-styles'))
    const dimensionStyles = parseSafeJson(root.getAttribute('data-dim-styles'))
    expect(textStyles.styles[0]).toMatchObject({
      id: 'Standard',
      properties: { fontFamily: 'Inter', fontWeight: '400' },
    })
    expect(dimensionStyles.styles[0]).toMatchObject({
      id: 'Standard',
      properties: { textStyleId: 'Standard', markerType: 'arrow' },
    })

    expect(parseSafeJson(root.getAttribute('data-paper-viewports'))).toEqual([{
      id: 'vp-fixture',
      x: 15,
      y: 12,
      w: 180,
      h: 120,
      scale: 50,
      modelOriginX: 20,
      modelOriginY: 10,
    }])

    const geometryNodes = root.querySelector('metadata#nanquim-geometry-nodes')
    expect(parseSafeJson(geometryNodes.textContent)).toEqual({ version: 1, graphs: [], instances: [] })
  })

  test('parses the DXF entities and renders their geometry to safe SVG', async () => {
    const helper = new DxfHelper(await readFixture('basic-entities-r2000.dxf'))
    const parsed = helper.parsed

    expect(parsed.header).toMatchObject({
      measurement: 1,
      insUnits: 4,
      extMin: { x: 0, y: 0, z: 0 },
      extMax: { x: 100, y: 80, z: 0 },
    })
    expect(parsed.tables.layers).toMatchObject({
      Walls: { type: 'LAYER', colorNumber: 7, lineTypeName: 'CONTINUOUS' },
      Fixtures: { type: 'LAYER', colorNumber: 3, lineTypeName: 'CONTINUOUS' },
    })
    expect(parsed.entities.map((entity) => entity.type)).toEqual(['LINE', 'CIRCLE', 'LWPOLYLINE'])

    const [line, circle, polyline] = parsed.entities
    expect(line).toMatchObject({
      layer: 'Walls',
      start: { x: 10, y: 10, z: 0 },
      end: { x: 90, y: 10, z: 0 },
    })
    expect(circle).toMatchObject({ layer: 'Fixtures', x: 50, y: 40, z: 0, r: 12 })
    expect(polyline).toMatchObject({
      layer: 'Walls',
      closed: true,
      vertices: [
        { x: 20, y: 25 },
        { x: 40, y: 25 },
        { x: 40, y: 55 },
        { x: 20, y: 55 },
      ],
    })

    const svgRoot = parseSvg(helper.toSVG())
    expect(svgRoot.getAttribute('viewBox')).toBe('10 -55 80 45')
    expect(directCollections(svgRoot).map((collection) => collection.getAttribute('name')).sort())
      .toEqual(['Fixtures', 'Walls'])

    const renderedLine = svgRoot.querySelector('line')
    const renderedCircle = svgRoot.querySelector('circle')
    const renderedPolyline = Array.from(svgRoot.querySelectorAll('path')).find(
      (path) => path.getAttribute('d').startsWith('M20,25L40,25'),
    )
    expect([
      renderedLine.getAttribute('x1'),
      renderedLine.getAttribute('y1'),
      renderedLine.getAttribute('x2'),
      renderedLine.getAttribute('y2'),
    ]).toEqual(['10', '10', '90', '10'])
    expect([renderedCircle.getAttribute('cx'), renderedCircle.getAttribute('cy'), renderedCircle.getAttribute('r')])
      .toEqual(['50', '40', '12'])
    expect(renderedPolyline.getAttribute('d')).toBe('M20,25L40,25L40,55L20,55L20,25')
  })
})
