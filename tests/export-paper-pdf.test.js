// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

import {
  exportPaperPDF,
  expandPaperViewportUsesForPDF,
  registerFontsWithJsPDF,
} from '../src/js/utils/ExportPaper.js'

const PAPER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 21 29.7" width="210mm" height="297mm">
    <defs>
      <style>#Collection #model-line { stroke-width: 0.1; }</style>
      <g id="Collection" stroke="#000000" stroke-width="0.1" fill="none">
        <clipPath id="model-clip">
          <rect x="-4" y="-3" width="8" height="6" />
        </clipPath>
        <g id="model-shapes" aria-labelledby="model-title" clip-path="url(#model-clip)">
          <title id="model-title">Model geometry</title>
          <line id="model-line" x1="-3" y1="-2" x2="3" y2="-2" />
          <rect id="model-rect" x="-2" y="0" width="2" height="1.5" />
        </g>
      </g>
      <clipPath id="vp-clip">
        <rect x="3" y="3" width="15" height="14" />
      </clipPath>
    </defs>
    <g data-paper-viewport="true">
      <g clip-path="url(#vp-clip)">
        <use href="#Collection" transform="matrix(1,0,0,1,10.5,10.25)" />
      </g>
    </g>
  </svg>
`

const LINE_ONLY_PAPER_SVG = PAPER_SVG.replace(
  '          <rect id="model-rect" x="-2" y="0" width="2" height="1.5" />\n',
  '',
)

const TWO_VIEWPORT_PAPER_SVG = PAPER_SVG
  .replace(
    '      </clipPath>\n',
    `      </clipPath>
      <clipPath id="vp-clip-2">
        <rect x="1" y="1" width="8" height="6" />
      </clipPath>
`,
  )
  .replace(
    '  </svg>',
    `    <g data-paper-viewport="true">
      <g clip-path="url(#vp-clip-2)">
        <use href="#Collection" transform="matrix(0.5,0,0,0.5,4,3)" />
      </g>
    </g>
  </svg>`,
  )

const NESTED_BLOCK_PAPER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 21 29.7" width="210mm" height="297mm">
    <defs>
      <g id="nested-block" stroke="#000000" stroke-width="0.1" fill="none">
        <line id="nested-line" x1="0" y1="0" x2="10" y2="0" />
      </g>
      <g id="Collection">
        <use id="nested-block-use" href="#nested-block" transform="translate(2 3)" />
      </g>
      <clipPath id="nested-vp-clip"><rect width="20" height="20" /></clipPath>
    </defs>
    <g data-paper-viewport="true">
      <g clip-path="url(#nested-vp-clip)">
        <use href="#Collection" transform="matrix(1,0,0,1,1,1)" />
      </g>
    </g>
  </svg>
`

const NESTED_SYMBOL_PAPER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 29.7">
    <defs>
      <symbol id="nested-symbol" viewBox="0 0 10 5">
        <line id="symbol-line" x2="10" y2="5" stroke="#000000" />
      </symbol>
      <g id="Collection">
        <use href="#nested-symbol" width="20" height="10" x="2" y="3" />
      </g>
    </defs>
    <g data-paper-viewport="true"><use href="#Collection" /></g>
  </svg>
`

const CYCLIC_PAPER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 29.7">
    <defs>
      <g id="cycle-a"><use href="#cycle-b" /></g>
      <g id="cycle-b"><use href="#cycle-a" /></g>
      <g id="Collection"><use href="#cycle-a" /></g>
    </defs>
    <g data-paper-viewport="true"><use href="#Collection" /></g>
  </svg>
`

const DEEP_PAPER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 29.7">
    <defs>
      <g id="deep-c"><line x2="1" /></g>
      <g id="deep-b"><use href="#deep-c" /></g>
      <g id="deep-a"><use href="#deep-b" /></g>
      <g id="Collection"><use href="#deep-a" /></g>
    </defs>
    <g data-paper-viewport="true"><use href="#Collection" /></g>
  </svg>
`

function parsePaperSVG(source = PAPER_SVG) {
  return new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
}

async function renderPDF(svg) {
  const pdf = new jsPDF({
    compress: false,
    format: [210, 297],
    orientation: 'p',
    unit: 'mm',
  })
  await svg2pdf(svg, pdf, { x: 0, y: 0, width: 210, height: 297 })
  return pdf.output()
}

describe('Paper PDF viewport references', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete window.SVGElement.prototype.getBBox
  })

  test('expands the model reference without changing its transform or viewport clip', () => {
    const svg = parsePaperSVG()

    expect(expandPaperViewportUsesForPDF(svg)).toBe(1)

    const viewportContent = svg.querySelector('[data-paper-viewport="true"] > g')
    const expanded = viewportContent.querySelector('[data-paper-pdf-expanded-use="Collection"]')
    expect(viewportContent.getAttribute('clip-path')).toBe('url(#vp-clip)')
    expect(viewportContent.querySelector('use')).toBeNull()
    expect(expanded.getAttribute('transform')).toBe('matrix(1,0,0,1,10.5,10.25)')
    expect(expanded.firstElementChild.id).not.toBe('Collection')
    expect(svg.querySelector('defs > #Collection')).not.toBeNull()
    expect(expanded.querySelector('line')).not.toBeNull()
    expect(expanded.querySelector('rect')).not.toBeNull()
    const labelled = expanded.querySelector('[aria-labelledby]')
    expect(labelled.getAttribute('aria-labelledby')).not.toBe('model-title')
    expect(expanded.querySelector(`#${labelled.getAttribute('aria-labelledby')}`)).not.toBeNull()
    const clipped = expanded.querySelector('[clip-path]')
    const clipId = clipped.getAttribute('clip-path').match(/^url\(#(.+)\)$/)?.[1]
    expect(expanded.querySelector(`#${clipId}`)?.localName).toBe('clipPath')
    const scopedStyle = expanded.querySelector('style')
    expect(scopedStyle.textContent).toContain(expanded.firstElementChild.id)
    expect(scopedStyle.textContent).toContain(expanded.querySelector('line').id)
    expect(scopedStyle.textContent).not.toContain('#Collection')

    // The line and rectangle both land inside the 3,3 → 18,17 viewport.
    const modelPoints = [
      [-3, -2], [3, -2],
      [-2, 0], [0, 0], [-2, 1.5], [0, 1.5],
    ]
    const paperPoints = modelPoints.map(([x, y]) => [x + 10.5, y + 10.25])
    expect(paperPoints.every(([x, y]) => x >= 3 && x <= 18 && y >= 3 && y <= 17)).toBe(true)
  })

  test('renders every referenced model path without a clipping Form XObject', async () => {
    const svg = parsePaperSVG()
    expandPaperViewportUsesForPDF(svg)
    const output = await renderPDF(svg)

    expect(output).not.toContain('/Subtype /Form')
    expect(output).toContain('-3. -2. m\n3. -2. l')
    expect(output).toContain('-2. 0. m\n0. 0. l\n0. 1.5 l\n-2. 1.5 l')
  })

  test('renders a line-only referenced Collection instead of an empty Form bound', async () => {
    const svg = parsePaperSVG(LINE_ONLY_PAPER_SVG)
    expect(expandPaperViewportUsesForPDF(svg)).toBe(1)

    const output = await renderPDF(svg)

    // Without expansion svg2pdf 2.7.0 emits /BBox [0 0 0 0] because the
    // inherited stroke has not been resolved when it measures the line.
    expect(output).not.toContain('/Subtype /Form')
    expect(output).toMatch(/-3\. -2\. m\n3\. -2\. l\n[SB]\n/)
  })

  test('expands every viewport with its own transform and clip', () => {
    const svg = parsePaperSVG(TWO_VIEWPORT_PAPER_SVG)

    expect(expandPaperViewportUsesForPDF(svg)).toBe(2)

    const viewports = Array.from(svg.querySelectorAll('[data-paper-viewport="true"]'))
    const expanded = viewports.map((viewport) => viewport.querySelector('[data-paper-pdf-expanded-use="Collection"]'))
    expect(svg.querySelectorAll('[data-paper-viewport="true"] use')).toHaveLength(0)
    expect(viewports.map((viewport) => viewport.firstElementChild.getAttribute('clip-path'))).toEqual([
      'url(#vp-clip)',
      'url(#vp-clip-2)',
    ])
    expect(expanded.map((node) => node.getAttribute('transform'))).toEqual([
      'matrix(1,0,0,1,10.5,10.25)',
      'matrix(0.5,0,0,0.5,4,3)',
    ])
    expect(new Set(expanded.map(node => node.firstElementChild.id)).size).toBe(2)
    expect(expanded.every((node) => node.querySelector('line') && node.querySelector('rect'))).toBe(true)

    const ids = Array.from(svg.querySelectorAll('[id]'), element => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expanded.forEach((node) => {
      const labelled = node.querySelector('[aria-labelledby]')
      const labelId = labelled.getAttribute('aria-labelledby')
      expect(node.querySelector(`#${labelId}`)?.localName).toBe('title')
      const clipped = node.querySelector('[clip-path]')
      const clipId = clipped.getAttribute('clip-path').match(/^url\(#(.+)\)$/)?.[1]
      expect(node.querySelector(`#${clipId}`)?.localName).toBe('clipPath')
    })
  })

  test('recursively expands a line-only block while preserving nested transforms', async () => {
    const svg = parsePaperSVG(NESTED_BLOCK_PAPER_SVG)

    expect(expandPaperViewportUsesForPDF(svg)).toBe(2)
    expect(svg.querySelector('[data-paper-viewport="true"] use')).toBeNull()
    const nested = svg.querySelector('[data-paper-pdf-expanded-use="nested-block"]')
    expect(nested.getAttribute('transform')).toBe('translate(2 3)')
    expect(nested.querySelector('line')).not.toBeNull()

    const output = await renderPDF(svg)
    expect(output).not.toContain('/Subtype /Form')
    expect(output).toMatch(/0\. 0\. m\n10\. 0\. l\n[SB]\n/)
  })

  test('turns nested symbol references into sized inline SVG content', () => {
    const svg = parsePaperSVG(NESTED_SYMBOL_PAPER_SVG)

    expect(expandPaperViewportUsesForPDF(svg)).toBe(2)
    const nested = svg.querySelector('[data-paper-pdf-expanded-use="nested-symbol"]')
    const symbolClone = nested.firstElementChild

    expect(symbolClone.localName).toBe('svg')
    expect(symbolClone.getAttribute('viewBox')).toBe('0 0 10 5')
    expect(symbolClone.getAttribute('width')).toBe('20')
    expect(symbolClone.getAttribute('height')).toBe('10')
    expect(nested.getAttribute('transform')).toBe('translate(2 3)')
    expect(nested.querySelector('line')).not.toBeNull()
  })

  test('rejects cyclic, over-depth, and over-budget nested references', () => {
    expect(() => expandPaperViewportUsesForPDF(parsePaperSVG(CYCLIC_PAPER_SVG)))
      .toThrow(/cyclic local use reference/i)
    expect(() => expandPaperViewportUsesForPDF(parsePaperSVG(DEEP_PAPER_SVG), { maxDepth: 1 }))
      .toThrow(/nested use depth exceeds 1/i)
    expect(() => expandPaperViewportUsesForPDF(parsePaperSVG(NESTED_BLOCK_PAPER_SVG), {
      maxExpandedNodes: 1,
    })).toThrow(/exceeds 1 cloned nodes/i)
    expect(() => expandPaperViewportUsesForPDF(parsePaperSVG(NESTED_BLOCK_PAPER_SVG), {
      maxExpandedUses: 1,
    })).toThrow(/exceeds 1 references/i)
    expect(() => expandPaperViewportUsesForPDF(parsePaperSVG(PAPER_SVG), {
      maxClonedMarkupBytes: 1,
    })).toThrow(/exceeds 1 cloned markup bytes/i)

    const attributeHeavy = parsePaperSVG(NESTED_BLOCK_PAPER_SVG)
    attributeHeavy.querySelector('#nested-line').setAttribute('data-payload', 'x'.repeat(256))
    expect(() => expandPaperViewportUsesForPDF(attributeHeavy, {
      maxClonedMarkupBytes: 256,
    })).toThrow(/exceeds 256 cloned markup bytes/i)
  })

  test('reports cyclic PDF preprocessing as a handled export failure', async () => {
    const svg = parsePaperSVG(CYCLIC_PAPER_SVG)
    const collection = svg.querySelector('#Collection')
    const modelSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const modelDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    ;['cycle-a', 'cycle-b'].forEach((id) => {
      const source = svg.querySelector(`#${id}`).cloneNode(true)
      source.setAttribute('data-block-def', 'true')
      modelDefs.appendChild(source)
    })
    modelSvg.append(modelDefs, collection.cloneNode(true))
    const paperSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    paperSvg.appendChild(svg.querySelector('[data-paper-viewport="true"]').cloneNode(true))
    const terminalLogged = { dispatch: vi.fn() }
    const editor = {
      drawing: { node: modelSvg.querySelector('#Collection') },
      paperConfig: {
        colorMap: {},
        height: 297,
        orientation: 'portrait',
        size: 'A4',
        unitsPerCm: 1,
        width: 210,
      },
      paperEditor: { getPaperDimsSVG: () => ({ wSVG: 21, hSVG: 29.7 }) },
      paperSvg: { node: paperSvg },
      signals: { terminalLogged },
      svg: { node: modelSvg },
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(exportPaperPDF(editor, [])).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalled()
    expect(terminalLogged.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      msg: expect.stringMatching(/PDF export failed:.*cyclic local use reference/i),
    }))
  })

  test('embeds the bundled Inter font and retains readable dimension text as vectors', async () => {
    Object.defineProperty(window.SVGElement.prototype, 'getBBox', {
      configurable: true,
      value() {
        if (this.localName === 'text' || this.localName === 'tspan') {
          const fontSize = Number(this.getAttribute('font-size')) || 4
          return {
            x: Number(this.getAttribute('x')) || 0,
            y: (Number(this.getAttribute('y')) || 0) - fontSize,
            width: (this.textContent || '').length * fontSize * 0.6,
            height: fontSize,
          }
        }
        return { x: 0, y: 0, width: 0, height: 0 }
      },
    })
    const font = await readFile(join(process.cwd(), 'public/fonts/generated/Inter-400.ttf'))
    vi.stubGlobal('fetch', vi.fn(async url => ({
      ok: url === '/fonts/generated/Inter-400.ttf',
      arrayBuffer: async () => font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
    })))
    const svg = parsePaperSVG(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm">
        <g data-dimension="linear" stroke="#000000" stroke-width="0.25" fill="none">
          <line x1="20" y1="30" x2="120" y2="30" />
          <line x1="20" y1="26" x2="20" y2="34" />
          <line x1="120" y1="26" x2="120" y2="34" />
          <text x="70" y="26" text-anchor="middle" fill="#000000" stroke="none"
            font-family="Inter" font-size="4" font-weight="400">100 cm</text>
        </g>
      </svg>
    `)
    const pdf = new jsPDF({ compress: false, format: [210, 297], orientation: 'p', unit: 'mm' })

    await registerFontsWithJsPDF(pdf, svg, '')
    await svg2pdf(svg, pdf, { x: 0, y: 0, width: 210, height: 297 })

    const output = Buffer.from(pdf.output('arraybuffer')).toString('latin1')
    expect(output).toContain('/FontFile2')
    expect(output).toMatch(/\/BaseFont \/Inter/i)
    const mediaBox = output.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
    expect(Number(mediaBox?.[1])).toBeCloseTo(210 * 72 / 25.4, 8)
    expect(Number(mediaBox?.[2])).toBeCloseTo(297 * 72 / 25.4, 8)
    const unicodeByGlyph = new Map(
      Array.from(output.matchAll(/<([0-9a-f]{4})><([0-9a-f]{4})>/gi), match => [
        match[1].toLowerCase(),
        String.fromCodePoint(Number.parseInt(match[2], 16)),
      ]),
    )
    const encodedText = output.match(/<([0-9a-f]+)> Tj/i)?.[1] || ''
    const decodedText = encodedText
      .match(/.{4}/g)
      ?.map(glyph => unicodeByGlyph.get(glyph.toLowerCase()) || '')
      .join('')
    expect(decodedText).toBe('100 cm')
    expect(output).toMatch(/20\. 30\. m\n120\. 30\. l/)
  })
})
