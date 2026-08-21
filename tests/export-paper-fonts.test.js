// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { registerFontsWithJsPDF } from '../src/js/utils/ExportPaper.js'

function createSvgText({ family, style = 'normal', weight = 'normal' }) {
  document.body.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text font-family="${family}" font-style="${style}" font-weight="${weight}">Text</text>
    </svg>
  `
  return document.querySelector('svg')
}

function createPdfStub() {
  return {
    addFileToVFS: vi.fn(),
    addFont: vi.fn(),
  }
}

function successfulFontResponse() {
  return {
    ok: true,
    arrayBuffer: async () => Uint8Array.from([0, 1, 2, 3]).buffer,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('Paper PDF font registration', () => {
  test('registers only the used bundled variant and ignores its local CSS faces', async () => {
    const fetchMock = vi.fn(async () => successfulFontResponse())
    vi.stubGlobal('fetch', fetchMock)
    const pdf = createPdfStub()
    const svg = createSvgText({ family: 'Inter', weight: '400' })
    const css = `
      @font-face {
        font-family: Inter;
        font-style: normal;
        font-weight: 400;
        src: url('/fonts/generated/Inter-400.ttf') format('truetype');
      }
      @font-face {
        font-family: Inter;
        font-style: normal;
        font-weight: 700;
        src: url('/fonts/generated/Inter-700.ttf') format('truetype');
      }
    `

    const result = await registerFontsWithJsPDF(pdf, svg, css)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/fonts/generated/Inter-400.ttf')
    expect(pdf.addFileToVFS).toHaveBeenCalledTimes(1)
    expect(pdf.addFont).toHaveBeenCalledWith(
      'Inter-400-normal.ttf',
      'Inter',
      'normal',
      400,
    )
    expect(result).toEqual({ requested: 1, registered: 1, fallback: 0 })
  })

  test('registers only the requested non-bundled CSS variant once', async () => {
    const fetchMock = vi.fn(async () => successfulFontResponse())
    vi.stubGlobal('fetch', fetchMock)
    const pdf = createPdfStub()
    const svg = createSvgText({ family: 'Fixture Sans' })
    const css = `
      @font-face {
        font-family: 'Fixture Sans';
        font-style: normal;
        font-weight: 400;
        src: url('/fonts/fixture-400.ttf') format('truetype');
      }
      @font-face {
        font-family: 'Fixture Sans';
        font-style: normal;
        font-weight: 700;
        src: url('/fonts/fixture-700.ttf') format('truetype');
      }
      @font-face {
        font-family: 'Fixture Sans';
        font-style: normal;
        font-weight: 400;
        src: url('/fonts/fixture-400-duplicate.ttf') format('truetype');
      }
    `

    await registerFontsWithJsPDF(pdf, svg, css)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/fonts\/fixture-400\.ttf$/)
    expect(pdf.addFileToVFS).toHaveBeenCalledTimes(1)
    expect(pdf.addFont).toHaveBeenCalledWith(
      'Fixture Sans-400-normal.ttf',
      'Fixture Sans',
      'normal',
      '400',
    )
  })

  test('resolves inherited families and class-based variants for dimension text', async () => {
    document.body.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <g font-family="DM Sans" font-weight="700">
          <text class="dimension-label">100 cm</text>
        </g>
      </svg>
    `
    const fetchMock = vi.fn(async () => successfulFontResponse())
    vi.stubGlobal('fetch', fetchMock)
    const pdf = createPdfStub()

    await registerFontsWithJsPDF(
      pdf,
      document.querySelector('svg'),
      '.dimension-label { font-style: italic; }',
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/fonts/generated/DMSans-Italic-700.ttf')
    expect(pdf.addFont).toHaveBeenCalledWith(
      'DM Sans-700-italic.ttf',
      'DM Sans',
      'italic',
      700,
    )
    expect(document.querySelector('.dimension-label')).toMatchObject({
      outerHTML: expect.stringContaining('font-family="DM Sans"'),
    })
    expect(document.querySelector('.dimension-label').getAttribute('font-style')).toBe('italic')
    expect(document.querySelector('.dimension-label').getAttribute('font-weight')).toBe('700')
  })

  test('reports a bounded renderer fallback when a requested local font is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const pdf = createPdfStub()
    const svg = createSvgText({ family: 'Inter', weight: '500' })

    const result = await registerFontsWithJsPDF(pdf, svg, '')

    expect(result).toEqual({ requested: 1, registered: 0, fallback: 1 })
    expect(pdf.addFileToVFS).not.toHaveBeenCalled()
    expect(pdf.addFont).not.toHaveBeenCalled()
  })
})
