// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { findSelectableAncestor } from '../src/js/Collection.js'
import { PaperViewport } from '../src/js/PaperViewport.js'
import { applyColorMap, buildPaperSVGString } from '../src/js/utils/ExportPaper.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVGJS_NS = 'http://svgjs.com/svgjs'

function addSvgRoot() {
  const node = document.createElementNS(SVG_NS, 'svg')
  document.body.appendChild(node)
  return SVG(node)
}

function createFixture() {
  const modelSvg = addSvgRoot()
  const drawing = modelSvg.group().attr('id', 'Collection')
  drawing.line(0, 0, 100, 60).stroke('#111111')

  const paperSvg = addSvgRoot()
  const background = paperSvg.group().attr('id', 'paper-background')
  background.rect(21, 29.7).fill('#ffffff')
  const viewportsGroup = paperSvg.group().attr('id', 'paper-viewports')

  const editor = {
    drawing,
    isDrawing: false,
    mode: 'paper',
    paperConfig: {
      colorMap: {},
      height: 297,
      size: 'A4',
      unitsPerCm: 1,
      width: 210,
    },
    paperEditor: {
      getPaperDimsSVG: () => ({ wSVG: 21, hSVG: 29.7 }),
    },
    paperSvg,
    paperViewports: [],
    selected: [],
    signals: {
      updatedSelection: { dispatch: vi.fn() },
    },
  }

  // A 100 x 60 model bbox centered inside a 10 x 8 viewport at 1:100.
  const viewport = new PaperViewport(editor, viewportsGroup, {
    id: 'vp-test',
    x: 2,
    y: 2,
    w: 10,
    h: 8,
    scale: 100,
    modelOriginX: -450,
    modelOriginY: -370,
  })
  editor.paperViewports = [viewport]

  return { editor, viewport }
}

function matrixValues(element) {
  const matrix = element.matrixify()
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
}

function transformPoint(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

describe('Paper viewport transforms', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
    window.SVGElement.prototype.getBBox = function () {
      if (this.localName === 'use') {
        return { x: 0, y: 0, width: 100, height: 60 }
      }
      return { x: 0, y: 0, width: 0, height: 0 }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete window.SVGElement.prototype.getBBox
    document.body.replaceChildren()
  })

  test('scales model geometry about the SVG origin into the viewport clip', () => {
    const { viewport } = createFixture()

    expect(viewport._useEl.node.getBBox()).toEqual({ x: 0, y: 0, width: 100, height: 60 })
    expect(matrixValues(viewport._useEl)).toEqual([0.01, 0, 0, 0.01, 6.5, 5.7])

    const matrix = viewport._useEl.matrixify()
    const first = transformPoint(matrix, { x: 0, y: 0 })
    const opposite = transformPoint(matrix, { x: 100, y: 60 })

    expect(first.x).toBeGreaterThanOrEqual(viewport.x)
    expect(first.y).toBeGreaterThanOrEqual(viewport.y)
    expect(opposite.x).toBeLessThanOrEqual(viewport.x + viewport.w)
    expect(opposite.y).toBeLessThanOrEqual(viewport.y + viewport.h)
  })

  test('serializes the same origin-based matrix into standalone Paper SVG', () => {
    const { editor, viewport } = createFixture()

    const output = buildPaperSVGString(editor, [viewport])
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    const root = parsed.documentElement
    const use = root.querySelector('[data-paper-viewport="true"] use')

    expect(root.getAttribute('data-nanquim-paper')).toBe('true')
    expect(root.querySelector('defs #Collection line')).not.toBeNull()
    expect(use.getAttribute('transform')).toBe('matrix(0.01,0,0,0.01,6.5,5.7)')
    expect(use.getAttribute('href') || use.getAttribute('xlink:href')).toBe('#Collection')
  })

  test('preserves SVG.js data through namespace-safe Paper color mapping', () => {
    const { editor } = createFixture()
    const line = editor.drawing.findOne('line')
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '' })
    line.node.setAttribute('svgjs:data', '{"arcData":{"p1":{"x":0,"y":0}}}')
    editor.paperConfig.colorMap = {
      '#111111': { enabled: true, printColor: '#334455' },
    }

    const output = buildPaperSVGString(editor, editor.paperViewports)
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    const root = parsed.documentElement
    const exportedLine = root.querySelector('defs #Collection line')

    expect(root.localName).toBe('svg')
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(root.lookupNamespaceURI('svgjs')).toBe(SVGJS_NS)
    expect(exportedLine.getAttributeNS(SVGJS_NS, 'data')).toBe('{"arcData":{"p1":{"x":0,"y":0}}}')
    expect(exportedLine.getAttribute('stroke')).toBe('#334455')
  })

  test('rejects malformed Paper fragments before touching parser error nodes', () => {
    expect(() => applyColorMap(
      '<g foreign:payload="value"/>',
      { '#111111': { enabled: true, printColor: '#334455' } },
    )).toThrow('Paper SVG content could not be parsed for color mapping.')
  })

  test('keeps selection interaction and transform refresh behavior intact', () => {
    const { editor, viewport } = createFixture()

    expect(viewport._group._paperVp).toBe(viewport)
    expect(viewport._group.attr('data-locked')).toBeUndefined()
    expect(viewport._group.attr('data-hidden')).toBeUndefined()
    expect(findSelectableAncestor(viewport._useEl)).toBe(viewport._group)

    viewport._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))

    expect(editor.selected).toHaveLength(1)
    expect(editor.selected[0]._paperVp).toBe(viewport)
    expect(editor.signals.updatedSelection.dispatch).toHaveBeenCalledOnce()

    viewport.setModelOrigin(-350, -270)
    expect(matrixValues(viewport._useEl)).toEqual([0.01, 0, 0, 0.01, 5.5, 4.7])

    viewport.setScale(50)
    expect(matrixValues(viewport._useEl)).toEqual([0.02, 0, 0, 0.02, 9, 7.4])

    viewport.setLocked(true)
    viewport.setVisible(false)
    expect(viewport._group.attr('data-locked')).toBe('true')
    expect(viewport._group.attr('data-hidden')).toBe('true')

    editor.selected = []
    viewport._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
    }))
    expect(editor.selected).toEqual([])

    viewport.setLocked(false)
    viewport.setVisible(true)
    expect(viewport._group.attr('data-locked')).toBeUndefined()
    expect(viewport._group.attr('data-hidden')).toBeUndefined()
  })
})
