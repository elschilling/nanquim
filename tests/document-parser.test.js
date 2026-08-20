// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  DocumentOpenError,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_DIAGNOSTICS,
  MAX_DOCUMENT_ELEMENTS,
  prepareDocumentFile,
  prepareDocumentSource,
  readFileText,
} from '../src/js/document/DocumentParser.js'
import { DOCUMENT_SCHEMA_VERSION } from '../src/js/document/DocumentSerializer.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

async function fixture(name) {
  return readFile(join(process.cwd(), 'tests', 'fixtures', name), 'utf8')
}

function nativeSvg(version, attributes = '', content = '<g data-collection="true"/>') {
  return `<svg xmlns="${SVG_NS}" data-nanquim-version="${version}" ${attributes}>${content}</svg>`
}

function expectOpenError(action, code) {
  expect(action).toThrow(expect.objectContaining({
    name: 'DocumentOpenError',
    code,
  }))
}

describe('DocumentParser schema classification', () => {
  test.each([
    ['native-v1.svg', 1],
    ['native-v2.svg', 2],
  ])('migrates the historical %s fixture into the current in-memory schema', async (name, version) => {
    const candidate = prepareDocumentSource(await fixture(name), { name })

    expect(candidate).toMatchObject({
      kind: 'native',
      format: 'svg',
      isNative: true,
      sourceSchemaVersion: version,
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      migratedFrom: version,
      requiresSave: true,
    })
    expect(candidate.root.getAttribute('data-nanquim-version')).toBe(String(DOCUMENT_SCHEMA_VERSION))
    expect(candidate.diagnostics).toContainEqual(expect.objectContaining({
      level: 'warning',
      code: 'schema-migrated',
    }))
    expect(candidate.metadata.paperConfig).toMatchObject({ size: expect.any(String) })
    expect(candidate.metadata.paperViewports).toEqual(expect.any(Array))
  })

  test('keeps a schema-v3 document current and parses bounded root metadata without managers', () => {
    const candidate = prepareDocumentSource(nativeSvg(3, [
      'viewBox="-5 -6 100 80"',
      'data-element-index="42"',
      'data-active-collection-id="collection-main"',
      'data-nanquim-converted-strokes="true"',
      'data-paper-config="{&quot;size&quot;:&quot;A4&quot;,&quot;width&quot;:210}"',
      'data-paper-viewports="[{&quot;id&quot;:&quot;vp-1&quot;,&quot;x&quot;:1}]"',
      'data-dim-styles="{&quot;activeStyleId&quot;:&quot;Standard&quot;,&quot;styles&quot;:[]}"',
      'data-text-styles="{&quot;activeStyleId&quot;:&quot;Standard&quot;,&quot;styles&quot;:[]}"',
      'data-block-definitions="[[&quot;Chair&quot;,{&quot;defId&quot;:&quot;block-Chair&quot;}]]"',
    ].join(' '), `
      <metadata id="nanquim-geometry-nodes">{"version":1,"graphs":[],"instances":[]}</metadata>
      <g id="paper" data-nanquim-paper-annotations="true" data-collection="true"><text>Note</text></g>
      <g id="collection-main" data-collection="true"><line id="1" x1="0" y1="0" x2="1" y2="1"/></g>
    `), { name: 'current.svg' })

    expect(candidate).toMatchObject({
      kind: 'native',
      sourceSchemaVersion: 3,
      schemaVersion: 3,
      migratedFrom: null,
      requiresSave: false,
    })
    expect(candidate.metadata).toEqual({
      viewBox: { x: -5, y: -6, width: 100, height: 80 },
      elementIndex: 42,
      activeCollectionId: 'collection-main',
      convertedStrokes: true,
      paperConfig: { size: 'A4', width: 210 },
      paperViewports: [{ id: 'vp-1', x: 1 }],
      dimensionStyles: { activeStyleId: 'Standard', styles: [] },
      textStyles: { activeStyleId: 'Standard', styles: [] },
      blockDefinitions: [['Chair', { defId: 'block-Chair' }]],
      geometryNodes: { version: 1, graphs: [], instances: [] },
    })
    expect(candidate.paperAnnotations.textContent).toBe('Note')
    expect(candidate.diagnostics).toEqual([])
  })

  test('treats markerless SVG as foreign even when it spoofs native collection markers', () => {
    const candidate = prepareDocumentSource(`
      <svg xmlns="${SVG_NS}" viewBox="0 0 10 10">
        <g id="spoof" data-collection="true"><rect width="5" height="5"/></g>
      </svg>
    `, { name: 'foreign.svg' })

    expect(candidate).toMatchObject({
      kind: 'foreign-svg',
      format: 'svg',
      isNative: false,
      sourceSchemaVersion: null,
      schemaVersion: null,
      migratedFrom: null,
      requiresSave: true,
    })
    expect(candidate.root.querySelector('[data-collection="true"]')).not.toBeNull()
  })

  test('repairs the SVG.js namespace used by historical native files before inert parsing', () => {
    const candidate = prepareDocumentSource(`
      <svg xmlns="${SVG_NS}" data-nanquim-version="2">
        <g data-collection="true" svgjs:data="{}"><line x2="1" y2="1"/></g>
      </svg>
    `)

    expect(candidate.kind).toBe('native')
    expect(candidate.migratedFrom).toBe(2)
    expect(candidate.root.lookupNamespaceURI('svgjs')).toBe('http://svgjs.com/svgjs')
  })

  test('rejects ambiguous duplicate Paper annotation roots with a fixed diagnostic', () => {
    const candidate = prepareDocumentSource(nativeSvg(3, '', `
      <g id="paper-a" data-nanquim-paper-annotations="true" data-collection="true"/>
      <g id="paper-b" data-nanquim-paper-annotations="true" data-collection="true"/>
      <g id="collection-main" data-collection="true"/>
    `))

    expect(candidate.paperAnnotations).toBeNull()
    expect(candidate.diagnostics).toContainEqual({
      level: 'warning',
      code: 'duplicate-paper-annotations',
      message: 'Duplicate Paper annotation roots were ignored; Paper annotations were reset.',
    })
  })

  test('rejects zero, malformed, unsupported and future schema markers', () => {
    expectOpenError(() => prepareDocumentSource(nativeSvg(0)), 'invalid-schema-version')
    expectOpenError(() => prepareDocumentSource(nativeSvg('3.0')), 'invalid-schema-version')
    expectOpenError(() => prepareDocumentSource(nativeSvg(Number.MAX_SAFE_INTEGER)), 'future-schema-version')
    expectOpenError(
      () => prepareDocumentSource(nativeSvg(DOCUMENT_SCHEMA_VERSION + 1)),
      'future-schema-version',
    )
  })
})

describe('DocumentParser untrusted input boundary', () => {
  test('rejects malformed XML, DOCTYPE declarations and excess element work before hydration', () => {
    expectOpenError(
      () => prepareDocumentSource(`<svg xmlns="${SVG_NS}"><g></svg>`),
      'invalid-svg',
    )
    expectOpenError(
      () => prepareDocumentSource(`<!DOCTYPE svg><svg xmlns="${SVG_NS}"/>`),
      'doctype-not-supported',
    )

    const tooMany = `<svg xmlns="${SVG_NS}">${'<g/>'.repeat(MAX_DOCUMENT_ELEMENTS)}</svg>`
    expectOpenError(() => prepareDocumentSource(tooMany), 'svg-complexity-limit')
  })

  test('sanitizes executable content while keeping safe geometry entirely inert', () => {
    const candidate = prepareDocumentSource(`
      <svg xmlns="${SVG_NS}" onclick="globalThis.pwned=true">
        <script>globalThis.pwned = true</script>
        <foreignObject><p xmlns="http://www.w3.org/1999/xhtml">unsafe</p></foreignObject>
        <image href="https://attacker.invalid/pixel.png"/>
        <g data-collection="true"><path id="safe" d="M0 0L2 2" onload="bad()"/></g>
      </svg>
    `, { name: 'hostile.svg' })

    expect(candidate.kind).toBe('foreign-svg')
    expect(candidate.root.querySelector('#safe')).not.toBeNull()
    expect(candidate.root.querySelector('script, foreignObject')).toBeNull()
    expect(candidate.root.querySelector('[onclick], [onload], [href^="http"]')).toBeNull()
    expect(document.querySelector('#safe')).toBeNull()
    expect(globalThis.pwned).toBeUndefined()
    expect(candidate.diagnostics).toContainEqual(expect.objectContaining({
      code: 'sanitized-content',
    }))
  })

  test('marks a current native document dirty when sanitization removes persisted content or metadata', () => {
    const oversizedPaper = 'x'.repeat(4 * 1024 * 1024 + 1)
    const candidate = prepareDocumentSource(nativeSvg(3, `data-paper-config="${oversizedPaper}"`, `
      <script>globalThis.pwned = true</script>
      <g id="collection-main" data-collection="true">
        <path id="safe" d="M0 0L2 2" onload="bad()"/>
      </g>
    `))

    expect(candidate.requiresSave).toBe(true)
    expect(candidate.metadata.paperConfig).toBeNull()
    expect(candidate.root.querySelector('script, [onload]')).toBeNull()
    expect(candidate.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'sanitized-content',
      'invalid-paper-config',
    ]))
  })

  test('keeps metadata diagnostics fixed, bounded and detached from attacker content', () => {
    const attributes = [
      'viewBox="NaN 0 10 10"',
      'data-element-index="999999999999999999999"',
      `data-active-collection-id="${'x'.repeat(257)}"`,
      'data-nanquim-converted-strokes="maybe-attacker-text"',
      'data-paper-config="{attacker-paper}"',
      'data-paper-viewports="{attacker-viewports}"',
      'data-dim-styles="{attacker-dimensions}"',
      'data-text-styles="{attacker-text}"',
      'data-block-definitions="{attacker-blocks}"',
    ].join(' ')
    const candidate = prepareDocumentSource(nativeSvg(3, attributes, `
      <metadata id="nanquim-geometry-nodes">{attacker-geometry-nodes}</metadata>
      <g data-collection="true"/>
    `))

    expect(candidate.diagnostics.length).toBeLessThanOrEqual(MAX_DOCUMENT_DIAGNOSTICS)
    expect(candidate.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'invalid-view-box',
      'invalid-element-index',
      'invalid-active-collection',
      'invalid-converted-strokes',
      'invalid-paper-config',
      'invalid-paper-viewports',
      'invalid-dimension-styles',
      'invalid-text-styles',
      'invalid-block-definitions',
      'invalid-geometry-nodes',
    ]))
    expect(candidate.diagnostics.every((entry) => (
      entry.level === 'warning'
      && !entry.message.includes('attacker')
      && Object.isFrozen(entry)
    ))).toBe(true)
    expect(candidate.metadata).toMatchObject({
      viewBox: null,
      elementIndex: null,
      activeCollectionId: null,
      convertedStrokes: false,
      paperConfig: null,
      paperViewports: null,
      dimensionStyles: null,
      textStyles: null,
      blockDefinitions: null,
      geometryNodes: null,
    })
  })

  test('enforces the raw file-size bound before reading and wraps read failures', async () => {
    let readCount = 0
    const oversized = {
      name: 'oversized.svg',
      size: MAX_DOCUMENT_BYTES + 1,
      text: async () => {
        readCount += 1
        return '<svg/>'
      },
    }
    await expect(readFileText(oversized)).rejects.toMatchObject({
      name: 'DocumentOpenError',
      code: 'file-too-large',
    })
    expect(readCount).toBe(0)

    const cause = new Error('sensitive lower-level detail')
    await expect(readFileText({ size: 1, text: async () => { throw cause } })).rejects.toMatchObject({
      name: 'DocumentOpenError',
      code: 'file-read-failed',
      message: 'The selected file could not be read.',
      cause,
    })
  })

  test('converts a representative DXF into a sanitized foreign candidate', async () => {
    const source = await fixture('basic-entities-r2000.dxf')
    const candidate = prepareDocumentSource(source, {
      name: 'basic-entities-r2000.dxf',
      type: 'image/vnd.dxf',
    })

    expect(candidate).toMatchObject({
      kind: 'dxf',
      format: 'dxf',
      isNative: false,
      schemaVersion: null,
      requiresSave: true,
    })
    expect(candidate.root.querySelector('line')).not.toBeNull()
    expect(candidate.root.querySelector('circle')).not.toBeNull()
    expect(candidate.root.querySelectorAll('[data-collection="true"]').length).toBeGreaterThan(0)
    expect(candidate.metadata.viewBox).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    })
  })

  test('prepares File-like objects through the same parser contract', async () => {
    const source = nativeSvg(3, 'data-element-index="7"')
    const candidate = await prepareDocumentFile({
      name: 'drawing.svg',
      type: 'image/svg+xml',
      size: source.length,
      text: async () => source,
    })

    expect(candidate.kind).toBe('native')
    expect(candidate.metadata.elementIndex).toBe(7)
  })

  test('exposes typed parser failures for callers without leaking live editor state', () => {
    let error
    try {
      prepareDocumentSource('<not-svg/>')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(DocumentOpenError)
    expect(error).toMatchObject({ name: 'DocumentOpenError', code: 'unsafe-svg' })
  })
})
