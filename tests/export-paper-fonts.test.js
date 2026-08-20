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

    await registerFontsWithJsPDF(pdf, svg, css)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/fonts/generated/Inter-400.ttf')
    expect(pdf.addFileToVFS).toHaveBeenCalledTimes(1)
    expect(pdf.addFont).toHaveBeenCalledWith(
      'Inter-400-normal.ttf',
      'Inter',
      'normal',
      400,
    )
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
})
