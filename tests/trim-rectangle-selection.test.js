// @vitest-environment jsdom

import { Matrix, Point, SVG } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Viewport } from '../src/js/Viewport.js'
import { Terminal } from '../src/js/Terminal.js'
import { TrimCommand } from '../src/js/commands/TrimCommand.js'
import {
  createDeterministicEditorFixture,
  installClockHarness,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture, editor, boundary, crossingBoundary, target, command, clock, listeners, windowProperties, trackedElements

beforeEach(() => {
  document.body.replaceChildren()
  windowProperties = new Map(Object.getOwnPropertyNames(window).map(key => [key, Object.getOwnPropertyDescriptor(window, key)]))
  clock = installClockHarness()
  listeners = installDomListenerTracker()
  fixture = createDeterministicEditorFixture()
  editor = fixture.editor
  globalThis.SVG = Object.assign(node => SVG(node), { Point })
  editor.isSnapping = false
  editor.gridSnap = false
  editor.ortho = false
  for (const svg of [editor.svg, editor.paperSvg]) {
    svg.panZoom = () => svg
    svg.zoom = () => 1
    vi.spyOn(svg, 'screenCTM').mockReturnValue(new Matrix())
    Object.defineProperty(svg.node, 'clientWidth', { configurable: true, value: 1000 })
    vi.spyOn(svg.node, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 })
  }
  vi.spyOn(editor.activeCollection, 'screenCTM').mockReturnValue(new Matrix())
  trackedElements = []
  boundary = addLine('trim-boundary', 40, 20, 40, 100)
  crossingBoundary = addLine('trim-crossing-boundary', 70, -20, 70, 140)
  target = addLine('trim-target', 0, 80, 100, 80)
  editor.spatialIndex.ensureFresh = vi.fn()
  editor.spatialIndex.search = vi.fn(() => trackedElements.filter(element => element.node.isConnected).map(element => {
    const points = element.array().map(point => new Point(point).transform(element.matrix()))
    return {
      element,
      minX: Math.min(...points.map(point => point.x)),
      minY: Math.min(...points.map(point => point.y)),
      maxX: Math.max(...points.map(point => point.x)),
      maxY: Math.max(...points.map(point => point.y)),
    }
  }))
  new Viewport(editor)
  new Terminal(editor)
  editor.svg.viewbox(0, 0, 1000, 1000)
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
  document.body.replaceChildren()
})

function addLine(id, x1, y1, x2, y2) {
  const element = editor.activeCollection.line(x1, y1, x2, y2).attr('id', id)
  vi.spyOn(element, 'screenCTM').mockImplementation(() => element.matrix())
  installSvgLengths(element, ['x1', 'y1', 'x2', 'y2'])
  trackedElements.push(element)
  return element
}

function installSvgLengths(element, names) {
  names.forEach(name => Object.defineProperty(element.node, name, {
    configurable: true,
    get: () => ({ baseVal: { value: Number(element.attr(name)) } }),
  }))
}

function startTrim() {
  command = new TrimCommand(editor)
  command.execute()
}

function keydown(key) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
}

async function move(x, y) {
  editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
  await clock.advance(32)
}

function click(x, y) {
  editor.svg.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }))
}

async function startBox(x, y) {
  await move(x, y)
  click(x, y)
  const box = editor.svg.findOne('.selectionRectangle')
  expect(box, 'TRIM should allow a selection rectangle to start in empty space').not.toBeNull()
  installSvgLengths(box, ['x', 'y', 'width', 'height'])
  expect(editor.isDrawing).toBe(true)
  expect(editor.isSelecting).toBe(true)
  return box
}

async function selectBox(x1, y1, x2, y2) {
  const box = await startBox(x1, y1)
  await move(x2, y2)
  box.attr({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  })
  box.fire('drawupdate', { event: new MouseEvent('mousemove', { clientX: x2, clientY: y2 }) })
  // The browser draw plugin releases its handler before notifying drawstop.
  box.forget('_paintHandler')
  box.fire('drawstop')
  expect(editor.isDrawing).toBe(false)
  expect(editor.isSelecting).toBe(false)
  return box
}

function expectCleanSelection() {
  expect(editor.svg.find('.selectionRectangle')).toHaveLength(0)
  expect(editor.isDrawing).toBe(false)
  expect(editor.isSelecting).toBe(false)
  trackedElements.forEach(element => expect(element.hasClass('elementSelected')).toBe(false))
}

describe('TRIM boundary rectangle selection', () => {
  test.each([
    ['window', [20, 10, 80, 110], ['trim-boundary']],
    ['crossing', [80, 30, 20, 60], ['trim-boundary', 'trim-crossing-boundary']],
  ])('collects %s boundaries through the viewport without trimming geometry', async (_mode, points, expected) => {
    startTrim()
    await selectBox(...points)
    expect(command.boundaryElements.map(element => element.id())).toEqual(expected)
    command.boundaryElements.forEach(element => expect(element.hasClass('elementSelected')).toBe(true))
    expect(command.isTrimming).toBe(false)
    expect(editor.selected).toEqual([])
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(target.array().flat()).toEqual([0, 80, 100, 80])
  })

  test('adds overlapping rectangles without toggling existing boundaries and permits individual deselection', async () => {
    startTrim()
    await selectBox(20, 10, 80, 110)
    await selectBox(80, 30, 20, 60)
    await selectBox(80, 30, 20, 60)
    expect(command.boundaryElements).toEqual([boundary, crossingBoundary])
    expect(boundary.hasClass('elementSelected')).toBe(true)
    expect(crossingBoundary.hasClass('elementSelected')).toBe(true)

    await move(40, 45)
    click(40, 45)
    expect(command.boundaryElements).toEqual([crossingBoundary])
    expect(boundary.hasClass('elementSelected')).toBe(false)
    click(40, 45)
    expect(command.boundaryElements).toEqual([crossingBoundary, boundary])
    expect(boundary.hasClass('elementSelected')).toBe(true)
  })

  test('uses the clicked first corner to choose crossing selection before the pointer frame runs', async () => {
    startTrim()
    await move(0, 10)
    editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 80, clientY: 30 }))
    click(80, 30)
    const box = editor.svg.findOne('.selectionRectangle')
    expect(box).not.toBeNull()
    installSvgLengths(box, ['x', 'y', 'width', 'height'])

    await move(20, 60)
    box.attr({ x: 20, y: 30, width: 60, height: 30 })
    box.fire('drawupdate', { event: new MouseEvent('mousemove', { clientX: 20, clientY: 60 }) })
    expect(box.hasClass('selectionRectangleRight')).toBe(true)
    box.forget('_paintHandler')
    box.fire('drawstop')

    expect(command.boundaryElements).toEqual([boundary, crossingBoundary])
    expect(editor.history.undos).toHaveLength(0)
  })

  test('uses the current drawing event to choose crossing selection before the pointer frame runs', async () => {
    startTrim()
    const box = await startBox(80, 30)
    editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 60 }))
    box.attr({ x: 20, y: 30, width: 60, height: 30 })
    box.fire('drawupdate', { event: new MouseEvent('mousemove', { clientX: 20, clientY: 60 }) })
    expect(box.hasClass('selectionRectangleRight')).toBe(true)
    box.forget('_paintHandler')
    box.fire('drawstop')

    expect(command.boundaryElements).toEqual([boundary, crossingBoundary])
    expect(editor.history.undos).toHaveLength(0)
  })

  test('confirms a rectangle boundary, clears its highlight, and trims with Undo/Redo', async () => {
    startTrim()
    await selectBox(20, 10, 80, 110)
    keydown('Enter')
    expect(command.isTrimming).toBe(true)
    expect(command.autoTrimMode).toBe(false)
    expect(command.boundaryElements).toEqual([boundary])
    expectCleanSelection()

    await move(95, 80)
    click(95, 80)
    expect(target.array().flat()).toEqual([0, 80, 40, 80])
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.undos[0].type).toBe('TrimLineCommand')
    editor.history.undo()
    expect(target.array().flat()).toEqual([0, 80, 100, 80])
    editor.history.redo()
    expect(target.array().flat()).toEqual([0, 80, 40, 80])
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
  })

  test('rejects transformed boundaries inside a rectangle while retaining safe boundaries', async () => {
    const transformed = addLine('trim-transformed-boundary', 50, 20, 50, 100).translate(5, 0)
    startTrim()
    await selectBox(20, 10, 80, 110)
    expect(command.boundaryElements).toEqual([boundary])
    expect(transformed.hasClass('elementSelected')).toBe(false)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'TRIM does not support transformed targets or boundaries.',
    })
    expect(editor.history.undos).toHaveLength(0)
  })

  test('keeps immediate Enter as Auto-Trim when no boundary is selected', () => {
    startTrim()
    keydown('Enter')
    expect(command.isTrimming).toBe(true)
    expect(command.autoTrimMode).toBe(true)
    expect(command.boundaryElements).toEqual([])
    expect(editor.selectSingleElement).toBe(false)
    expectCleanSelection()
  })

  test('uses safe preselected boundaries immediately and filters transformed preselection', () => {
    const transformed = addLine('trim-transformed-preselection', 50, 20, 50, 100).translate(5, 0)
    editor.selected = [boundary, transformed]
    boundary.addClass('elementSelected')
    transformed.addClass('elementSelected')
    startTrim()
    expect(command.isTrimming).toBe(true)
    expect(command.autoTrimMode).toBe(false)
    expect(command.boundaryElements).toEqual([boundary])
    expect(editor.selected).toEqual([])
    expectCleanSelection()
    expect(editor.history.undos).toHaveLength(0)
  })

  test.each(['Escape', 'right click', 'command cancellation'])('cancels an active box and boundary highlights through %s', async method => {
    startTrim()
    await selectBox(20, 10, 80, 110)
    const box = await startBox(80, 30)
    const draw = vi.spyOn(box, 'draw')
    if (method === 'Escape') {
      keydown('Escape')
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }))
    } else if (method === 'right click') {
      editor.svg.node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    } else {
      editor.signals.commandCancelled.dispatch()
    }
    await clock.advance(20)
    expect(draw).toHaveBeenCalledWith('cancel')
    expectCleanSelection()
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.suppressPolarTracking).toBe(false)
    expect(command.boundaryElements).toEqual([])
    expect(editor.signals.toogledSelect.getNumListeners()).toBe(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.svg.find('.ghostLine')).toHaveLength(0)
    expect(target.array().flat()).toEqual([0, 80, 100, 80])
  })

  test('confirms collected boundaries while cancelling an unfinished second rectangle', async () => {
    startTrim()
    await selectBox(20, 10, 80, 110)
    const box = await startBox(80, 30)
    const draw = vi.spyOn(box, 'draw')
    keydown('Enter')
    expect(draw).toHaveBeenCalledWith('cancel')
    expectCleanSelection()
    expect(command.isTrimming).toBe(true)
    expect(command.autoTrimMode).toBe(false)
    expect(command.boundaryElements).toEqual([boundary])
    await move(95, 80)
    click(95, 80)
    expect(target.array().flat()).toEqual([0, 80, 40, 80])
  })
})
