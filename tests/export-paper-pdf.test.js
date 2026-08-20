// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

import { expandPaperViewportUsesForPDF } from '../src/js/utils/ExportPaper.js'

const PAPER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 21 29.7" width="210mm" height="297mm">
    <defs>
      <g id="Collection" stroke="#000000" stroke-width="0.1" fill="none">
        <line x1="-3" y1="-2" x2="3" y2="-2" />
        <rect x="-2" y="0" width="2" height="1.5" />
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
  '        <rect x="-2" y="0" width="2" height="1.5" />\n',
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

  test('expands the model reference without changing its transform or viewport clip', () => {
    const svg = parsePaperSVG()

    expect(expandPaperViewportUsesForPDF(svg)).toBe(1)

    const viewportContent = svg.querySelector('[data-paper-viewport="true"] > g')
    const expanded = viewportContent.querySelector('[data-paper-pdf-expanded-use="Collection"]')
    expect(viewportContent.getAttribute('clip-path')).toBe('url(#vp-clip)')
    expect(viewportContent.querySelector('use')).toBeNull()
    expect(expanded.getAttribute('transform')).toBe('matrix(1,0,0,1,10.5,10.25)')
    expect(expanded.firstElementChild.hasAttribute('id')).toBe(false)
    expect(svg.querySelector('defs > #Collection')).not.toBeNull()
    expect(expanded.querySelector('line')).not.toBeNull()
    expect(expanded.querySelector('rect')).not.toBeNull()

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
    expect(expanded.every((node) => !node.firstElementChild.hasAttribute('id'))).toBe(true)
    expect(expanded.every((node) => node.querySelector('line') && node.querySelector('rect'))).toBe(true)
  })
})
