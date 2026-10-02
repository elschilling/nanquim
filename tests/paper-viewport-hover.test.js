// @vitest-environment jsdom

import { Matrix, Point, SVG } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PaperViewport } from '../src/js/PaperViewport.js'
import { SpatialIndex } from '../src/js/SpatialIndex.js'
import { Viewport } from '../src/js/Viewport.js'
import {
  createDeterministicEditorFixture,
  installClockHarness,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture, editor, viewport, clock, listeners, windowProperties, rootMatrices

function installSvgLengths(element, names) {
  names.forEach(name => Object.defineProperty(element.node, name, {
    configurable: true,
    get: () => ({ baseVal: { value: Number(element.attr(name)) } }),
  }))
}

function localToRootMatrix(element, root) {
  const matrices = []
  let current = element
  while (current && current.node !== root.node) {
    matrices.unshift(current.matrixify())
    current = current.parent()
  }
  return matrices.reduce((matrix, local) => matrix.multiply(local), new Matrix())
}

function installRenderedMatrix(element, root) {
  vi.spyOn(element, 'screenCTM').mockImplementation(() => (
    rootMatrices.get(root).multiply(localToRootMatrix(element, root))
  ))
}

function screenPoint(point, root) {
  return new Point(point).transform(rootMatrices.get(root))
}

async function move(point, root = editor.paperSvg) {
  const screen = screenPoint(point, root)
  root.node.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    clientX: screen.x,
    clientY: screen.y,
  }))
  await clock.advance(48)
}

function hoveredIds() {
  return editor.hoveredElements.map(element => element.id())
}

async function moveInside() {
  await move({ x: 35, y: 30 })
  expect(hoveredIds()).toEqual([viewport._group.id()])
  expect(viewport._group.hasClass('elementHover')).toBe(true)
}

beforeEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
  windowProperties = new Map(Object.getOwnPropertyNames(window).map(key => [key, Object.getOwnPropertyDescriptor(window, key)]))
  clock = installClockHarness()
  listeners = installDomListenerTracker()
  fixture = createDeterministicEditorFixture({ mode: 'paper' })
  editor = fixture.editor
  globalThis.SVG = Object.assign(node => SVG(node), { Point })
  rootMatrices = new Map([[editor.svg, new Matrix()], [editor.paperSvg, new Matrix()]])
  editor.isSnapping = false
  editor.gridSnap = false
  editor.ortho = false
  editor.paperConfig = { unitsPerCm: 1 }
  editor.paperAnnotations = editor.paperDrawing
  editor.paperAnnotations.attr('data-collection', 'true')
  editor.collections.get(editor.activeCollection.id()).visible = true
  editor.collections.set(editor.paperAnnotations.id(), {
    group: editor.paperAnnotations,
    visible: true,
    locked: false,
  })
  editor.paperViewportsGroup = editor.paperSvg.group().attr('id', 'paper-viewports')
  editor.spatialIndex = new SpatialIndex()

  for (const root of [editor.svg, editor.paperSvg]) {
    root.panZoom = () => root
    root.zoom = () => 1
    vi.spyOn(root, 'screenCTM').mockImplementation(() => rootMatrices.get(root))
    root.point.mockImplementation((x, y) => new Point(x, y).transform(rootMatrices.get(root).inverse()))
    Object.defineProperty(root.node, 'clientWidth', { configurable: true, value: 1000 })
    vi.spyOn(root.node, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 })
  }

  viewport = new PaperViewport(editor, editor.paperViewportsGroup, {
    id: 'hover-viewport',
    x: 20,
    y: 20,
    w: 30,
    h: 20,
    scale: 1,
  })
  editor.paperViewports = [viewport]
  for (const element of [viewport._group, viewport._contentGroup, viewport._frame, viewport._label, viewport._useEl]) {
    installRenderedMatrix(element, editor.paperSvg)
  }
  installSvgLengths(viewport._frame, ['x', 'y', 'width', 'height'])
  // Browsers report the referenced model bounds without applying the viewport
  // clip. The model extends beyond every edge of the visible viewport.
  vi.spyOn(viewport._useEl.node, 'getBBox').mockReturnValue({ x: -100, y: -100, width: 200, height: 200 })

  new Viewport(editor)
  editor.signals.editorModeChanged.dispatch('paper')
  editor.paperSvg.viewbox(0, 0, 100, 100)
})

afterEach(() => {
  editor.signals.commandCancelled.dispatch()
  listeners.dispose()
  fixture.dispose()
  clock.dispose()
  vi.restoreAllMocks()
  Object.getOwnPropertyNames(window).forEach(key => {
    const previous = windowProperties.get(key)
    if (!previous) delete window[key]
    else if (previous.configurable && Object.hasOwn(previous, 'value') && previous.value !== Object.getOwnPropertyDescriptor(window, key)?.value) {
      Object.defineProperty(window, key, previous)
    }
  })
  localStorage.clear()
  document.body.replaceChildren()
})

describe('Paper viewport pointer hover', () => {
  test.each([
    ['left', { x: 5, y: 30 }],
    ['right', { x: 65, y: 30 }],
    ['top', { x: 35, y: 5 }],
    ['bottom', { x: 35, y: 55 }],
  ])('clears viewport hover outside the %s clip edge despite oversized model bounds', async (_side, point) => {
    await moveInside()
    await move(point)
    expect(hoveredIds()).toEqual([])
    expect(viewport._group.hasClass('elementHover')).toBe(false)
    expect(viewport._useEl.hasClass('elementHover')).toBe(false)
  })

  test.each([
    ['left', { x: 19.9, y: 30 }],
    ['right', { x: 50.1, y: 30 }],
    ['top', { x: 35, y: 19.9 }],
    ['bottom', { x: 35, y: 40.1 }],
  ])('rejects the %s outsider even within ordinary hover tolerance', async (_side, point) => {
    await moveInside()
    await move(point)
    expect(hoveredIds()).toEqual([])
    expect(viewport._group.hasClass('elementHover')).toBe(false)
  })

  test('hovers empty viewport interior using the frame rectangle', async () => {
    vi.mocked(viewport._useEl.node.getBBox).mockReturnValue({ x: 0, y: 0, width: 0, height: 0 })
    editor.spatialIndex.markDirty()
    await moveInside()
  })

  test.each([
    ['left', { x: 20, y: 30 }],
    ['right', { x: 50, y: 30 }],
    ['top', { x: 35, y: 20 }],
    ['bottom', { x: 35, y: 40 }],
  ])('includes the exact %s frame boundary', async (_side, point) => {
    await move(point)
    expect(hoveredIds()).toEqual([viewport._group.id()])
    expect(viewport._group.hasClass('elementHover')).toBe(true)
  })

  test('keeps Paper annotations outside a viewport hoverable', async () => {
    const annotation = editor.paperAnnotations.line(2, 5, 12, 5).attr('id', 'outside-annotation')
    installRenderedMatrix(annotation, editor.paperSvg)
    installSvgLengths(annotation, ['x1', 'y1', 'x2', 'y2'])
    editor.spatialIndex.markDirty()
    await move({ x: 7, y: 5 })
    expect(hoveredIds()).toEqual([annotation.id()])
    expect(annotation.hasClass('elementHover')).toBe(true)
    expect(viewport._group.hasClass('elementHover')).toBe(false)
  })

  test('preserves ordinary Model block use hover', async () => {
    const block = editor.activeCollection.use('#model-block').attr('id', 'model-use')
    vi.spyOn(block.node, 'getBBox').mockReturnValue({ x: 0, y: 0, width: 100, height: 100 })
    installRenderedMatrix(block, editor.svg)
    editor.mode = 'model'
    editor.signals.editorModeChanged.dispatch('model')
    editor.svg.viewbox(0, 0, 100, 100)
    editor.spatialIndex.markDirty()
    await move({ x: 75, y: 75 }, editor.svg)
    expect(hoveredIds()).toEqual([block.id()])
    expect(block.hasClass('elementHover')).toBe(true)
  })

  test.each([
    ['zoom', { a: 10, b: 0, c: 0, d: 10, e: 200, f: -50 }],
    ['rotation and shear', { a: 8, b: 3, c: -2, d: 9, e: 140, f: -25 }],
  ])('tests the transformed rectangle under Paper viewBox offsets and %s', async (_kind, matrix) => {
    editor.paperSvg.viewbox(-20, 5, 100, 75)
    rootMatrices.set(editor.paperSvg, new Matrix(matrix))
    viewport._group.transform(new Matrix().translate(18, -7).rotate(30, 0, 0).scale(0.8, 1.3, 0, 0))
    editor.spatialIndex.markDirty()
    const frameToRoot = localToRootMatrix(viewport._frame, editor.paperSvg)
    await move(new Point(35, 30).transform(frameToRoot))
    expect(hoveredIds()).toEqual([viewport._group.id()])
    await move(new Point(19.9, 30).transform(frameToRoot))
    expect(hoveredIds()).toEqual([])
    expect(viewport._group.hasClass('elementHover')).toBe(false)
  })

  test.each([
    ['collapsed', { a: 0, b: 0, c: 0, d: 0, e: 35, f: 30 }],
    ['non-finite', { a: Infinity, b: 0, c: 0, d: 1, e: 0, f: 0 }],
  ])('fails closed for a %s frame coordinate matrix', async (_kind, matrix) => {
    vi.mocked(viewport._frame.screenCTM).mockReturnValue(matrix)
    await move({ x: 35, y: 30 })
    expect(hoveredIds()).toEqual([])
    expect(viewport._group.hasClass('elementHover')).toBe(false)
  })

  test.each(['hidden', 'locked'])('does not hover a %s viewport', async state => {
    await moveInside()
    if (state === 'hidden') viewport.setVisible(false)
    else viewport.setLocked(true)
    await move({ x: 36, y: 30 })
    expect(hoveredIds()).toEqual([])
    expect(viewport._group.hasClass('elementHover')).toBe(false)
  })
})
