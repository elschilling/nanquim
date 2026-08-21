// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import { findSelectableAncestor, getSelectableElements } from '../src/js/Collection.js'
import { PaperViewport } from '../src/js/PaperViewport.js'
import { SpatialIndex } from '../src/js/SpatialIndex.js'
import { applyColorMap, buildPaperSVGString } from '../src/js/utils/ExportPaper.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVGJS_NS = 'http://svgjs.com/svgjs'

function addSvgRoot() {
  const node = document.createElementNS(SVG_NS, 'svg')
  document.body.appendChild(node)
  return SVG(node)
}

function createFixture({ unitsPerCm = 1 } = {}) {
  const modelSvg = addSvgRoot()
  const drawing = modelSvg.group().attr('id', 'Collection')
  drawing.line(0, 0, 100, 60).stroke('#111111')

  const paperSvg = addSvgRoot()
  const background = paperSvg.group().attr('id', 'paper-background')
  background.rect(21 * unitsPerCm, 29.7 * unitsPerCm).fill('#ffffff')
  const viewportsGroup = paperSvg.group().attr('id', 'paper-viewports')
  paperSvg.group().attr('id', 'paper-handlers')

  const editor = {
    drawing,
    isDrawing: false,
    mode: 'paper',
    paperConfig: {
      colorMap: {},
      height: 297,
      size: 'A4',
      unitsPerCm,
      width: 210,
    },
    paperEditor: {
      getPaperDimsSVG: () => ({
        wSVG: 21 * unitsPerCm,
        hSVG: 29.7 * unitsPerCm,
      }),
    },
    paperSvg,
    paperViewports: [],
    paperViewportsGroup: viewportsGroup,
    selected: [],
    spatialIndex: { markDirty: vi.fn() },
    fullSpatialIndex: { markDirty: vi.fn() },
    signals: {
      updatedSelection: { dispatch: vi.fn() },
    },
    svg: modelSvg,
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

  test('keeps physical 1:N scale and origin math independent of SVG units per centimetre', () => {
    const { editor, viewport } = createFixture({ unitsPerCm: 2.5 })

    expect(matrixValues(viewport._useEl)).toEqual([0.025, 0, 0, 0.025, 13.25, 11.25])

    const output = buildPaperSVGString(editor, [viewport])
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    const root = parsed.documentElement
    const use = root.querySelector('[data-paper-viewport="true"] use')
    const matrixScale = Number(use.getAttribute('transform').match(/^matrix\(([^,]+)/)?.[1])
    const transformedLength = matrixScale * 100
    const viewBoxWidth = root.viewBox.baseVal.width
    const millimetresPerUserUnit = Number.parseFloat(root.getAttribute('width')) / viewBoxWidth

    expect(use.getAttribute('transform')).toBe('matrix(0.025,0,0,0.025,13.25,11.25)')
    expect(transformedLength * millimetresPerUserUnit).toBeCloseTo(10, 10)

    editor.paperSvg.screenCTM = () => ({ a: 1, d: 1 })
    viewport.activeForPanning = true
    viewport._frame.node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 1,
      clientX: 10,
      clientY: 10,
    }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 15 }))
    document.dispatchEvent(new MouseEvent('mouseup'))

    expect(viewport.modelOriginX).toBe(-850)
    expect(viewport.modelOriginY).toBe(-570)
  })

  test('preserves SVG.js data through namespace-safe Paper color mapping', () => {
    const { editor } = createFixture()
    const line = editor.drawing.findOne('line')
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) {
        const source = String(value).toLowerCase().replaceAll(' ', '')
        this._fillStyle = ({
          'rgb(17,17,17)': '#111111',
          'rgb(51,68,85)': '#334455',
        })[source] || source
      },
    }
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)
    line.node.setAttribute('svgjs:data', '{"arcData":{"p1":{"x":0,"y":0}}}')
    line.attr('stroke-width', 0.35)
    editor.drawing.rect(2, 2).attr({ id: 'reference-paint', fill: 'url(#paint-server)' })
    editor.paperConfig.colorMap = {
      'rgb(17, 17, 17)': { enabled: true, printColor: 'rgb(51, 68, 85)' },
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
    expect(exportedLine.getAttribute('stroke-width')).toBe('0.35')
    expect(root.querySelector('#reference-paint').getAttribute('fill')).toBe('url(#paint-server)')
  })

  test('maps class and inherited paints on detached drawing and block clones only', () => {
    const { editor } = createFixture()
    const colorContext = {
      _fillStyle: '#000000',
      get fillStyle() { return this._fillStyle },
      set fillStyle(value) {
        const source = String(value).toLowerCase().replaceAll(' ', '')
        this._fillStyle = ({
          'rgb(17,34,51)': '#112233',
          'rgb(51,68,85)': '#334455',
          'rgb(68,85,102)': '#445566',
          'rgb(102,119,136)': '#667788',
        })[source] || source
      },
    }
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(colorContext)

    const defs = editor.svg.defs().node
    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent = [
      '.paper-inherited-paint { stroke: rgb(17, 34, 51); fill: none; }',
      '.paper-block-paint { stroke: rgb(68, 85, 102); fill: none; }',
    ].join('\n')
    defs.appendChild(style)
    const browserStyle = document.createElement('style')
    browserStyle.textContent = style.textContent
    document.body.appendChild(browserStyle)
    const inheritedGroup = editor.drawing.group().addClass('paper-inherited-paint')
    inheritedGroup.line(2, 3, 7, 3).attr('id', 'class-inherited-line')
    const block = document.createElementNS(SVG_NS, 'symbol')
    block.setAttribute('id', 'class-painted-block')
    block.setAttribute('data-block-def', 'true')
    const blockLine = document.createElementNS(SVG_NS, 'line')
    blockLine.setAttribute('id', 'class-painted-block-line')
    blockLine.setAttribute('class', 'paper-block-paint')
    blockLine.setAttribute('x2', '10')
    block.appendChild(blockLine)
    defs.appendChild(block)
    editor.drawing.use('#class-painted-block').attr('id', 'class-painted-block-use')
    editor.paperConfig.colorMap = {
      '#112233': { enabled: true, printColor: '#334455' },
      '#445566': { enabled: true, printColor: '#667788' },
    }
    const beforeModel = editor.svg.node.outerHTML
    const beforePaper = editor.paperSvg.node.outerHTML

    const output = buildPaperSVGString(editor, editor.paperViewports)
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    const exportedGroup = parsed.querySelector('defs #Collection .paper-inherited-paint')
    const exportedLine = parsed.querySelector('defs #Collection #class-inherited-line')
    const exportedBlockLine = parsed.querySelector('defs #class-painted-block-line')

    expect(exportedGroup.style.stroke.replaceAll(' ', '')).toBe('rgb(51,68,85)')
    expect(exportedLine.style.stroke.replaceAll(' ', '')).toBe('rgb(51,68,85)')
    expect(exportedBlockLine.style.stroke.replaceAll(' ', '')).toBe('rgb(102,119,136)')
    expect(parsed.querySelector('style').textContent).toContain('rgb(17, 34, 51)')
    expect(editor.svg.node.outerHTML).toBe(beforeModel)
    expect(editor.paperSvg.node.outerHTML).toBe(beforePaper)
  })

  test('remaps Paper-generated IDs that collide with model IDs without touching live roots', () => {
    const { editor } = createFixture()
    editor.drawing.findOne('line').attr('id', 'vp-test-clip')
    const beforeModel = editor.svg.node.outerHTML
    const beforePaper = editor.paperSvg.node.outerHTML

    const output = buildPaperSVGString(editor, editor.paperViewports)
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    const ids = Array.from(parsed.querySelectorAll('[id]'), element => element.id)
    const viewportContent = parsed.querySelector('[data-paper-viewport="true"] > g')
    const clipId = viewportContent.getAttribute('clip-path').match(/^url\(#(.+)\)$/)?.[1]

    expect(new Set(ids).size).toBe(ids.length)
    expect(parsed.querySelector('#vp-test-clip')?.localName).toBe('line')
    expect(clipId).not.toBe('vp-test-clip')
    expect(parsed.getElementById(clipId)?.localName).toBe('clipPath')
    const viewportUse = viewportContent.querySelector('use')
    expect(viewportUse.getAttribute('href') || viewportUse.getAttribute('xlink:href')).toBe('#Collection')
    expect(editor.svg.node.outerHTML).toBe(beforeModel)
    expect(editor.paperSvg.node.outerHTML).toBe(beforePaper)
  })

  test('exports required model definitions and preserves references and stroke widths', () => {
    const { editor } = createFixture()
    const defs = editor.svg.defs().node
    const makeDefinition = (name, id) => {
      const element = document.createElementNS(SVG_NS, name)
      element.setAttribute('id', id)
      defs.appendChild(element)
      return element
    }
    const baseGradient = makeDefinition('linearGradient', 'paper-base-gradient')
    const stop = document.createElementNS(SVG_NS, 'stop')
    stop.setAttribute('offset', '0')
    stop.setAttribute('stop-color', '#111111')
    baseGradient.appendChild(stop)
    const gradient = makeDefinition('linearGradient', 'paper-gradient')
    gradient.setAttribute('href', '#paper-base-gradient')
    const marker = makeDefinition('marker', 'paper-marker')
    const markerPath = document.createElementNS(SVG_NS, 'path')
    markerPath.setAttribute('d', 'M0 0L2 1L0 2Z')
    marker.appendChild(markerPath)
    makeDefinition('linearGradient', 'paper-unused-gradient')

    const line = editor.drawing.findOne('line')
    line.attr({
      'marker-end': 'url(#paper-marker)',
      stroke: '#111111',
      'stroke-width': 0.35,
    })
    editor.drawing.rect(4, 3).attr({ fill: 'url(#paper-gradient)', id: 'gradient-rect' })
    editor.paperSvg.findOne('#paper-handlers').line(0, 0, 1, 1).addClass('selection-handler')
    const beforeModel = editor.svg.node.outerHTML
    const beforePaper = editor.paperSvg.node.outerHTML

    const output = buildPaperSVGString(editor, editor.paperViewports)
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml')
    const exportedLine = parsed.querySelector('defs #Collection line')
    const exportedRect = parsed.querySelector('defs #Collection #gradient-rect')

    expect(parsed.querySelector('#paper-gradient')?.getAttribute('href')).toBe('#paper-base-gradient')
    expect(parsed.querySelector('#paper-base-gradient stop')).not.toBeNull()
    expect(parsed.querySelector('#paper-marker path')).not.toBeNull()
    expect(parsed.querySelector('#paper-unused-gradient')).toBeNull()
    expect(exportedLine.getAttribute('marker-end')).toBe('url(#paper-marker)')
    expect(exportedLine.getAttribute('stroke-width')).toBe('0.35')
    expect(exportedRect.getAttribute('fill')).toBe('url(#paper-gradient)')
    expect(parsed.querySelector('#paper-handlers')).toBeNull()
    expect(parsed.querySelector('.selection-handler')).toBeNull()
    expect(editor.svg.node.outerHTML).toBe(beforeModel)
    expect(editor.paperSvg.node.outerHTML).toBe(beforePaper)
  })

  test('does not mutate live SVG roots when detached color mapping fails', () => {
    const { editor } = createFixture()
    editor.paperConfig.colorMap = {
      '#111111': { enabled: true, printColor: '#334455' },
    }
    const beforeModel = editor.svg.node.outerHTML
    const beforePaper = editor.paperSvg.node.outerHTML
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    expect(() => buildPaperSVGString(editor, editor.paperViewports))
      .toThrow('Paper color mapping requires browser color parsing support.')
    expect(editor.svg.node.outerHTML).toBe(beforeModel)
    expect(editor.paperSvg.node.outerHTML).toBe(beforePaper)
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

    expect(viewport.setScale(0)).toBe(false)
    expect(viewport.setScale(Number.POSITIVE_INFINITY)).toBe(false)
    expect(viewport.setModelOrigin(Number.NaN, 0)).toBe(false)
    expect(viewport.setModelOrigin(0, 1000000001)).toBe(false)
    expect(viewport).toMatchObject({
      scale: 50,
      modelOriginX: -350,
      modelOriginY: -270,
    })

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

  test('invalidates both spatial indexes only after successful direct viewport changes', () => {
    const { editor, viewport } = createFixture()
    const expectInvalidations = (count) => {
      expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(count)
      expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(count)
    }

    expect(viewport.setGeometry({ x: 3, y: 4, w: 9, h: 7 })).toBe(true)
    expectInvalidations(1)
    expect(viewport.setModelOrigin(-300, -200)).toBe(true)
    expectInvalidations(2)
    expect(viewport.setScale(50)).toBe(true)
    expectInvalidations(3)
    expect(viewport.setVisible(false)).toBe(true)
    expectInvalidations(4)
    expect(viewport.setLocked(true)).toBe(true)
    expectInvalidations(5)

    expect(viewport.setGeometry({ x: 3, y: 4, w: 9, h: 7 })).toBe(false)
    expect(viewport.setGeometry({ w: 0 })).toBe(false)
    expect(viewport.setModelOrigin(-300, -200)).toBe(false)
    expect(viewport.setModelOrigin(Number.POSITIVE_INFINITY, 0)).toBe(false)
    expect(viewport.setScale(50)).toBe(false)
    expect(viewport.setScale(0)).toBe(false)
    expect(viewport.setVisible(false)).toBe(false)
    expect(viewport.setLocked(true)).toBe(false)
    expectInvalidations(5)
  })

  test('rebuilds a previously fresh Paper index after visibility and lock toggles', () => {
    const { editor, viewport } = createFixture()
    const index = new SpatialIndex()
    editor.spatialIndex = index
    editor.fullSpatialIndex = { markDirty: vi.fn() }

    index.ensureFresh(editor)
    expect(index._dirty).toBe(false)
    expect(getSelectableElements(editor)).toContain(viewport._useEl)

    expect(viewport.setVisible(false)).toBe(true)
    expect(index._dirty).toBe(true)
    index.ensureFresh(editor)
    expect(index._dirty).toBe(false)
    expect(index.tree.all()).toHaveLength(0)

    expect(viewport.setVisible(true)).toBe(true)
    expect(viewport.setLocked(true)).toBe(true)
    index.ensureFresh(editor)
    expect(index.tree.all()).toHaveLength(0)

    expect(viewport.setLocked(false)).toBe(true)
    index.ensureFresh(editor)
    expect(index.tree.all().some(item => item.element === viewport._useEl)).toBe(true)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(4)
  })
})
