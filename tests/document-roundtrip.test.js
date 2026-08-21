// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { Editor } from '../src/js/Editor.js'
import { PaperEditor } from '../src/js/PaperEditor.js'
import { createCollection } from '../src/js/Collection.js'
import { GeometryNodeManager } from '../src/js/geometry-nodes/GeometryNodeManager.js'
import { buildNativeDocument, serializeNativeDocument } from '../src/js/document/DocumentSerializer.js'
import {
  DEFAULT_TEXT_STYLE_PROPERTIES,
  PAPER_CONFIG_METADATA_LIMITS,
} from '../src/js/document/DocumentMetadata.js'

const FIXTURE_PATH = join(process.cwd(), 'tests', 'fixtures', 'native-v3.svg')
const V1_FIXTURE_PATH = join(process.cwd(), 'tests', 'fixtures', 'native-v1.svg')
const SVG_INTEROPERABILITY_FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'interoperability-profile.svg',
)
const JSON_ATTRIBUTES = new Set([
  'data-arc-data',
  'data-block-definitions',
  'data-circle-trim-data',
  'data-dim-data',
  'data-dim-styles',
  'data-ellipse-arc-data',
  'data-hatch-data',
  'data-paper-config',
  'data-paper-viewports',
  'data-spline-data',
  'data-text-styles',
])
const activeEditors = []

class TestSignal {
  constructor() {
    this.listeners = []
  }

  add(listener) {
    this.listeners.push(listener)
    return listener
  }

  addOnce(listener) {
    const wrapper = (...args) => {
      this.remove(wrapper)
      listener(...args)
    }
    this.add(wrapper)
    return wrapper
  }

  remove(listener) {
    this.listeners = this.listeners.filter(candidate => candidate !== listener)
  }

  dispatch(...args) {
    this.listeners.slice().forEach(listener => listener(...args))
  }
}

function parseSvg(source) {
  const documentRef = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (documentRef.querySelector('parsererror')) {
    throw new Error(documentRef.querySelector('parsererror').textContent)
  }
  return documentRef.documentElement
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sortedValue(value[key])]),
  )
}

function normalizedAttribute(element, attribute) {
  if (attribute.name === 'style') {
    return Array.from(element.style)
      .sort()
      .map(property => [property, element.style.getPropertyValue(property).trim()])
  }
  if (JSON_ATTRIBUTES.has(attribute.name)) {
    return sortedValue(JSON.parse(attribute.value))
  }
  return attribute.value
}

function normalizedElement(element) {
  const attributes = Array.from(element.attributes)
    .filter(attribute => attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
    .map(attribute => [attribute.name, normalizedAttribute(element, attribute)])
    .sort(([left], [right]) => left.localeCompare(right))
  const content = Array.from(element.childNodes).flatMap((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) return [normalizedElement(child)]
    if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) return []
    const text = element.localName === 'style'
      ? child.textContent.replace(/\s+/g, ' ').trim()
      : child.textContent
    if (element.localName === 'metadata') return [sortedValue(JSON.parse(text))]
    return [text]
  })
  return { name: element.localName, attributes, content }
}

function assertUniqueResolvableReferences(root) {
  const ids = Array.from(root.querySelectorAll('[id]')).map(element => element.id)
  expect(new Set(ids).size).toBe(ids.length)

  const references = []
  root.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if ((attribute.localName === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) {
        references.push(attribute.value.slice(1))
      }
      for (const match of attribute.value.matchAll(/url\(\s*["']?#([^\s"')]+)["']?\s*\)/g)) {
        references.push(match[1])
      }
    })
    if (element.localName === 'style') {
      for (const match of element.textContent.matchAll(/url\(\s*["']?#([^\s"')]+)["']?\s*\)/g)) {
        references.push(match[1])
      }
    }
  })

  references.forEach((id) => {
    expect(ids, `missing local SVG reference #${id}`).toContain(id)
  })
}

function createTestEditor() {
  document.body.innerHTML = '<div id="canvas"><div class="terminal"></div></div>'
  const editor = new Editor()
  editor.geometryNodes = new GeometryNodeManager(editor)
  editor.paperEditor = new PaperEditor(editor)

  // jsdom cannot calculate browser SVG bounds. The loader's index rebuild is
  // still invoked; only the paint/layout-dependent index implementation is
  // substituted for this document-persistence test.
  editor.spatialIndex = { markDirty: vi.fn(), rebuild: vi.fn() }
  editor.fullSpatialIndex = { markDirty: vi.fn(), rebuild: vi.fn() }
  activeEditors.push(editor)
  return editor
}

async function openDocument(source, name) {
  const editor = createTestEditor()
  const result = await editor.loader.loadSource(source, { name })
  expect(result).toMatchObject({ ok: true, kind: 'native', dirty: false })
  expect(result.diagnostics).toEqual([])
  return editor
}

function parsedMetadata(root, attribute) {
  return JSON.parse(root.getAttribute(attribute))
}

function metadataAttribute(value) {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function assertCanonicalSubsystems(editor, root) {
  expect(root.querySelector(':scope > title#document-title-v3').textContent)
    .toBe(`Nanquim & <drawing> "quoted" 'single'`)
  expect(root.querySelector(':scope > desc#document-description-v3').textContent)
    .toBe(`Round-trip & <description> "quoted" 'single'`)
  const customMetadata = root.querySelector(':scope > metadata#custom-metadata-v3')
  expect(customMetadata.getAttribute('data-vendor')).toBe('FOSS & CAD')
  expect(JSON.parse(customMetadata.textContent)).toEqual({
    vendor: `Acme & <CAD> "quoted" 'single'`,
    revision: 3,
    reference: 'url(#gradient-v3)',
  })
  expect(root.querySelector(':scope > defs #custom-metadata-v3')).toBeNull()
  expect(root.querySelectorAll(':scope > metadata#nanquim-geometry-nodes')).toHaveLength(1)

  const collection = editor.collections.get('collection-special')
  const hiddenCollection = editor.collections.get('collection-hidden')
  expect(collection.group.attr('name')).toBe(`Collection & <primary> "quoted" 'single'`)
  expect(collection.style.opacity).toBe(0.9)
  expect(hiddenCollection).toMatchObject({ visible: false, locked: true })
  expect(hiddenCollection.style['stroke-width']).toBe(0)
  expect(hiddenCollection.style.opacity).toBe(0.5)
  expect(collection.group.findOne('[data-group="true"]').attr('name'))
    .toBe(`Nested & <group> "quoted" 'single'`)
  const arc = collection.group.findOne('[data-group="true"] [data-arc-data]')
  const circleTrim = collection.group.findOne('[data-circle-trim-data]')
  const ellipseArc = collection.group.findOne('[data-ellipse-arc-data]')
  const spline = collection.group.findOne('[data-spline-data]')
  const hatch = collection.group.findOne('[data-hatch-data]')
  const dimension = collection.group.findOne('[data-element-type="dimension"]')
  const styledText = collection.group.findOne('[name="Styled text"]')
  expect(JSON.parse(arc.attr('data-arc-data')).p2).toEqual({ x: 22, y: 10 })
  expect(JSON.parse(circleTrim.attr('data-circle-trim-data'))).toMatchObject({ cx: 50, r: 10 })
  expect(JSON.parse(ellipseArc.attr('data-ellipse-arc-data'))).toMatchObject({ rx: 18, rotation: 20 })
  expect(JSON.parse(spline.attr('data-spline-data')).points).toHaveLength(4)
  expect(JSON.parse(hatch.attr('data-hatch-data')).pattern)
    .toBe(`cross & <fine> "quoted" 'single'`)
  expect(JSON.parse(dimension.attr('data-dim-data')).label)
    .toBe(`Dimension & <70> "quoted" 'single'`)
  expect(styledText.attr('data-text-style-id')).toBe('text-v3')
  expect(styledText.attr('data-fill-source')).toBe('textstyle')
  expect(styledText.text()).toBe(`Model & <text> "quoted" 'single'`)

  const textStyle = editor.textStyleManager.styles.get('text-v3')
  const dimensionStyle = editor.dimensionManager.styles.get('detail-v3')
  expect(textStyle.name).toBe(`Text & <notes> "quoted" 'single'`)
  expect(textStyle.properties.fontFamily).toBe('Inter')
  expect(dimensionStyle.name).toBe(`Dimensions & <detail> "quoted" 'single'`)
  expect(dimensionStyle.properties.textStyleId).toBe('text-v3')

  const blockName = `Block & <panel> "quoted" 'single'`
  expect(editor.blockDefinitions.get(blockName)).toMatchObject({
    defId: 'block-opaque-v3',
    basePoint: { x: 2.5, y: -1.5 },
    elementCount: 2,
  })
  const blockInstance = editor.drawing.findOne('[data-block-instance="true"]')
  expect(blockInstance.attr('data-block-name')).toBe(blockName)
  expect(blockInstance.attr('href')).toBe('#block-opaque-v3')

  expect(editor.paperConfig).toMatchObject({
    size: 'custom',
    width: 500.5,
    height: 321.25,
    orientation: 'landscape',
    unitsPerCm: 2.5,
    colorMap: { '#112233': { printColor: '#abcdef', enabled: true } },
  })
  expect(editor.paperViewports.map(viewport => ({
    id: viewport.id,
    visible: viewport.visible,
    locked: viewport.locked,
  }))).toEqual([
    { id: 'vp-4', visible: true, locked: false },
    { id: 'vp-9', visible: false, locked: true },
  ])
  expect(editor.paperAnnotations.attr('name'))
    .toBe(`Annotations & <paper> "quoted" 'single'`)
  expect(editor.paperAnnotations.findOne('#paper-note-v3').text())
    .toBe(`Paper & <note> "quoted" 'single'`)

  const cachedWrapper = editor.drawing.findOne('[data-gn-instance-id="modifier-v3"]')
  expect(cachedWrapper.findOne('[data-gn-output="true"] [data-gn-derived="true"]'))
    .not.toBeNull()
  const validInstance = editor.geometryNodes.instances.get('modifier-valid-v3')
  expect(validInstance).toMatchObject({
    objectId: 'object-valid-v3',
    graphId: 'graph-v3',
    enabled: true,
    status: 'ready',
    error: null,
  })
  expect(editor.geometryNodes.graphs.has('graph-v3')).toBe(true)
  expect(editor.geometryNodes.activeObjectId).toBeNull()
  expect(validInstance.wrapper.attr('data-gn-instance-id')).toBe('modifier-valid-v3')
  expect(validInstance.source.findOne('[name="Valid source"]')).not.toBeNull()
  expect(validInstance.output.findOne('[data-gn-derived="true"]')).not.toBeNull()
  const geometryNodes = JSON.parse(root.querySelector('#nanquim-geometry-nodes').textContent)
  expect(geometryNodes.version).toBe(1)
  expect(geometryNodes).not.toHaveProperty('activeObjectId')
  expect(geometryNodes.graphs[0].name).toBe(`Graph & <nodes> "quoted" 'single'`)
  expect(geometryNodes.graphs[0].view).toEqual({ x: 0, y: 0, zoom: 1 })
  expect(geometryNodes.instances[0]).toMatchObject({
    id: 'modifier-v3',
    objectId: 'object-v3',
    graphId: 'missing-cached-graph-v3',
  })
  expect(geometryNodes.instances[1]).toMatchObject({
    id: 'modifier-valid-v3',
    objectId: 'object-valid-v3',
    graphId: 'graph-v3',
  })

  expect(root.querySelectorAll(':scope > defs')).toHaveLength(1)
  for (const selector of [
    'linearGradient#gradient-v3',
    'pattern#pattern-v3',
    'clipPath#clip-v3',
    'mask#mask-v3',
    'marker#marker-v3',
    'symbol#symbol-v3',
    'style#style-v3',
    '[data-block-def="true"]#block-opaque-v3',
  ]) {
    expect(root.querySelectorAll(`:scope > defs ${selector}`), selector).toHaveLength(1)
  }

  const paper = root.querySelector(':scope > [data-nanquim-paper-annotations="true"]')
  expect(paper).not.toBeNull()
  expect(paper.querySelector('#paper-note-v3').textContent)
    .toBe(`Paper & <note> "quoted" 'single'`)
  expect(parsedMetadata(root, 'data-paper-viewports')[1]).toMatchObject({
    id: 'vp-9',
    visible: false,
    locked: true,
  })
  expect(parsedMetadata(root, 'data-text-styles').styles[1].name)
    .toBe(`Text & <notes> "quoted" 'single'`)
  expect(parsedMetadata(root, 'data-dim-styles').styles[1].name)
    .toBe(`Dimensions & <detail> "quoted" 'single'`)
  expect(root.querySelector('#collection-special').style.opacity).toBe('0.9')
  expect(root.querySelector('#collection-hidden').style.opacity).toBe('0.5')
  expect(root.querySelector('#collection-hidden').style.strokeWidth).toBe('0')
  const style = root.querySelector('style#style-v3')
  expect(style.textContent).toContain('svg .styled-v3')
  expect(style.textContent).not.toContain('#Collection')
  expect(root.querySelector('.styled-v3').matches('svg .styled-v3')).toBe(true)
}

describe('native schema-v3 semantic round trips', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    registerWindow(window, document)
    globalThis.SVG = SVG
    globalThis.signals = { Signal: TestSignal }
    window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 1, height: 1 })
  })

  afterEach(() => {
    activeEditors.splice(0).forEach(editor => editor.documentState.disconnect())
    delete window.SVGElement.prototype.getBBox
    delete globalThis.SVG
    delete globalThis.signals
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('survives open, serialize, fresh open, and serialize without semantic loss', async () => {
    const fixture = await readFile(FIXTURE_PATH, 'utf8')
    const firstEditor = await openDocument(fixture, 'native-v3.svg')
    const firstSerialized = serializeNativeDocument(firstEditor)
    const firstRoot = parseSvg(firstSerialized)

    assertCanonicalSubsystems(firstEditor, firstRoot)
    assertUniqueResolvableReferences(firstRoot)

    firstEditor.documentState.disconnect()
    activeEditors.splice(activeEditors.indexOf(firstEditor), 1)
    const secondEditor = await openDocument(firstSerialized, 'native-v3-reopened.svg')
    const secondSerialized = serializeNativeDocument(secondEditor)
    const secondRoot = parseSvg(secondSerialized)

    assertCanonicalSubsystems(secondEditor, secondRoot)
    assertUniqueResolvableReferences(secondRoot)
    expect(normalizedElement(secondRoot)).toEqual(normalizedElement(firstRoot))
  })

  test('promotes the qualified foreign SVG profile to an idempotent native document', async () => {
    const fixture = await readFile(SVG_INTEROPERABILITY_FIXTURE_PATH, 'utf8')
    const importedEditor = createTestEditor()
    const imported = await importedEditor.loader.loadSource(fixture, {
      name: 'interoperability-profile.svg',
      type: 'image/svg+xml',
    })

    expect(imported).toMatchObject({ ok: true, kind: 'foreign-svg', dirty: true })
    expect(imported.diagnostics).toEqual([])
    const first = serializeNativeDocument(importedEditor)
    const firstRoot = parseSvg(first)
    assertUniqueResolvableReferences(firstRoot)
    expect(firstRoot.getAttribute('viewBox')).toBe('0 0 210 148')
    expect(firstRoot.querySelectorAll('path')).toHaveLength(6)
    expect(firstRoot.querySelectorAll('use')).toHaveLength(2)
    expect(firstRoot.querySelector('text').textContent).toBe('Room & curve <profile>')

    const reopened = await openDocument(first, 'interoperability-profile-native.svg')
    const second = serializeNativeDocument(reopened)
    const secondRoot = parseSvg(second)
    assertUniqueResolvableReferences(secondRoot)
    expect(normalizedElement(secondRoot)).toEqual(normalizedElement(firstRoot))
  })

  test('preserves the active model collection when saving from Paper Space', async () => {
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) { this._fillStyle = String(value).toLowerCase() },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)
    const editor = createTestEditor()
    let details
    editor.documentState.runWithoutTracking(() => {
      details = createCollection(editor, 'Details')
    })
    editor.documentState.replaceSession({ name: 'paper-active.svg', dirty: false })

    editor.mode = 'paper'
    editor.paperEditor.activate()
    expect(editor.activeCollection).toBe(editor.paperAnnotations)
    expect(buildNativeDocument(editor).documentElement.getAttribute('data-active-collection-id'))
      .toBe(details.attr('id'))

    const reopened = await openDocument(serializeNativeDocument(editor), 'paper-active.svg')
    expect(reopened.activeCollection.attr('id')).toBe(details.attr('id'))
  })

  test('preserves idless root semantics without duplicating canonical Geometry Nodes metadata', async () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" data-nanquim-version="3" viewBox="0 0 10 10">
        <title>Idless &amp; &lt;title&gt;</title>
        <desc>Idless &amp; &lt;description&gt;</desc>
        <metadata>{"vendor":"safe &amp; &lt;opaque&gt;"}</metadata>
        <metadata id="nanquim-geometry-nodes">{"version":1,"graphs":[],"instances":[]}</metadata>
        <g id="collection-main" data-collection="true"><line id="1" x2="1" y2="1"/></g>
      </svg>
    `
    const firstEditor = await openDocument(source, 'idless-root-semantics.svg')
    const firstRoot = parseSvg(serializeNativeDocument(firstEditor))
    const customMetadata = Array.from(firstRoot.querySelectorAll(':scope > metadata')).find(
      element => element.id !== 'nanquim-geometry-nodes',
    )

    expect(firstRoot.querySelector(':scope > title').hasAttribute('id')).toBe(false)
    expect(firstRoot.querySelector(':scope > desc').hasAttribute('id')).toBe(false)
    expect(customMetadata.hasAttribute('id')).toBe(false)
    expect(JSON.parse(customMetadata.textContent)).toEqual({ vendor: 'safe & <opaque>' })
    expect(firstRoot.querySelectorAll(':scope > metadata#nanquim-geometry-nodes')).toHaveLength(1)

    firstEditor.documentState.disconnect()
    activeEditors.splice(activeEditors.indexOf(firstEditor), 1)
    const secondEditor = await openDocument(
      serializeNativeDocument(firstEditor),
      'idless-root-semantics-reopened.svg',
    )
    const secondRoot = parseSvg(serializeNativeDocument(secondEditor))
    expect(normalizedElement(secondRoot)).toEqual(normalizedElement(firstRoot))
  })

  test('preserves historical numeric element IDs and allocator state during v1 migration', async () => {
    const fixture = await readFile(V1_FIXTURE_PATH, 'utf8')
    const originalRoot = parseSvg(fixture)
    const expectedIds = Object.fromEntries(
      Array.from(originalRoot.querySelectorAll('[name]'), element => [
        element.getAttribute('name'),
        element.id,
      ]),
    )
    const editor = createTestEditor()

    const result = await editor.loader.loadSource(fixture, { name: 'native-v1.svg' })
    const serializedRoot = parseSvg(serializeNativeDocument(editor))
    const migratedIds = Object.fromEntries(
      Array.from(serializedRoot.querySelectorAll('[name]'), element => [
        element.getAttribute('name'),
        element.id,
      ]),
    )

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-migrated' }))
    expect(migratedIds).toMatchObject(expectedIds)
    expect(editor.elementIndex).toBe(3)
    expect(serializedRoot.getAttribute('data-element-index')).toBe('3')
  })

  test('keeps persistent paste-scope wrappers canonical across save and reopen', async () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" data-nanquim-version="3"
        data-element-index="3" viewBox="0 0 10 10">
        <g id="collection-main" name="Main" data-collection="true">
          <g id="2" name="G 2" data-nanquim-paste-scope="nanquim-paste-1">
            <rect id="1" name="Rect 1" width="2" height="1"/>
          </g>
        </g>
      </svg>
    `
    const firstEditor = await openDocument(source, 'paste-scope.svg')
    const wrapper = firstEditor.drawing.node.querySelector('[data-nanquim-paste-scope]')
    expect(wrapper.getAttribute('data-nanquim-paste-scope')).toBe('nanquim-paste-1')
    expect(wrapper.hasAttribute('data-nanquimPasteScope')).toBe(false)
    const first = serializeNativeDocument(firstEditor)

    const secondEditor = await openDocument(first, 'paste-scope-reopened.svg')
    expect(serializeNativeDocument(secondEditor)).toBe(first)
  })

  test('resets ambiguous duplicate Paper annotations and marks the recovered document dirty', async () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" data-nanquim-version="3" viewBox="0 0 10 10">
        <g id="paper-a" data-nanquim-paper-annotations="true" data-collection="true">
          <text>First must not win</text>
        </g>
        <g id="paper-b" data-nanquim-paper-annotations="true" data-collection="true">
          <text>Second must not win</text>
        </g>
        <g id="collection-main" data-collection="true"><line id="1" x2="1" y2="1"/></g>
      </svg>
    `
    const editor = createTestEditor()
    const result = await editor.loader.loadSource(source, { name: 'duplicate-paper.svg' })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'duplicate-paper-annotations',
    }))
    expect(editor.paperAnnotations.children().length).toBe(0)
    expect(editor.paperAnnotations.text()).not.toContain('must not win')
  })

  test('diagnoses bounded style and Paper recovery and marks current-schema input dirty', async () => {
    const textStyles = {
      activeStyleId: 'Standard',
      styles: [{
        id: 'Standard',
        name: 'Standard',
        properties: {
          ...DEFAULT_TEXT_STYLE_PROPERTIES,
          fontSize: 1000001,
        },
      }],
    }
    const colorMap = Object.fromEntries(Array.from(
      { length: PAPER_CONFIG_METADATA_LIMITS.maxColorMappings + 1 },
      (_entry, index) => [
        `#${index.toString(16).padStart(6, '0')}`,
        { printColor: '#000000', enabled: true },
      ],
    ))
    const paperConfig = {
      size: 'A4',
      width: 210,
      height: 297,
      orientation: 'portrait',
      unitsPerCm: 1,
      colorMap,
    }
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" data-nanquim-version="3"
        data-text-styles="${metadataAttribute(textStyles)}"
        data-paper-config="${metadataAttribute(paperConfig)}">
        <g id="collection-main" data-collection="true"><line id="1" x2="1" y2="1"/></g>
      </svg>
    `
    const editor = createTestEditor()
    const result = await editor.loader.loadSource(source, { name: 'recovered-metadata.svg' })

    expect(result).toMatchObject({ ok: true, kind: 'native', dirty: true })
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-paper-config' }),
      expect.objectContaining({ code: 'invalid-text-styles' }),
    ]))
    expect(editor.paperConfig.colorMap).toEqual({})
    expect(editor.textStyleManager.styles.get('Standard').properties.fontSize).toBe(0.15)
    expect(() => serializeNativeDocument(editor)).not.toThrow()
  })
})
