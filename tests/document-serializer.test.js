// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import {
  DOCUMENT_SCHEMA_VERSION,
  buildNativeDocument,
  serializeNativeDocument,
} from '../src/js/document/DocumentSerializer.js'
import {
  DEFAULT_DIMENSION_STYLE_PROPERTIES,
  DEFAULT_TEXT_STYLE_PROPERTIES,
  ELEMENT_DATA_METADATA_LIMITS,
  GEOMETRY_NODES_METADATA_LIMITS,
  NATIVE_STYLE_METADATA_LIMITS,
  PAPER_CONFIG_METADATA_LIMITS,
  assertDocumentSourceSize,
  assertXml10Characters,
} from '../src/js/document/DocumentMetadata.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SPECIAL_TEXT = `A & B < C > D "double" 'single'`

function svgElement(name, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, name)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value))
  if (text !== null) element.textContent = text
  return element
}

function addDocumentDefinitions(svg) {
  const defs = svg.defs()
  const importedAssets = defs.group().attr('data-nanquim-import-assets', 'true')
  importedAssets.node.append(
    svgElement('linearGradient', { id: 'imported-gradient' }),
    svgElement('clipPath', { id: 'imported-clip' }),
    svgElement('mask', { id: 'imported-mask' }),
    svgElement('marker', { id: 'imported-marker' }),
    svgElement('symbol', { id: 'imported-symbol' }),
    svgElement('style', {}, '#Collection .painted { fill: url(#imported-gradient); }'),
  )

  const pattern = svgElement('pattern', {
    id: 'hatch-ansi31-ffffff-10',
    'data-nanquim-document-def': 'true',
    width: '10',
    height: '10',
    patternUnits: 'userSpaceOnUse',
  })
  pattern.appendChild(svgElement('line', { x1: '0', y1: '0', x2: '10', y2: '10' }))
  defs.node.appendChild(pattern)

  defs.node.appendChild(svgElement('marker', { id: 'app-owned-marker' }))

  const block = defs.group().attr({
    id: 'block-safe-id',
    'data-block-def': 'true',
    'data-base-point': JSON.stringify({ x: 1, y: 2 }),
  })
  block.rect(4, 3).attr({ id: 'block-shape', name: SPECIAL_TEXT })
}

function createEditorFixture() {
  const svg = SVG().addTo(document.body).viewbox(-5, -10, 200, 100)
  addDocumentDefinitions(svg)

  const overlays = svg.group().attr('id', 'Overlays')
  overlays.line(0, 0, 99, 99).attr('id', 'overlay-helper')

  const drawing = svg.group().attr('id', 'Collection')
  const collection = drawing.group().attr({
    id: 'collection-1',
    name: SPECIAL_TEXT,
    'data-collection': 'true',
    'data-locked': 'false',
  })
  collection.css({ stroke: '#ffffff', fill: 'none' })

  const nested = collection.group().attr({ id: 'nested-group', 'data-group': 'true' })
  const arcData = {
    p1: { x: 0, y: 0 },
    p2: { x: 5, y: 4 },
    p3: { x: 10, y: 0 },
    label: SPECIAL_TEXT,
  }
  const arc = nested.path('M0 0 A5 5 0 0 1 10 0').attr({
    id: '1',
    'data-kind': 'arc',
    class: 'painted elementHover elementSelected',
    selected: 'true',
    'aria-selected': 'true',
    'aria-activedescendant': 'arc-handler',
    'data-collapsed': 'true',
  })
  arc.data('arcData', arcData)
  arc.attr('data-arc-data', JSON.stringify({ stale: true }))

  const semanticValues = {
    circleTrimData: { cx: 2, cy: 3, radius: 4 },
    ellipseArcData: { cx: 8, cy: 9, rx: 3, ry: 2, startAngle: 0, endAngle: 90 },
    hatchData: { pattern: 'ANSI31', scale: 10, color: '#ffffff' },
    splineData: { points: [{ x: 0, y: 0 }, { x: 4, y: 7 }, { x: 8, y: 1 }] },
  }
  Object.entries(semanticValues).forEach(([key, value], index) => {
    const path = nested.path(`M${index} ${index}L${index + 1} ${index + 2}`)
      .attr({ id: String(index + 2), 'data-kind': key })
    path.data(key, value)
  })

  const mapped = nested.rect(8, 4).attr({
    id: '6',
    'data-kind': 'mapped-color',
    stroke: '#ffffff',
    'data-nanquim-orig-stroke': '',
  })
  mapped.node.style.stroke = '#000000'

  nested.node.appendChild(svgElement('text', {
    id: '7',
    'data-kind': 'special-text',
    x: '1',
    y: '2',
  }, SPECIAL_TEXT))
  nested.use('block-safe-id').attr({
    id: '8',
    href: '#block-safe-id',
    'data-block-instance': 'true',
    'data-block-name': SPECIAL_TEXT,
  })

  collection.rect(20, 10).attr({ id: 'transient-marker', 'data-nanquim-transient': 'true' })
  collection.circle(3).attr({ id: 'block-ghost', 'data-block-ghost': 'true' })
  collection.line(0, 0, 1, 1).attr('id', 'class-ghost').addClass('ghostLine')
  collection.rect(5, 5).attr({ id: 'selection-rectangle', class: 'selectionRectangle' })
  drawing.group().attr({ id: 'block-edit-group', 'data-block-edit': 'true' })

  const paperSvg = SVG().addTo(document.body)
  const paperAnnotations = paperSvg.group().attr({
    id: 'paper-annotations',
    name: 'Annotations',
    'data-collection': 'true',
  })
  paperAnnotations.node.appendChild(svgElement('text', {
    id: '9',
    'data-kind': 'paper-text',
    x: '1',
    y: '2',
  }, SPECIAL_TEXT))
  paperAnnotations.line(1, 2, 3, 4)
    .attr({ id: '10', class: 'annotation elementSelected' })
    .data('splineData', { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
  paperAnnotations.rect(2, 2).attr({ id: 'paper-preview', 'data-rectangle-preview': 'true' })

  const dimensionStyles = {
    activeStyleId: 'Special',
    styles: [
      {
        id: 'Special',
        name: SPECIAL_TEXT,
        properties: { ...DEFAULT_DIMENSION_STYLE_PROPERTIES },
      },
      {
        id: 'Standard',
        name: 'Standard',
        properties: { ...DEFAULT_DIMENSION_STYLE_PROPERTIES },
      },
    ],
  }
  const textStyles = {
    activeStyleId: 'Special',
    styles: [
      {
        id: 'Special',
        name: SPECIAL_TEXT,
        properties: { ...DEFAULT_TEXT_STYLE_PROPERTIES },
      },
      {
        id: 'Standard',
        name: 'Standard',
        properties: { ...DEFAULT_TEXT_STYLE_PROPERTIES },
      },
    ],
  }
  const geometryNodes = {
    version: 1,
    activeObjectId: 'object-special',
    graphs: [{ id: 'graph-1', name: SPECIAL_TEXT, nodes: [], links: [] }],
    instances: [],
  }
  const blockDefinitions = new Map([[
    SPECIAL_TEXT,
    { defId: 'block-safe-id', basePoint: { x: 1, y: 2 }, elementCount: 1 },
  ]])

  const editor = {
    svg,
    drawing,
    activeCollection: collection,
    elementIndex: 11,
    isDrawing: false,
    isInteracting: false,
    editingBlock: null,
    collections: new Map([
      ['collection-1', {
        group: collection,
        visible: false,
        locked: true,
        style: {
          stroke: '#123456',
          'stroke-width': 0.25,
          'stroke-linecap': 'round',
          fill: 'transparent',
          opacity: 0.75,
        },
      }],
      ['paper-annotations', {
        group: paperAnnotations,
        visible: false,
        locked: true,
        style: {
          stroke: '#222222',
          'stroke-width': 0.1,
          fill: 'transparent',
        },
      }],
    ]),
    paperAnnotations,
    paperConfig: {
      size: 'A3',
      width: 420,
      height: 297,
      orientation: 'landscape',
      unitsPerCm: 1,
      colorMap: { '#ffffff': { printColor: '#000000', enabled: true } },
    },
    paperViewports: [{
      id: 'vp-special',
      x: 2,
      y: 3,
      w: 18,
      h: 12,
      scale: 50,
      modelOriginX: -12.5,
      modelOriginY: 6.25,
      visible: false,
      locked: true,
    }],
    dimensionManager: { toJSON: vi.fn(() => dimensionStyles) },
    textStyleManager: { toJSON: vi.fn(() => textStyles) },
    blockDefinitions,
    geometryNodes: { serialize: vi.fn(() => geometryNodes) },
  }

  return {
    arcData,
    blockDefinitions,
    dimensionStyles,
    editor,
    geometryNodes,
    modelSvg: svg.node,
    paperSvg: paperSvg.node,
    semanticValues,
    textStyles,
  }
}

function parseSerialized(source) {
  const documentRef = new DOMParser().parseFromString(source, 'image/svg+xml')
  expect(documentRef.querySelector('parsererror')).toBeNull()
  return documentRef.documentElement
}

describe('native document serializer', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
  })

  test('builds a complete schema-v3 XML document with definitions and exact metadata', () => {
    const fixture = createEditorFixture()
    const documentRef = buildNativeDocument(fixture.editor)
    const root = documentRef.documentElement

    expect(documentRef.contentType).toBe('image/svg+xml')
    expect(root.namespaceURI).toBe(SVG_NS)
    expect(root.getAttribute('data-nanquim-version')).toBe(String(DOCUMENT_SCHEMA_VERSION))
    expect(root.getAttribute('data-element-index')).toBe('11')
    expect(root.getAttribute('viewBox')).toBe('-5 -10 200 100')
    expect(root.getAttribute('data-active-collection-id')).toBe('collection-1')
    expect(JSON.parse(root.getAttribute('data-paper-config'))).toEqual(fixture.editor.paperConfig)
    expect(JSON.parse(root.getAttribute('data-paper-viewports'))).toEqual([{
      id: 'vp-special',
      x: 2,
      y: 3,
      w: 18,
      h: 12,
      scale: 50,
      modelOriginX: -12.5,
      modelOriginY: 6.25,
      visible: false,
      locked: true,
    }])
    expect(JSON.parse(root.getAttribute('data-dim-styles'))).toEqual(fixture.dimensionStyles)
    expect(JSON.parse(root.getAttribute('data-text-styles'))).toEqual(fixture.textStyles)
    expect(JSON.parse(root.getAttribute('data-block-definitions'))).toEqual(
      Array.from(fixture.blockDefinitions.entries()),
    )

    const metadata = root.querySelector('metadata#nanquim-geometry-nodes')
    const geometryNodesMetadata = JSON.parse(metadata.textContent)
    expect(fixture.geometryNodes.activeObjectId).toBe('object-special')
    expect(geometryNodesMetadata).not.toHaveProperty('activeObjectId')
    expect(geometryNodesMetadata).toEqual({
      version: fixture.geometryNodes.version,
      graphs: fixture.geometryNodes.graphs,
      instances: fixture.geometryNodes.instances,
    })

    const defs = root.querySelector(':scope > defs')
    expect(defs).not.toBeNull()
    for (const id of [
      'imported-gradient',
      'imported-clip',
      'imported-mask',
      'imported-marker',
      'imported-symbol',
      'hatch-ansi31-ffffff-10',
      'block-safe-id',
    ]) {
      expect(defs.querySelector(`[id="${id}"]`), id).not.toBeNull()
    }
    expect(defs.querySelector('style').textContent).toBe(
      'svg .painted{fill:url(#imported-gradient)}',
    )
    expect(root.querySelector('.painted').matches('svg .painted')).toBe(true)
    expect(defs.querySelector('[data-nanquim-import-assets]')).toBeNull()
    expect(defs.querySelector('#app-owned-marker')).toBeNull()
  })

  test('preserves Paper annotations and collection state while omitting transient UI', () => {
    const { editor } = createEditorFixture()
    const root = buildNativeDocument(editor).documentElement
    const annotations = root.querySelector(':scope > [data-nanquim-paper-annotations="true"]')
    const collection = root.querySelector(':scope > #collection-1')

    expect(annotations).not.toBeNull()
    expect(annotations.getAttribute('data-collection')).toBe('true')
    expect(annotations.getAttribute('data-locked')).toBe('true')
    expect(annotations.style.display).toBe('none')
    expect(annotations.style.stroke).toBe('rgb(34, 34, 34)')
    expect(annotations.querySelector('[data-kind="paper-text"]').textContent).toBe(SPECIAL_TEXT)
    expect(annotations.querySelector('#paper-preview')).toBeNull()
    expect(annotations.querySelector('.elementSelected')).toBeNull()

    expect(collection.getAttribute('name')).toBe(SPECIAL_TEXT)
    expect(collection.getAttribute('data-locked')).toBe('true')
    expect(collection.style.display).toBe('none')
    expect(collection.style.stroke).toBe('rgb(18, 52, 86)')
    expect(collection.style.opacity).toBe('0.75')
    expect(root.querySelector('#overlay-helper')).toBeNull()
    expect(root.querySelector('#transient-marker')).toBeNull()
    expect(root.querySelector('#block-ghost')).toBeNull()
    expect(root.querySelector('#class-ghost')).toBeNull()
    expect(root.querySelector('#block-edit-group')).toBeNull()
    expect(root.querySelector('#selection-rectangle')).toBeNull()
    expect(root.querySelector('.elementHover, .elementSelected, .ghostLine')).toBeNull()
    expect(root.querySelector('[data-collapsed]')).toBeNull()
    expect(root.querySelector('[selected], [aria-selected], [aria-activedescendant]')).toBeNull()
  })

  test('canonicalizes SVG.js semantic data and restores live Paper color mapping on clones', () => {
    const { arcData, editor, semanticValues } = createEditorFixture()
    const root = buildNativeDocument(editor).documentElement
    const expected = { arcData, ...semanticValues }
    const attributeNames = {
      arcData: 'data-arc-data',
      circleTrimData: 'data-circle-trim-data',
      ellipseArcData: 'data-ellipse-arc-data',
      hatchData: 'data-hatch-data',
      splineData: 'data-spline-data',
    }

    Object.entries(expected).forEach(([key, value]) => {
      const kind = key === 'arcData' ? 'arc' : key
      const element = root.querySelector(`[data-kind="${kind}"]`)
      const canonicalName = attributeNames[key]
      expect(JSON.parse(element.getAttribute(canonicalName))).toEqual(value)
      const aliases = Array.from(element.attributes).filter((attribute) => (
        attribute.name.toLowerCase().replace(/[^a-z0-9]/g, '')
          === `data${key.toLowerCase()}`
      ))
      expect(aliases.map((attribute) => attribute.name)).toEqual([canonicalName])
    })

    const mapped = root.querySelector('[data-kind="mapped-color"]')
    expect(mapped.getAttribute('stroke')).toBe('#ffffff')
    expect(mapped.style.stroke).toBe('')
    expect(mapped.hasAttribute('data-nanquim-orig-stroke')).toBe(false)

    const liveMapped = editor.drawing.node.querySelector('[data-kind="mapped-color"]')
    expect(liveMapped.style.stroke).toBe('rgb(0, 0, 0)')
    expect(liveMapped.hasAttribute('data-nanquim-orig-stroke')).toBe(true)
  })

  test('uses XML contexts for exact special-character round trips without mutating live SVG', () => {
    const fixture = createEditorFixture()
    const beforeModel = fixture.modelSvg.outerHTML
    const beforePaper = fixture.paperSvg.outerHTML

    const first = serializeNativeDocument(fixture.editor)
    const second = serializeNativeDocument(fixture.editor)
    const root = parseSerialized(first)

    expect(first).toBe(second)
    expect(first.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)
    expect(root.querySelector('#collection-1').getAttribute('name')).toBe(SPECIAL_TEXT)
    expect(root.querySelector('[data-kind="special-text"]').textContent).toBe(SPECIAL_TEXT)
    expect(root.querySelector('[data-kind="paper-text"]').textContent).toBe(SPECIAL_TEXT)
    expect(JSON.parse(root.getAttribute('data-text-styles')).styles[0].name).toBe(SPECIAL_TEXT)
    expect(JSON.parse(root.getAttribute('data-block-definitions'))[0][0]).toBe(SPECIAL_TEXT)
    expect(JSON.parse(root.querySelector('#nanquim-geometry-nodes').textContent).graphs[0].name)
      .toBe(SPECIAL_TEXT)

    expect(fixture.modelSvg.outerHTML).toBe(beforeModel)
    expect(fixture.paperSvg.outerHTML).toBe(beforePaper)
    expect(fixture.editor.dimensionManager.toJSON).toHaveBeenCalledTimes(2)
    expect(fixture.editor.textStyleManager.toJSON).toHaveBeenCalledTimes(2)
    expect(fixture.editor.geometryNodes.serialize).toHaveBeenCalledTimes(2)
  })

  test('canonicalizes Paper annotation attributes independently of live DOM insertion order', () => {
    const fixture = createEditorFixture()
    const first = serializeNativeDocument(fixture.editor)
    const attributes = Array.from(fixture.editor.paperAnnotations.node.attributes).reverse()
      .map(attribute => ({ name: attribute.name, value: attribute.value }))
    Array.from(fixture.editor.paperAnnotations.node.attributes).forEach((attribute) => {
      fixture.editor.paperAnnotations.node.removeAttributeNode(attribute)
    })
    attributes.forEach(({ name, value }) => {
      fixture.editor.paperAnnotations.node.setAttribute(name, value)
    })

    expect(serializeNativeDocument(fixture.editor)).toBe(first)
  })

  test('fails closed for active commands and state outside loader bounds', () => {
    const { editor } = createEditorFixture()
    editor.isDrawing = true
    expect(() => serializeNativeDocument(editor)).toThrow(/Finish or cancel/)

    editor.isDrawing = false
    editor.isEditingVertex = true
    expect(() => serializeNativeDocument(editor)).toThrow(/Finish or cancel/)

    editor.isEditingVertex = false
    editor.isTypingText = true
    expect(() => serializeNativeDocument(editor)).toThrow(/Finish or cancel/)

    editor.isTypingText = false
    editor.paperViewports[0].scale = Number.POSITIVE_INFINITY
    expect(() => serializeNativeDocument(editor)).toThrow(/finite number/)

    editor.paperViewports[0].scale = 50
    editor.paperViewports[0].id = 'unsafe id'
    expect(() => serializeNativeDocument(editor)).toThrow(/invalid id/)

    editor.paperViewports[0].id = 'vp-special'
    editor.paperViewports[0].x = '2'
    expect(() => serializeNativeDocument(editor)).toThrow(/finite number/)

    editor.paperViewports[0].x = 2
    editor.paperViewports[0].w = 0
    expect(() => serializeNativeDocument(editor)).toThrow(/supported range/)

    editor.paperViewports[0].w = 18
    editor.paperViewports.push({ ...editor.paperViewports[0] })
    expect(() => serializeNativeDocument(editor)).toThrow(/duplicated/)

    editor.paperViewports = Array.from({ length: 257 }, (_value, index) => ({
      ...editor.paperViewports[0],
      id: `vp-${index}`,
    }))
    expect(() => serializeNativeDocument(editor)).toThrow(/cannot exceed 256/)

    editor.paperViewports = []
    editor.elementIndex = 1000000001
    expect(() => serializeNativeDocument(editor)).toThrow(/between 0 and 1000000000/)

    editor.elementIndex = 11
    editor.paperConfig.width = 10001
    expect(() => serializeNativeDocument(editor)).toThrow(/invalid or non-canonical/)

    editor.paperConfig.width = 420
    editor.paperViewports = {}
    expect(() => serializeNativeDocument(editor)).toThrow(/must be an array/)

    editor.paperViewports = []
    editor.svg.viewbox(0, 0, -1, 10)
    expect(() => serializeNativeDocument(editor)).toThrow(/supported range/)
  })

  test('rejects style and Paper metadata that would change during a canonical reopen', () => {
    const fixture = createEditorFixture()
    const { editor } = fixture

    const invalidFontSize = structuredClone(fixture.textStyles)
    invalidFontSize.styles[0].properties.fontSize = (
      NATIVE_STYLE_METADATA_LIMITS.maxNumericMagnitude + 1
    )
    editor.textStyleManager.toJSON.mockReturnValue(invalidFontSize)
    expect(() => serializeNativeDocument(editor)).toThrow(/Text style manager.*invalid or non-canonical/)

    const unknownStyleField = structuredClone(fixture.textStyles)
    unknownStyleField.styles[0].properties.remoteFont = 'https://attacker.invalid/font.woff2'
    editor.textStyleManager.toJSON.mockReturnValue(unknownStyleField)
    expect(() => serializeNativeDocument(editor)).toThrow(/Text style manager.*invalid or non-canonical/)

    const tooManyStyles = Array.from(
      { length: NATIVE_STYLE_METADATA_LIMITS.maxStyles + 1 },
      (_entry, index) => ({
        id: index === 0 ? 'Standard' : `style-${index}`,
        name: index === 0 ? 'Standard' : `Style ${index}`,
        properties: { ...DEFAULT_TEXT_STYLE_PROPERTIES },
      }),
    )
    editor.textStyleManager.toJSON.mockReturnValue({
      activeStyleId: 'Standard',
      styles: tooManyStyles,
    })
    expect(() => serializeNativeDocument(editor)).toThrow(/Text style manager.*invalid or non-canonical/)

    editor.textStyleManager.toJSON.mockReturnValue(fixture.textStyles)
    const invalidDimensionField = structuredClone(fixture.dimensionStyles)
    invalidDimensionField.styles[0].properties.markerSize = (
      NATIVE_STYLE_METADATA_LIMITS.maxNumericMagnitude + 1
    )
    editor.dimensionManager.toJSON.mockReturnValue(invalidDimensionField)
    expect(() => serializeNativeDocument(editor)).toThrow(/Dimension style manager.*invalid or non-canonical/)

    editor.dimensionManager.toJSON.mockReturnValue(fixture.dimensionStyles)
    editor.paperConfig.colorMap = Object.fromEntries(Array.from(
      { length: PAPER_CONFIG_METADATA_LIMITS.maxColorMappings + 1 },
      (_entry, index) => [
        `#${index.toString(16).padStart(6, '0')}`,
        { printColor: '#000000', enabled: true },
      ],
    ))
    expect(() => serializeNativeDocument(editor)).toThrow(/Paper configuration.*invalid or non-canonical/)
  })

  test('refuses metadata and output bytes that its own parser would reject', () => {
    const { editor } = createEditorFixture()

    editor.blockDefinitions = new Map(Array.from({ length: 5000 }, (_entry, index) => [
      `${String(index).padStart(4, '0')}-${'B'.repeat(240)}`,
      { defId: 'block-safe-id', basePoint: { x: 1, y: 2 }, elementCount: 1 },
    ]))
    expect(() => serializeNativeDocument(editor)).toThrow(/Block definitions exceeds/)

    editor.blockDefinitions = new Map()
    editor.geometryNodes.serialize.mockReturnValue({
      version: 1,
      graphs: [],
      instances: [],
      padding: 'x'.repeat(GEOMETRY_NODES_METADATA_LIMITS.maxLength - 50),
    })
    expect(() => serializeNativeDocument(editor)).toThrow(/Geometry Nodes metadata exceeds/)

    editor.geometryNodes.serialize.mockReturnValue({
      version: 1,
      graphs: [{
        schemaVersion: 1,
        id: 'invalid-view',
        name: 'Invalid view',
        nodes: [],
        links: [],
        view: { x: 0, y: 0, zoom: 2.6 },
      }],
      instances: [],
    })
    expect(() => serializeNativeDocument(editor)).toThrow(/graph view zoom.*supported range/i)

    expect(assertDocumentSourceSize('é', 2)).toBe('é')
    expect(() => assertDocumentSourceSize('é', 1)).toThrow(/file-size limit/)
  })

  test('rejects oversized element metadata and SVG attributes before writing', () => {
    const semanticFixture = createEditorFixture()
    semanticFixture.editor.drawing.findOne('[data-kind="arc"]').data('arcData', {
      payload: 'x'.repeat(ELEMENT_DATA_METADATA_LIMITS.maxLength),
    })
    expect(() => serializeNativeDocument(semanticFixture.editor)).toThrow(/arcData exceeds/)

    const attributeFixture = createEditorFixture()
    attributeFixture.editor.drawing.findOne('[data-kind="arc"]')
      .attr('d', 'M' + '0'.repeat(4 * 1024 * 1024 + 1))
    expect(() => serializeNativeDocument(attributeFixture.editor)).toThrow(
      /unsafe or unsupported SVG content/,
    )
  })

  test('rejects block display names that the native loader cannot preserve', () => {
    const { editor } = createEditorFixture()
    editor.blockDefinitions = new Map([[
      'B'.repeat(257),
      { defId: 'block-safe-id', basePoint: { x: 1, y: 2 }, elementCount: 1 },
    ]])
    expect(() => serializeNativeDocument(editor)).toThrow(/Block display names/)

    const invalidDefinition = createEditorFixture()
    invalidDefinition.editor.svg.defs().findOne('#block-safe-id').attr('data-block-name', 'A\tB')
    expect(() => serializeNativeDocument(invalidDefinition.editor)).toThrow(/Block display names/)
  })

  test('rejects XML-invalid characters before encoding can reject or replace them', () => {
    expect(assertXml10Characters('tab\tline\ncarriage\rreturn')).toContain('\t')
    expect(assertXml10Characters('supplementary \u{1f58b}')).toContain('\u{1f58b}')
    expect(() => assertXml10Characters('control \u0001')).toThrow(/invalid XML character/)
    expect(() => assertXml10Characters('surrogate \ud800')).toThrow(/invalid XML character/)
    expect(() => assertXml10Characters('noncharacter \ufffe')).toThrow(/invalid XML character/)

    const invalidCollection = createEditorFixture()
    invalidCollection.editor.drawing.findOne('#collection-1').attr('name', 'A\u0001B')
    expect(() => serializeNativeDocument(invalidCollection.editor)).toThrow(/invalid XML character/)

    const invalidText = createEditorFixture()
    invalidText.editor.drawing.findOne('[data-kind="special-text"]').node.textContent = 'A\ud800B'
    expect(() => serializeNativeDocument(invalidText.editor)).toThrow(/invalid XML character/)
  })
})
