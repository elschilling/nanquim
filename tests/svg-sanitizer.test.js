// @vitest-environment jsdom

import { SVG, registerWindow } from '@svgdotjs/svg.js'
import { describe, expect, test, vi } from 'vitest'

import {
  DXFLoader,
  MAX_SVG_IMPORT_BYTES,
  NATIVE_STYLE_METADATA_LIMITS,
  markupFitsSvgImportElementBudget,
} from '../src/js/utils/DXFloader.js'
import {
  rewriteStyleReferences,
  parseSafeJson,
  sanitizeStyleSheet,
  sanitizeSvgDocument,
} from '../src/js/utils/sanitizeSvg.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

function sanitize(source) {
  const documentRef = new DOMParser().parseFromString(source, 'image/svg+xml')
  expect(documentRef.querySelector('parsererror')).toBeNull()
  return sanitizeSvgDocument(documentRef)
}

function createLoaderEditor() {
  document.body.replaceChildren()
  registerWindow(window, document)
  const svg = SVG().addTo(document.body)
  const drawing = svg.group().attr('id', 'Collection')
  const signals = new Proxy({}, {
    get(target, key) {
      if (!target[key]) target[key] = { dispatch: vi.fn() }
      return target[key]
    },
  })
  return {
    svg,
    drawing,
    signals,
    mode: 'model',
    elementIndex: 1,
    collections: new Map(),
    blockDefinitions: new Map(),
    paperViewports: [],
    paperConfig: {},
    resetPaperConfig: vi.fn(),
    dimensionManager: { fromJSON: vi.fn() },
    textStyleManager: { fromJSON: vi.fn() },
    geometryNodes: { reset: vi.fn(), load: vi.fn() },
    spatialIndex: { rebuild: vi.fn() },
    paperEditor: null,
  }
}

function openFile(editor, file) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out opening ${file.name}`)), 3000)
    editor.signals.terminalLogged.dispatch.mockImplementation((entry) => {
      if (/^Opened:/.test(entry && entry.msg)) {
        clearTimeout(timeout)
        resolve()
      } else if (/^Failed to open SVG:/.test(entry && entry.msg)) {
        clearTimeout(timeout)
        reject(new Error(entry.msg))
      }
    })
    new DXFLoader(editor).loadFile(file)
  })
}

function openSvg(editor, source, name) {
  return openFile(editor, new File([source], name, { type: 'image/svg+xml' }))
}

function metadataAttribute(value) {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

describe('untrusted SVG sanitizer', () => {
  test('removes executable and foreign nested content plus event handlers', () => {
    const root = sanitize(`
      <svg xmlns="${SVG_NS}" onload="window.pwned=1">
        <g onclick="alert(1)">
          <rect id="safe" width="20" height="10" onmouseover="alert(2)"/>
          <script><g><circle id="script-child"/></g></script>
          <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>bad()</script></div></foreignObject>
          <iframe/><object/><embed/><audio/><video/><canvas/>
          <animate attributeName="x" values="0;10"/>
        </g>
      </svg>
    `)

    expect(root.querySelector('#safe')).not.toBeNull()
    expect(root.querySelectorAll('script, foreignObject, iframe, object, embed, audio, video, canvas, animate')).toHaveLength(0)
    expect(root.querySelector('#script-child')).toBeNull()
    expect(Array.from(root.querySelectorAll('*')).some((node) => (
      Array.from(node.attributes).some((attribute) => attribute.localName.toLowerCase().startsWith('on'))
    ))).toBe(false)
  })

  test('allows local references and raster data images but removes active or external URLs', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const root = sanitize(`
      <svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs><path id="shape" d="M0 0L1 1"/></defs>
        <use id="local" href="#shape"/>
        <use id="remote" href="https://example.test/shape.svg#shape"/>
        <use id="active" xlink:href="javascript:alert(1)"/>
        <image id="raster" href="${png}" width="1" height="1"/>
        <image id="svg-data" href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"/>
        <image id="html-data" href="data:text/html;base64,PHNjcmlwdD4="/>
        <image id="network" href="//example.test/pixel.png"/>
        <a id="link" href="vbscript:msgbox(1)"><circle id="kept-child" r="2"/></a>
      </svg>
    `)

    expect(root.querySelector('#local').getAttribute('href')).toBe('#shape')
    expect(root.querySelector('#remote').hasAttribute('href')).toBe(false)
    expect(root.querySelector('#active').hasAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(false)
    expect(root.querySelector('#raster').getAttribute('href')).toBe(png)
    expect(root.querySelector('#svg-data').hasAttribute('href')).toBe(false)
    expect(root.querySelector('#html-data').hasAttribute('href')).toBe(false)
    expect(root.querySelector('#network').hasAttribute('href')).toBe(false)
    expect(root.querySelector('#link').hasAttribute('href')).toBe(false)
    expect(root.querySelector('#kept-child')).not.toBeNull()
  })

  test('scopes stylesheet rules and keeps only safe declarations and local paint references', () => {
    const root = sanitize(`
      <svg xmlns="${SVG_NS}">
        <style>
          @import url("https://example.test/evil.css");
          body, .wall { stroke: #123456; fill: url(#hatch); clip-rule: evenodd; mask-type: alpha; background: url(https://example.test/a.png) }
          svg { color: #abcdef }
          .remote { fill: url("https://example.test/paint.svg#x") }
          .image-set { mask: image-set("https://example.test/mask.png" 1x) }
          + #Handlers { display: none }
          ~ #Overlays { visibility: hidden }
        </style>
        <defs><pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 0L2 2"/></pattern></defs>
        <path id="wall" class="wall" d="M0 0L10 0"
          style="stroke:red;fill:url(#hatch);background:url(javascript:alert(1));behavior:url(#x)"
          clip-path="url(https://example.test/clip.svg#x)" mask="image-set('//example.test/mask.png' 1x)"/>
      </svg>
    `)

    const css = root.querySelector('style').textContent
    expect(css).toContain('#Collection body,#Collection .wall')
    expect(css).toContain('stroke:#123456')
    expect(css).toContain('fill:url(#hatch)')
    expect(css).toContain('clip-rule:evenodd')
    expect(css).toContain('mask-type:alpha')
    expect(css).toContain('#Collection{color:#abcdef}')
    expect(css).not.toMatch(/@import|https?:|background|\.remote|image-set|#Handlers|#Overlays|javascript|behavior/i)

    const wall = root.querySelector('#wall')
    expect(wall.getAttribute('style')).toBe('stroke:red;fill:url(#hatch)')
    expect(wall.hasAttribute('clip-path')).toBe(false)
    expect(wall.hasAttribute('mask')).toBe(false)
  })

  test('preserves safe CAD geometry, text and referenced defs without changing IDs', () => {
    const root = sanitize(`
      <svg xmlns="${SVG_NS}" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="gradient"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
          <radialGradient id="radial" cx="40%" cy="45%" r="60%" fx="15%" fy="20%" fr="5%"><stop offset="0" stop-color="#fff"/></radialGradient>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0H10V10"/></pattern>
          <clipPath id="clip"><path d="M0 0H50V50Z M10 10H20V20Z" clip-rule="evenodd"/></clipPath>
          <mask id="fade" mask-type="alpha"><rect width="50" height="50" fill="url(#radial)"/></mask>
          <marker id="arrow" markerWidth="5" markerHeight="5" refX="5" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5Z"/></marker>
          <path id="label-path" d="M0 20H80"/>
        </defs>
        <g id="drawing" clip-path="url(#clip)">
          <rect id="room" x="1" y="2" width="20" height="30" fill="url(#gradient)"/>
          <polyline id="leader" points="0,0 5,5 10,5" marker-end="url(#arrow)"/>
          <circle id="column" cx="8" cy="8" r="2" fill="url(#grid)"/>
          <text id="label" x="5" y="15" font-family="sans-serif"><textPath href="#label-path" startOffset="35%" method="stretch" spacing="auto" side="left">Room A</textPath></text>
        </g>
      </svg>
    `)

    expect(root.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(root.querySelector('#gradient')).not.toBeNull()
    expect(root.querySelector('#radial').getAttribute('fx')).toBe('15%')
    expect(root.querySelector('#radial').getAttribute('fy')).toBe('20%')
    expect(root.querySelector('#radial').getAttribute('fr')).toBe('5%')
    expect(root.querySelector('#grid')).not.toBeNull()
    expect(root.querySelector('#clip')).not.toBeNull()
    expect(root.querySelector('#clip path').getAttribute('clip-rule')).toBe('evenodd')
    expect(root.querySelector('#fade').getAttribute('mask-type')).toBe('alpha')
    expect(root.querySelector('#arrow')).not.toBeNull()
    expect(root.querySelector('#drawing').getAttribute('clip-path')).toBe('url(#clip)')
    expect(root.querySelector('#room').getAttribute('fill')).toBe('url(#gradient)')
    expect(root.querySelector('#leader').getAttribute('marker-end')).toBe('url(#arrow)')
    expect(root.querySelector('#column').getAttribute('fill')).toBe('url(#grid)')
    const textPath = root.querySelector('#label textPath')
    expect(textPath.textContent).toBe('Room A')
    expect(textPath.getAttribute('startOffset')).toBe('35%')
    expect(textPath.getAttribute('method')).toBe('stretch')
    expect(textPath.getAttribute('spacing')).toBe('auto')
    expect(textPath.getAttribute('side')).toBe('left')
  })

  test('does not trust a data-collection marker as a sanitizer bypass', () => {
    const root = sanitize(`
      <svg xmlns="${SVG_NS}" data-nanquim-version="999">
        <g id="collection-spoof" data-collection="true" onload="bad()">
          <script>window.pwned = true</script>
          <foreignObject><p xmlns="http://www.w3.org/1999/xhtml">host content</p></foreignObject>
          <path id="native-safe" d="M0 0L20 20"/>
        </g>
      </svg>
    `)

    expect(root.querySelector('[data-collection="true"]')).not.toBeNull()
    expect(root.querySelector('script, foreignObject')).toBeNull()
    expect(root.querySelector('#collection-spoof').hasAttribute('onload')).toBe(false)
    expect(root.querySelector('#native-safe')).not.toBeNull()
  })

  test('safe metadata parsing rejects prototype keys, excessive nesting and excessive input', () => {
    const safe = parseSafeJson('{"paper":{"width":210},"items":[1,2,3]}')
    expect(safe).toEqual({ paper: { width: 210 }, items: [1, 2, 3] })

    expect(parseSafeJson('{"__proto__":{"polluted":true}}')).toBeNull()
    expect(parseSafeJson('{"nested":{"constructor":{"prototype":{"polluted":true}}}}')).toBeNull()
    expect(parseSafeJson('{"a":{"b":{"c":1}}}', { maxDepth: 2 })).toBeNull()
    expect(parseSafeJson('"123456"', { maxLength: 4 })).toBeNull()
    expect({}.polluted).toBeUndefined()
  })

  test('standalone stylesheet sanitizer never emits an unscoped host selector', () => {
    const css = sanitizeStyleSheet('body,html,#app,.line,svg#Collection ~ #Handlers{display:none;stroke:black}')
    expect(css.split('{')[0].split(',')).toEqual([
      '#Collection body',
      '#Collection html',
      '#Collection #app',
      '#Collection .line',
      '#Collection svg#Collection ~ #Handlers',
    ])
  })

  test('keeps an existing drawing-root scope idempotent across reopen cycles', () => {
    const once = sanitizeStyleSheet('[data-nanquim-style-scope="saved"] .line{stroke:#123456}')
    const twice = sanitizeStyleSheet(once)
    const legacyRepeated = sanitizeStyleSheet(
      '#Collection #Collection [data-nanquim-style-scope="saved"] .line{stroke:#123456}',
    )

    expect(twice).toBe(once)
    expect(legacyRepeated).toBe(once)
    expect(twice).not.toContain('#Collection #Collection')
  })

  test('ID remapping changes only ID selectors and recognized local references', () => {
    const css = [
      '#fff,',
      '[id="fff"],',
      '[fill="#fff"],',
      '[data-swatch="#fff"],',
      '[href="#shape.with-dot"],',
      '[clip-path="url(#clip)"]',
      '{fill:url(#paint)}',
    ].join('')
    const rewritten = rewriteStyleReferences(css, new Map([
      ['fff', '101'],
      ['shape.with-dot', '102'],
      ['clip', '103'],
      ['paint', '104'],
    ]))

    expect(rewritten).toContain('[id="101"],[id="101"]')
    expect(rewritten).toContain('[fill="#fff"]')
    expect(rewritten).toContain('[data-swatch="#fff"]')
    expect(rewritten).toContain('[href="#102"]')
    expect(rewritten).toContain('[clip-path="url(#103)"]')
    expect(rewritten).toContain('{fill:url(#104)}')
    expect(rewritten).not.toContain('[fill="#101"]')
  })

  test('rejects SVG trees whose depth or element count exceed configured limits', () => {
    const depthDoc = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}"><g><g><g><path d="M0 0L1 1"/></g></g></g></svg>`,
      'image/svg+xml',
    )
    expect(() => sanitizeSvgDocument(depthDoc, { maxDepth: 2 })).toThrow(/deeply nested/)

    const countDoc = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}"><path/><path/><path/></svg>`,
      'image/svg+xml',
    )
    expect(() => sanitizeSvgDocument(countDoc, { maxElements: 3 })).toThrow(/too many elements/)
  })
})

describe('DXFLoader SVG sanitization boundary', () => {
  test('sanitizes a purported native Nanquim file before inserting drawing or block defs', async () => {
    const editor = createLoaderEditor()
    editor.dimensionManager.fromJSON.mockImplementation(() => { throw new TypeError('bad dimension schema') })
    editor.textStyleManager.fromJSON.mockImplementation(() => { throw new TypeError('bad text schema') })
    await openSvg(editor, `
      <svg xmlns="${SVG_NS}" data-element-index="999999999999999999999999999999"
        data-paper-config='{"__proto__":{"polluted":true}}'
        data-dim-styles='{"styles":[]}' data-text-styles='{"styles":[]}'>
        <defs>
          <g id="block-safe" data-block-def="true"><rect data-test="block-shape" width="4" height="4" onclick="bad()"/></g>
          <script>window.fromDefs = true</script>
        </defs>
        <g id="collection-native" data-collection="true" onload="bad()">
          <path id="999999999999999999999999999999" data-test="native-shape" d="M0 0L10 10" onclick="bad()"/>
          <foreignObject><p xmlns="http://www.w3.org/1999/xhtml">bad</p></foreignObject>
          <script>window.fromDrawing = true</script>
        </g>
      </svg>
    `, 'spoofed-native.svg')

    expect(editor.drawing.node.querySelector('[data-test="native-shape"]')).not.toBeNull()
    expect(editor.svg.node.querySelector('[data-test="block-shape"]')).not.toBeNull()
    expect(editor.svg.node.querySelector('script, foreignObject')).toBeNull()
    expect(editor.svg.node.querySelector('[onload], [onclick]')).toBeNull()
    expect(editor.paperConfig.polluted).toBeUndefined()
    expect({}.polluted).toBeUndefined()
    expect(editor.dimensionManager.fromJSON).toHaveBeenCalledOnce()
    expect(editor.textStyleManager.fromJSON).toHaveBeenCalledOnce()
    expect(Number(editor.drawing.node.querySelector('[data-test="native-shape"]').id)).toBeLessThan(1000000000)
    expect(editor.elementIndex).toBeLessThan(1000000000)
  })

  test('schema-filters native text and dimension styles before manager state can retain them', async () => {
    const editor = createLoaderEditor()
    const textStyles = {
      activeStyleId: 'SafeText',
      ignored: 'top-level field',
      styles: [
        { id: 'Standard', name: 'Standard', properties: {} },
        {
          id: 'SafeText',
          name: 'Safe Text',
          properties: {
            fontFamily: 'Fira Code, monospace',
            fontSize: 0.25,
            fontWeight: 500,
            fontStyle: 'italic',
            textAnchor: 'middle',
            dominantBaseline: 'hanging',
            letterSpacing: -0.02,
            textDecoration: 'underline',
            fill: 'rgb(12, 34, 56)',
            unknownProperty: 'discard me',
          },
        },
        {
          id: 'HostileText',
          name: 'Hostile Text',
          properties: {
            fontFamily: 'url(https://attacker.invalid/font.woff2)',
            fontSize: 1000001,
            fontWeight: 'url(https://attacker.invalid/weight)',
            fontStyle: 'expression(alert(1))',
            textAnchor: 'url(#outside)',
            dominantBaseline: '<unsafe>',
            letterSpacing: -1000001,
            textDecoration: 'blink url(https://attacker.invalid/decor)',
            fill: 'url(https://attacker.invalid/paint.svg#x)',
          },
        },
      ],
    }
    const dimensionStyles = {
      activeStyleId: 'Legacy',
      styles: [
        {
          id: 'SafeDim',
          name: 'Safe Dimension',
          properties: {
            textStyleId: 'SafeText',
            markerType: 'bullet',
            markerSize: 0.2,
            extensionLineOffset: -0.1,
            extensionLineExtend: 0.3,
            textOffset: 0,
            textColor: '#abcdef',
            lineColor: 'url("#local-paint")',
            lineWidth: 0.02,
          },
        },
        {
          id: 'Legacy',
          name: 'Legacy Dimension',
          properties: {
            arrowSize: 0.12,
            tickSize: 0.08,
            extensionLineOffset: 0.1,
            extensionLineExtend: 0.2,
            textOffset: 0.15,
            textColor: 'inherit',
            lineColor: 'white',
            lineWidth: 'inherit',
            fontFamily: 'url(https://attacker.invalid/legacy-font)',
          },
        },
        {
          id: 'HostileDim',
          name: 'Hostile Dimension',
          properties: {
            textStyleId: 'x'.repeat(129),
            markerType: 'image-set(url(https://attacker.invalid/marker.png) 1x)',
            markerSize: 1000001,
            extensionLineOffset: '1',
            extensionLineExtend: -1000001,
            textOffset: 1000001,
            textColor: 'url(https://attacker.invalid/text.svg#x)',
            lineColor: 'paint(attacker)',
            lineWidth: -1,
            unknownProperty: { nested: true },
          },
        },
      ],
    }

    await openSvg(editor, `
      <svg xmlns="${SVG_NS}"
        data-text-styles="${metadataAttribute(textStyles)}"
        data-dim-styles="${metadataAttribute(dimensionStyles)}">
        <defs><linearGradient id="local-paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
        <g data-collection="true"><text data-text-style-id="SafeText">Safe</text></g>
      </svg>
    `, 'native-style-schema.svg')

    const remappedLocalPaintId = editor.svg.node
      .querySelector('[data-nanquim-import-assets="true"] linearGradient')
      .id

    expect(editor.textStyleManager.fromJSON).toHaveBeenCalledWith({
      activeStyleId: 'SafeText',
      styles: [
        { id: 'Standard', name: 'Standard', properties: {} },
        {
          id: 'SafeText',
          name: 'Safe Text',
          properties: {
            fontFamily: 'Fira Code, monospace',
            fontSize: 0.25,
            fontWeight: '500',
            fontStyle: 'italic',
            textAnchor: 'middle',
            dominantBaseline: 'hanging',
            letterSpacing: -0.02,
            textDecoration: 'underline',
            fill: 'rgb(12, 34, 56)',
          },
        },
        { id: 'HostileText', name: 'Hostile Text', properties: {} },
      ],
    })
    expect(editor.dimensionManager.fromJSON).toHaveBeenCalledWith({
      activeStyleId: 'Legacy',
      styles: [
        {
          id: 'SafeDim',
          name: 'Safe Dimension',
          properties: {
            textStyleId: 'SafeText',
            markerType: 'bullet',
            markerSize: 0.2,
            extensionLineOffset: -0.1,
            extensionLineExtend: 0.3,
            textOffset: 0,
            textColor: '#abcdef',
            lineColor: `url("#${remappedLocalPaintId}")`,
            lineWidth: 0.02,
          },
        },
        {
          id: 'Legacy',
          name: 'Legacy Dimension',
          properties: {
            textStyleId: 'Standard',
            markerType: 'tick',
            markerSize: 0.08,
            extensionLineOffset: 0.1,
            extensionLineExtend: 0.2,
            textOffset: 0.15,
            textColor: 'inherit',
            lineColor: 'white',
            lineWidth: 'inherit',
          },
        },
        {
          id: 'HostileDim',
          name: 'Hostile Dimension',
          properties: { textStyleId: 'Standard', markerType: 'arrow' },
        },
      ],
    })
    expect(JSON.stringify([
      editor.textStyleManager.fromJSON.mock.calls,
      editor.dimensionManager.fromJSON.mock.calls,
    ])).not.toMatch(/attacker|https?:|image-set|paint\(attacker\)|unknownProperty/i)
  })

  test('rejects over-count, overlong and oversized style metadata without partial manager loads', async () => {
    const invalidIdentityEditor = createLoaderEditor()
    await openSvg(invalidIdentityEditor, `
      <svg xmlns="${SVG_NS}"
        data-text-styles="${metadataAttribute({
          styles: [{ id: 'Text', name: 'n'.repeat(NATIVE_STYLE_METADATA_LIMITS.maxNameLength + 1), properties: {} }],
        })}"
        data-dim-styles="${metadataAttribute({
          styles: [{ id: 'i'.repeat(NATIVE_STYLE_METADATA_LIMITS.maxIdentifierLength + 1), name: 'Dim', properties: {} }],
        })}">
        <g data-collection="true"><line/></g>
      </svg>
    `, 'invalid-style-identities.svg')
    expect(invalidIdentityEditor.textStyleManager.fromJSON).not.toHaveBeenCalled()
    expect(invalidIdentityEditor.dimensionManager.fromJSON).not.toHaveBeenCalled()

    const overCountEditor = createLoaderEditor()
    const tooManyStyles = Array.from(
      { length: NATIVE_STYLE_METADATA_LIMITS.maxStyles + 1 },
      (_entry, index) => ({ id: `style-${index}`, name: `Style ${index}`, properties: {} }),
    )
    await openSvg(overCountEditor, `
      <svg xmlns="${SVG_NS}" data-text-styles="${metadataAttribute({ styles: tooManyStyles })}">
        <g data-collection="true"><line/></g>
      </svg>
    `, 'too-many-styles.svg')
    expect(overCountEditor.textStyleManager.fromJSON).not.toHaveBeenCalled()

    const oversizedEditor = createLoaderEditor()
    const oversizedStyles = {
      styles: [{
        id: 'Standard',
        name: 'Standard',
        properties: { ignoredPadding: 'x'.repeat(NATIVE_STYLE_METADATA_LIMITS.maxBytes) },
      }],
    }
    await openSvg(oversizedEditor, `
      <svg xmlns="${SVG_NS}" data-text-styles="${metadataAttribute(oversizedStyles)}">
        <g data-collection="true"><line/></g>
      </svg>
    `, 'oversized-style-metadata.svg')
    expect(oversizedEditor.textStyleManager.fromJSON).not.toHaveBeenCalled()
  })

  test('sanitizes foreign geometry and scopes CSS before cloning it into the live SVG', async () => {
    const editor = createLoaderEditor()
    await openSvg(editor, `
      <svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">
        <style>body,.wall{stroke:#00ff00;fill:url(#paint)} @import url(https://example.test/x.css);</style>
        <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
        <script>window.foreignScript = true</script>
        <path data-test="foreign-shape" class="wall" d="M0 0L20 0" onclick="bad()"/>
        <use data-test="remote-use" xlink:href="https://example.test/file.svg#x"/>
      </svg>
    `, 'foreign.svg')

    const imported = editor.drawing.node.querySelector('[data-test="foreign-shape"]')
    const remoteUse = editor.drawing.node.querySelector('[data-test="remote-use"]')
    const css = editor.svg.node.querySelector('defs style').textContent
    expect(imported).not.toBeNull()
    expect(imported.hasAttribute('onclick')).toBe(false)
    expect(remoteUse.hasAttributeNS(XLINK_NS, 'href')).toBe(false)
    expect(editor.svg.node.querySelector('script')).toBeNull()
    expect(css).toContain('#Collection body,#Collection .wall')
    expect(css).not.toMatch(/@import|https?:/i)
    expect(editor.drawing.node.firstElementChild.getAttribute('data-collection')).toBe('true')
  })

  test('atomically remaps imported targets, repairs references, and blocks host-local escapes', async () => {
    const editor = createLoaderEditor()
    const appPaint = document.createElementNS(SVG_NS, 'linearGradient')
    appPaint.id = 'paint'
    editor.svg.defs().node.appendChild(appPaint)

    await openSvg(editor, `
      <svg xmlns="${SVG_NS}">
        <style>svg > g > rect,#shape{fill:url(#paint);clip-path:url(#clip)}</style>
        <metadata id="nanquim-geometry-nodes">{"paint":"url(\\\"#paint\\\")","missing":"url(#Collection)"}</metadata>
        <defs>
          <linearGradient id="paint" data-import-target="paint"><stop offset="0" stop-color="#fff"/></linearGradient>
          <clipPath id="clip" data-import-target="clip"><rect width="4" height="4"/></clipPath>
          <path id="text-route" data-import-target="route" d="M0 0H20"/>
          <g id="glyph" data-import-target="glyph"><circle r="1"/></g>
        </defs>
        <g data-import-root="geometry">
          <rect id="shape" data-import-shape="true" data-nanquim-preserve-id="true"
            width="5" height="5" clip-path="url(#clip)"/>
          <text><textPath data-import-text-path="true" href="#text-route">Label</textPath></text>
          <use data-import-use="true" href="#glyph"/>
          <use data-host-escape="true" href="#Collection"/>
        </g>
      </svg>
    `, 'local-references.svg')

    const assets = editor.svg.node.querySelector('[data-nanquim-import-assets="true"]')
    const shape = editor.drawing.node.querySelector('[data-import-shape="true"]')
    const clip = assets.querySelector('[data-import-target="clip"]')
    const paint = assets.querySelector('[data-import-target="paint"]')
    const route = assets.querySelector('[data-import-target="route"]')
    const glyph = assets.querySelector('[data-import-target="glyph"]')
    const textPath = editor.drawing.node.querySelector('[data-import-text-path="true"]')
    const localUse = editor.drawing.node.querySelector('[data-import-use="true"]')
    const hostEscape = editor.drawing.node.querySelector('[data-host-escape="true"]')
    const css = assets.querySelector('style').textContent
    const importWrapper = editor.drawing.node.querySelector('[data-nanquim-import-root="true"]')

    expect(shape.id).toMatch(/^\d+$/)
    expect(shape.hasAttribute('data-nanquim-preserve-id')).toBe(false)
    expect(paint.id).toMatch(/^\d+$/)
    expect(paint).not.toBe(appPaint)
    expect(appPaint.isConnected).toBe(true)
    expect(shape.getAttribute('clip-path')).toBe(`url(#${clip.id})`)
    expect(textPath.getAttribute('href')).toBe(`#${route.id}`)
    expect(localUse.getAttribute('href')).toBe(`#${glyph.id}`)
    expect(hostEscape.getAttribute('href')).not.toBe('#Collection')
    expect(document.getElementById(hostEscape.getAttribute('href').slice(1))).toBeNull()
    expect(css).toContain(`#Collection > [data-nanquim-import-root="true"] > g > rect`)
    expect(css).toContain(`[id="${shape.id}"]`)
    expect(css).toContain(`fill:url(#${paint.id})`)
    expect(importWrapper.id).toMatch(/^\d+$/)
    expect(editor.geometryNodes.load).toHaveBeenCalledWith(expect.objectContaining({
      paint: `url("#${paint.id}")`,
      missing: expect.stringMatching(/^url\(#nanquim-unresolved-import-/),
    }))

    const liveIds = Array.from(editor.svg.node.querySelectorAll('[id]'), (element) => element.id)
    expect(new Set(liveIds).size).toBe(liveIds.length)
  })

  test('keeps native block definitions and instances aligned through host ID collisions', async () => {
    const editor = createLoaderEditor()
    const appOwned = document.createElementNS(SVG_NS, 'marker')
    appOwned.id = 'block-Door'
    editor.svg.defs().node.appendChild(appOwned)

    await openSvg(editor, `
      <svg xmlns="${SVG_NS}">
        <defs>
          <g id="block-Door" data-block-def="true" data-base-point='{"x":0,"y":0}'>
            <rect width="4" height="8"/>
          </g>
        </defs>
        <g id="collection-native" data-collection="true">
          <use id="door-instance" data-block-instance="true" data-block-name="Door" href="#block-Door"/>
        </g>
      </svg>
    `, 'native-block.svg')

    const importedDefinition = editor.svg.node.querySelector('[data-block-def="true"]')
    const importedInstance = editor.drawing.node.querySelector('[data-block-instance="true"]')
    const importedName = importedInstance.getAttribute('data-block-name')

    expect(appOwned.isConnected).toBe(true)
    expect(importedDefinition.id).toMatch(/^block-Door-imported-\d+$/)
    expect(importedInstance.getAttribute('href')).toBe(`#${importedDefinition.id}`)
    expect(importedDefinition.id).toBe(`block-${importedName}`)
    expect(editor.blockDefinitions.get(importedName)).toEqual(expect.objectContaining({
      defId: importedDefinition.id,
    }))
    expect(editor.drawing.node.querySelector('[data-collection="true"]').id).toMatch(/^\d+$/)
  })

  test('reopens a native scoped stylesheet without accumulating drawing-root prefixes', async () => {
    const firstEditor = createLoaderEditor()
    await openSvg(firstEditor, `
      <svg xmlns="${SVG_NS}">
        <g id="native-collection" data-collection="true">
          <style data-native-roundtrip-style="true">
            [data-nanquim-style-scope="saved"] .painted { fill: #123456 }
          </style>
          <g data-nanquim-style-scope="saved"><rect class="painted" width="4" height="4"/></g>
        </g>
      </svg>
    `, 'native-style-first-open.svg')

    const firstCss = firstEditor.drawing.node
      .querySelector('[data-native-roundtrip-style="true"]')
      .textContent
    expect(firstCss).toBe('#Collection [data-nanquim-style-scope="saved"] .painted{fill:#123456}')

    const secondEditor = createLoaderEditor()
    await openSvg(secondEditor, `
      <svg xmlns="${SVG_NS}">${firstEditor.drawing.node.innerHTML}</svg>
    `, 'native-style-second-open.svg')

    const secondCss = secondEditor.drawing.node
      .querySelector('[data-native-roundtrip-style="true"]')
      .textContent
    expect(secondCss).toBe(firstCss)
    expect(secondCss).not.toContain('#Collection #Collection')
  })

  test('replaces prior imported defs and CSS while preserving app-owned definitions', async () => {
    const editor = createLoaderEditor()
    const appMarker = document.createElementNS(SVG_NS, 'marker')
    appMarker.id = 'app-owned-marker'
    editor.svg.defs().node.appendChild(appMarker)

    await openSvg(editor, `
      <svg xmlns="${SVG_NS}">
        <style>.first{fill:url(#stale-paint)}</style>
        <defs><linearGradient id="stale-paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
        <rect class="first" width="2" height="2"/>
      </svg>
    `, 'first.svg')
    const firstPaint = editor.svg.node.querySelector('[data-nanquim-import-assets="true"] linearGradient')
    expect(firstPaint).not.toBeNull()
    expect(firstPaint.id).toMatch(/^\d+$/)
    expect(editor.svg.node.querySelector('[data-nanquim-import-assets="true"] style')).not.toBeNull()

    const staleBlock = document.createElementNS(SVG_NS, 'g')
    staleBlock.id = 'stale-session-block'
    staleBlock.setAttribute('data-block-def', 'true')
    editor.svg.defs().node.appendChild(staleBlock)

    await openSvg(editor, `
      <svg xmlns="${SVG_NS}"><circle cx="2" cy="2" r="1"/></svg>
    `, 'second.svg')

    expect(firstPaint.isConnected).toBe(false)
    expect(editor.svg.node.querySelector('#stale-session-block')).toBeNull()
    expect(editor.svg.node.querySelector('[data-nanquim-import-assets="true"] style')).toBeNull()
    expect(editor.svg.node.querySelector('#app-owned-marker')).toBe(appMarker)
    expect(editor.svg.node.querySelectorAll('[data-nanquim-import-assets="true"]')).toHaveLength(1)
  })

  test('rejects DOCTYPE input and files over the raw import limit before live insertion', async () => {
    const doctypeEditor = createLoaderEditor()
    await expect(openSvg(
      doctypeEditor,
      `<!DOCTYPE svg><svg xmlns="${SVG_NS}"><rect width="1" height="1"/></svg>`,
      'doctype.svg',
    )).rejects.toThrow(/DOCTYPE declarations are not supported/)
    expect(doctypeEditor.drawing.node.children).toHaveLength(0)
    expect(doctypeEditor.resetPaperConfig).not.toHaveBeenCalled()

    const largeEditor = createLoaderEditor()
    const largeFile = new File([`<svg xmlns="${SVG_NS}"/>`], 'large.svg', { type: 'image/svg+xml' })
    Object.defineProperty(largeFile, 'size', { value: MAX_SVG_IMPORT_BYTES + 1 })
    await expect(openFile(largeEditor, largeFile)).rejects.toThrow(/too large/)
    expect(largeEditor.drawing.node.children).toHaveLength(0)
    expect(largeEditor.resetPaperConfig).not.toHaveBeenCalled()

    expect(markupFitsSvgImportElementBudget('<svg><g><path/></g></svg>', 3)).toBe(true)
    expect(markupFitsSvgImportElementBudget('<svg><g><path/></g></svg>', 2)).toBe(false)
    expect(markupFitsSvgImportElementBudget('<svg><é/><路径/></svg>', 3)).toBe(true)
    expect(markupFitsSvgImportElementBudget('<svg><é/><路径/></svg>', 2)).toBe(false)
    expect(markupFitsSvgImportElementBudget('<svg><!-- <é/> --><![CDATA[<路径/>]]><g/></svg>', 2)).toBe(true)
  })
})
