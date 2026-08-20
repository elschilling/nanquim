// @vitest-environment jsdom

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createBlockDefinition,
  getBlockDefinition,
  insertBlockInstance,
  rebuildBlockDefinitionsFromDOM,
} from '../src/js/BlockManager.js'

function createEditor() {
  const svg = SVG().addTo(document.body)
  const drawing = svg.group().attr('id', 'Collection')
  const collection = drawing.group().attr({
    id: 'collection-1',
    'data-collection': 'true',
  })
  return {
    blockDefinitions: new Map(),
    drawing,
    elementIndex: 5,
    fullSpatialIndex: { markDirty: vi.fn() },
    spatialIndex: { markDirty: vi.fn() },
    svg,
    activeCollection: collection,
  }
}

describe('block definition identity', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
    if (!globalThis.CSS) globalThis.CSS = {}
    if (!globalThis.CSS.escape) {
      globalThis.CSS.escape = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    }
  })

  test('decouples an XML-special display name from its fragment id', () => {
    const editor = createEditor()
    const name = `Door & <north> "primary" 'A'`
    const source = editor.activeCollection.rect(4, 3).move(10, 20)

    const definition = createBlockDefinition(editor, name, [source], { x: 10, y: 20 })
    const metadata = editor.blockDefinitions.get(name)

    expect(definition.attr('id')).toBe('block-def-5')
    expect(definition.attr('data-block-name')).toBe(name)
    expect(metadata).toMatchObject({ defId: 'block-def-5', elementCount: 1 })
    expect(getBlockDefinition(editor, name)).toBe(definition)

    const instance = insertBlockInstance(editor, name, { x: 30, y: 40 }, editor.activeCollection)
    expect(instance.attr('href')).toBe('#block-def-5')
    expect(instance.attr('data-block-name')).toBe(name)
  })

  test('rebuilds current opaque and legacy block definitions', () => {
    const editor = createEditor()
    editor.svg.defs().group().attr({
      id: 'block-def-42',
      'data-block-def': 'true',
      'data-block-name': 'North & South',
      'data-base-point': JSON.stringify({ x: 2, y: 3 }),
    }).rect(2, 2)
    editor.svg.defs().group().attr({
      id: 'block-LegacyChair',
      'data-block-def': 'true',
      'data-base-point': JSON.stringify({ x: 0, y: 0 }),
    }).circle(3)

    rebuildBlockDefinitionsFromDOM(editor)

    expect(editor.blockDefinitions.get('North & South')).toEqual({
      defId: 'block-def-42',
      basePoint: { x: 2, y: 3 },
      elementCount: 1,
    })
    expect(editor.blockDefinitions.get('LegacyChair')).toEqual({
      defId: 'block-LegacyChair',
      basePoint: { x: 0, y: 0 },
      elementCount: 1,
    })
  })

  test('accepts the exact block-name boundary and rejects names that cannot round-trip', () => {
    const editor = createEditor()
    const source = editor.activeCollection.rect(1, 1)
    const boundary = 'B'.repeat(256)

    expect(() => createBlockDefinition(editor, boundary, [source], { x: 0, y: 0 }))
      .not.toThrow()
    expect(() => createBlockDefinition(editor, 'B'.repeat(257), [source], { x: 0, y: 0 }))
      .toThrow(/1-256 characters/)
    expect(() => createBlockDefinition(editor, 'A\tB', [source], { x: 0, y: 0 }))
      .toThrow(/control characters/)
    expect(() => createBlockDefinition(editor, ' A', [source], { x: 0, y: 0 }))
      .toThrow(/outer whitespace/)
  })
})
