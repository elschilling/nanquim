// @vitest-environment jsdom

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { prepareDocumentSource } from '../src/js/document/DocumentParser.js'
import toSVG from '../src/js/libs/dxf/src/toSVG.js'
import { buildDXFDocument } from '../src/js/utils/DXFexporter.js'

function importedSvg(layers, entities) {
  const source = toSVG({
    header: { insUnits: 5 },
    blocks: [],
    diagnostics: { unsupportedEntityTypes: Object.create(null) },
    entities,
    tables: { layers },
  })
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  expect(parsed.querySelector('parsererror')).toBeNull()
  return parsed.documentElement
}

function line(layer, colorNumber, options = {}) {
  return {
    type: 'LINE',
    layer,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 5 },
    ...(colorNumber === undefined ? {} : { colorNumber }),
    ...options,
  }
}

function importedLayer(root, name) {
  return root.querySelector(`[data-collection="true"][name="${name}"]`)
}

function elementStroke(element) {
  return element.parentElement.getAttribute('stroke')
}

beforeEach(() => {
  document.body.replaceChildren()
  registerWindow(window, document)
})

afterEach(() => document.body.replaceChildren())

describe('DXF color import', () => {
  test.each([undefined, 256])('preserves white layer color for inherited entity color %s', colorNumber => {
    const root = importedSvg({ White: { colorNumber: 7, flags: 0 } }, [line('White', colorNumber)])
    const collection = importedLayer(root, 'White')

    expect(collection.getAttribute('stroke')).toBe('rgb(255, 255, 255)')
    expect(elementStroke(collection.querySelector('line'))).toBe('rgb(255, 255, 255)')
  })

  test('preserves explicit white on a colored layer', () => {
    const root = importedSvg({ Red: { colorNumber: 1, flags: 0 } }, [line('Red', 7)])
    const collection = importedLayer(root, 'Red')

    expect(collection.getAttribute('stroke')).toBe('rgb(255, 0, 0)')
    expect(elementStroke(collection.querySelector('line'))).toBe('rgb(255, 255, 255)')
  })

  test.each([
    [1, 'rgb(255, 0, 0)'],
    [3, 'rgb(0, 255, 0)'],
    [5, 'rgb(0, 0, 255)'],
    [250, 'rgb(51, 51, 51)'],
  ])('retains non-white ACI %s layer and entity colors', (colorNumber, stroke) => {
    const root = importedSvg({ Color: { colorNumber, flags: 0 } }, [line('Color'), line('Color', colorNumber)])
    const collection = importedLayer(root, 'Color')

    expect(collection.getAttribute('stroke')).toBe(stroke)
    expect([...collection.querySelectorAll('line')].map(elementStroke)).toEqual([stroke, stroke])
  })

  test('retains colored entity overrides on a white layer', () => {
    const root = importedSvg({ White: { colorNumber: 7, flags: 0 } }, [line('White', 5)])
    const collection = importedLayer(root, 'White')

    expect(collection.getAttribute('stroke')).toBe('rgb(255, 255, 255)')
    expect(elementStroke(collection.querySelector('line'))).toBe('rgb(0, 0, 255)')
  })

  test.each([
    ['hidden', { colorNumber: -7, flags: 0 }, 'true', 'false'],
    ['frozen', { colorNumber: 7, flags: 1 }, 'true', 'false'],
    ['locked', { colorNumber: 7, flags: 4 }, 'false', 'true'],
    ['hidden and locked', { colorNumber: -7, flags: 4 }, 'true', 'true'],
  ])('preserves white inheritance on a %s layer', (_state, layer, hidden, locked) => {
    const root = importedSvg({ White: layer }, [line('White', 256)])
    const collection = importedLayer(root, 'White')

    expect(collection.getAttribute('stroke')).toBe('rgb(255, 255, 255)')
    expect(elementStroke(collection.querySelector('line'))).toBe('rgb(255, 255, 255)')
    expect(collection.getAttribute('data-hidden')).toBe(hidden)
    expect(collection.getAttribute('data-locked')).toBe(locked)
    expect(collection.getAttribute('style')?.includes('display:none') || false).toBe(hidden === 'true')
  })

  test('preserves hidden entity visibility independently of its white override', () => {
    const root = importedSvg({ Red: { colorNumber: 1, flags: 0 } }, [line('Red', 7, { visible: false })])
    const collection = importedLayer(root, 'Red')
    const entity = collection.querySelector('line').parentElement

    expect(collection.getAttribute('data-hidden')).toBe('false')
    expect(entity.getAttribute('stroke')).toBe('rgb(255, 255, 255)')
    expect(entity.getAttribute('data-hidden')).toBe('true')
    expect(entity.getAttribute('style')).toContain('display:none')
  })

  test.each([
    ['white layer inheritance', '#ffffff', null, 'rgb(255, 255, 255)'],
    ['white attribute inheritance', '#ffffff', 'inherit', 'rgb(255, 255, 255)'],
    ['white currentColor fallback', '#ffffff', 'currentColor', 'rgb(255, 255, 255)'],
    ['colored layer inheritance', '#ff0000', null, 'rgb(255, 0, 0)'],
    ['colored attribute inheritance', '#ff0000', 'inherit', 'rgb(255, 0, 0)'],
    ['colored currentColor fallback', '#ff0000', 'currentColor', 'rgb(255, 0, 0)'],
    ['explicit white override', '#ff0000', '#ffffff', 'rgb(255, 255, 255)'],
  ])('preserves %s through DXF export and sanitized reimport', (_label, layerStroke, override, expectedStroke) => {
    const svg = SVG().addTo(document.body)
    const drawing = svg.group().attr('id', 'Collection')
    const collection = drawing.group().attr({
      id: 'colors',
      name: 'Colors',
      'data-collection': 'true',
      stroke: layerStroke,
    })
    const geometry = collection.line(0, 0, 10, 5)
    if (override) geometry.stroke(override)
    const editor = {
      drawing,
      collections: new Map([['colors', {
        group: collection,
        visible: true,
        locked: false,
        style: { stroke: layerStroke, fill: 'transparent' },
      }]]),
    }
    const original = drawing.node.outerHTML

    const exported = buildDXFDocument(editor)
    const candidate = prepareDocumentSource(exported.source, { name: 'colors.dxf' })
    const imported = importedLayer(candidate.root, 'Colors')

    expect(candidate.kind).toBe('dxf')
    expect(candidate.diagnostics).toEqual([])
    expect(imported.getAttribute('stroke')).toBe(layerStroke === '#ffffff'
      ? 'rgb(255, 255, 255)' : 'rgb(255, 0, 0)')
    expect(elementStroke(imported.querySelector('line'))).toBe(expectedStroke)
    expect(exported.counts.skipped).toBe(0)
    expect(drawing.node.outerHTML).toBe(original)
  })

  test.each(['attribute', 'inline CSS'])('preserves nested %s group paint and child overrides through DXF export and reimport', paintSource => {
    const svg = SVG().addTo(document.body)
    const drawing = svg.group().attr('id', 'Collection')
    const collection = drawing.group().attr({
      id: 'colors', name: 'Colors', 'data-collection': 'true', stroke: '#ffffff',
    })
    const group = collection.group()
    if (paintSource === 'attribute') group.stroke('#0000ff')
    else group.css({ stroke: '#0000ff' })
    group.line(0, 0, 10, 5)
    group.group().line(0, 10, 10, 15).attr('stroke', 'inherit')
    group.line(0, 20, 10, 25).stroke('#ff0000')
    const editor = {
      drawing,
      collections: new Map([['colors', {
        group: collection,
        visible: true,
        locked: false,
        style: { stroke: '#ffffff', fill: 'transparent' },
      }]]),
    }
    const original = drawing.node.outerHTML

    const candidate = prepareDocumentSource(buildDXFDocument(editor).source, { name: 'nested-colors.dxf' })
    const imported = importedLayer(candidate.root, 'Colors')

    expect([...imported.querySelectorAll('line')].map(elementStroke)).toEqual([
      'rgb(0, 0, 255)', 'rgb(0, 0, 255)', 'rgb(255, 0, 0)',
    ])
    expect(imported.getAttribute('stroke')).toBe('rgb(255, 255, 255)')
    expect(candidate.diagnostics).toEqual([])
    expect(drawing.node.outerHTML).toBe(original)
  })
})
