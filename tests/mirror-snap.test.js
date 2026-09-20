// @vitest-environment jsdom

import { Matrix, Point } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Viewport } from '../src/js/Viewport.js'
import { Terminal } from '../src/js/Terminal.js'
import { MirrorCommand } from '../src/js/commands/MirrorCommand.js'
import {
  createDeterministicEditorFixture,
  installClockHarness,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture, editor, source, target, command, clock, listeners, windowProperties, coordinateListeners

beforeEach(() => {
  document.body.replaceChildren()
  windowProperties = new Map(Object.getOwnPropertyNames(window).map(key => [key, Object.getOwnPropertyDescriptor(window, key)]))
  clock = installClockHarness()
  listeners = installDomListenerTracker()
  fixture = createDeterministicEditorFixture()
  editor = fixture.editor
  globalThis.SVG = { Point }
  editor.isSnapping = true
  editor.snapTypes = { endpoint: true }
  editor.ortho = false
  for (const svg of [editor.svg, editor.paperSvg]) {
    svg.panZoom = () => svg
    svg.zoom = () => 1
    vi.spyOn(svg, 'screenCTM').mockReturnValue(new Matrix())
    Object.defineProperty(svg.node, 'clientWidth', { configurable: true, value: 1000 })
    vi.spyOn(svg.node, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 })
  }
  vi.spyOn(editor.activeCollection, 'screenCTM').mockReturnValue(new Matrix())
  source = editor.activeCollection.line(0, 0, 100, 0).attr('id', 'mirror-source')
  target = editor.activeCollection.line(200, 150, 300, 150).attr('id', 'mirror-target')
  for (const element of [source, target]) {
    vi.spyOn(element, 'screenCTM').mockImplementation(() => element.matrix())
    for (const name of ['x1', 'y1', 'x2', 'y2']) {
      Object.defineProperty(element.node, name, {
        configurable: true,
        get: () => ({ baseVal: { value: Number(element.attr(name)) } }),
      })
    }
  }
  editor.spatialIndex.ensureFresh = vi.fn()
  editor.spatialIndex.search = vi.fn(() => [source, target].map(element => ({ element })))
  editor.selected = [source]
  new Viewport(editor)
  new Terminal(editor)
  const snapButton = document.createElement('button')
  snapButton.id = 'object-snap-toggle'
  snapButton.addEventListener('click', () => window.handleToogleSnap())
  document.body.appendChild(snapButton)
  editor.svg.viewbox(0, 0, 1000, 1000)
  coordinateListeners = editor.signals.updatedCoordinates.getNumListeners()
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

function startMirror() {
  command = new MirrorCommand(editor)
  command.execute()
}

function keydown(key) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
}

async function move(x, y) {
  editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
  await clock.advanceFrame()
}

function click(x, y) {
  editor.svg.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }))
}

function expectPoints(element, expected) {
  const actual = element.array()
  expect(actual).toHaveLength(expected.length)
  expected.forEach(([x, y], index) => {
    expect(actual[index][0]).toBeCloseTo(x, 8)
    expect(actual[index][1]).toBeCloseTo(y, 8)
  })
}

function expectCleanup() {
  expect(editor.isInteracting).toBe(false)
  expect(editor.selectSingleElement).toBe(false)
  expect(editor.suppressHandlers).toBe(false)
  expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
  expect(editor.signals.inputValue.getNumListeners()).toBe(0)
  expect(editor.signals.updatedCoordinates.getNumListeners()).toBe(coordinateListeners)
  expect(editor.svg.node.querySelector('.mirror-axis-helper')).toBeNull()
  expect(editor.drawing.find('[data-nanquim-transient="true"]')).toHaveLength(0)
  expectPoints(source, [[0, 0], [100, 0]])
}

describe('MIRROR viewport snapping', () => {
  test.each([true, false])('captures axis points without selecting nearby geometry with snapping %s', async snapping => {
    editor.isSnapping = snapping
    startMirror()
    await move(205, 154)
    await clock.advanceFrame()
    expect(editor.hoveredElements).toContain(target)
    click(205, 154)
    expect(command.basePoint).toEqual(snapping ? { x: 200, y: 150 } : { x: 205, y: 154 })
    expect(editor.signals.toogledSelect.dispatch).not.toHaveBeenCalled()

    await move(3, 4)
    await clock.advanceFrame()
    expect(editor.hoveredElements).toContain(source)
    click(3, 4)
    expect(command.secondPoint).toEqual(snapping ? { x: 0, y: 0 } : { x: 3, y: 4 })
    expect(editor.signals.toogledSelect.dispatch).not.toHaveBeenCalled()
    expect(editor.selected).toEqual([source])
    expect(editor.suppressHandlers).toBe(true)

    editor.signals.inputValue.dispatch('n')
    await clock.advance(20)
    await move(205, 154)
    await clock.advanceFrame()
    click(205, 154)
    expect(editor.signals.toogledSelect.dispatch).toHaveBeenCalledWith(target)
  })

  test('does not select the nearby target when its second point cancels a zero-length axis', async () => {
    startMirror()
    await move(205, 154)
    await clock.advanceFrame()
    expect(editor.hoveredElements).toContain(target)
    click(205, 154)
    editor.signals.toogledSelect.dispatch.mockClear()
    click(205, 154)
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.toogledSelect.dispatch).not.toHaveBeenCalled()
    expect(editor.selected).toEqual([source])
    expect(editor.history.undos).toHaveLength(0)
  })

  test('uses preselection immediately and commits the snapped preview with Undo/Redo', async () => {
    startMirror()
    expect(editor.isInteracting).toBe(true)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    await move(3, 4)
    expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    click(3, 4)
    expect(command.basePoint).toEqual({ x: 0, y: 0 })

    await move(205, 154)
    expect(editor.snapPoint).toEqual({ x: 200, y: 150 })
    expectPoints(command.ghostLine, [[0, 0], [200, 150]])
    const reflected = command.copiedElements[0]
    expectPoints(reflected, [[0, 0], [28, 96]])
    expectPoints(source, [[0, 0], [100, 0]])
    click(205, 154)
    expect(command.secondPoint).toEqual({ x: 200, y: 150 })
    expect(editor.signals.updatedCoordinates.getNumListeners()).toBe(coordinateListeners)
    await move(300, 150)
    expectPoints(reflected, [[0, 0], [28, 96]])
    editor.signals.inputValue.dispatch('n')
    await clock.advance(20)

    expect(editor.history.undos).toHaveLength(1)
    expectCleanup()
    expect(source.node.isConnected).toBe(true)
    expect(reflected.parent().node).toBe(source.parent().node)
    expectPoints(reflected, [[0, 0], [28, 96]])
    editor.history.undo()
    expect(reflected.node.isConnected).toBe(false)
    expectPoints(source, [[0, 0], [100, 0]])
    editor.history.redo()
    expect(reflected.node.isConnected).toBe(true)
    expectPoints(reflected, [[0, 0], [28, 96]])
  })

  test.each(['F9', 'toolbar'])('refreshes both axis points when SNAP is toggled with %s without moving', async method => {
    const toggle = async () => {
      if (method === 'F9') {
        keydown('F9')
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'F9', code: 'F9', bubbles: true }))
      } else {
        document.getElementById('object-snap-toggle').click()
      }
      await clock.advanceFrame()
    }
    editor.isSnapping = false
    startMirror()
    await move(3, 4)
    expect(editor.snapPoint).toBeNull()
    await toggle()
    expect(editor.isSnapping).toBe(true)
    expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    expect(editor.snap.children().length).toBeGreaterThan(0)
    click(3, 4)
    expect(command.basePoint).toEqual({ x: 0, y: 0 })

    await toggle()
    await move(205, 154)
    expect(editor.snapPoint).toBeNull()
    expectPoints(command.ghostLine, [[0, 0], [205, 154]])
    await toggle()
    expect(editor.snapPoint).toEqual({ x: 200, y: 150 })
    expectPoints(command.ghostLine, [[0, 0], [200, 150]])
    expectPoints(command.copiedElements[0], [[0, 0], [28, 96]])
    await toggle()
    expect(editor.snapPoint).toBeNull()
    expect(editor.snap.children()).toHaveLength(0)
    expectPoints(command.ghostLine, [[0, 0], [205, 154]])
    await toggle()
    click(205, 154)
    expect(command.secondPoint).toEqual({ x: 200, y: 150 })
    expectPoints(command.copiedElements[0], [[0, 0], [28, 96]])
  })

  test('waits for a selection and updates the preview after a single snapped pointer move', async () => {
    editor.selected = []
    startMirror()
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span', msg: 'Select elements to mirror and press Enter to confirm.',
    })
    editor.selected = [source]
    keydown('Enter')
    expect(editor.isInteracting).toBe(true)
    await move(3, 4)
    expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    click(3, 4)
    await move(205, 154)
    expect(editor.snapPoint).toEqual({ x: 200, y: 150 })
    expectPoints(command.ghostLine, [[0, 0], [200, 150]])
    expectPoints(command.copiedElements[0], [[0, 0], [28, 96]])
  })

  test.each(['first point', 'preview', 'source prompt'])('cleans up when cancelled during the %s phase', async phase => {
    startMirror()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    if (phase !== 'first point') {
      await move(3, 4)
      click(3, 4)
      await move(205, 154)
      expect(command.copiedElements).toHaveLength(1)
      expect(command.ghostLine.node.isConnected).toBe(true)
      if (phase === 'source prompt') {
        click(205, 154)
        expect(editor.signals.inputValue.getNumListeners()).toBe(1)
      }
    }
    editor.signals.commandCancelled.dispatch()
    await clock.advance(20)
    expectCleanup()
    expect(editor.activeCollection.children()).toHaveLength(2)
    expect(editor.history.undos).toHaveLength(0)
    await move(103, 4)
    expect(editor.activeCollection.children()).toHaveLength(2)
  })

  test('rejects a zero-length snapped axis and removes all preview listeners', async () => {
    startMirror()
    await move(3, 4)
    click(3, 4)
    await move(4, 3)
    click(4, 3)
    await clock.advance(20)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'Mirror axis requires two different points.', type: 'error',
    })
    expectCleanup()
    expect(editor.activeCollection.children()).toHaveLength(2)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('applies Ortho consistently without mutating the shared snap point', async () => {
    editor.selected = []
    startMirror()
    editor.selected = [source]
    keydown('Enter')
    await move(3, 4)
    click(3, 4)
    editor.ortho = true
    await move(205, 154)
    const snapPoint = editor.snapPoint
    expect(snapPoint).toEqual({ x: 200, y: 150 })
    const previewAxis = Array.from(command.ghostLine.array(), point => [...point])
    click(205, 154)
    expect(command.secondPoint).toEqual({ x: 200, y: 0 })
    expect(snapPoint).toEqual({ x: 200, y: 150 })
    expect(previewAxis).toEqual([[0, 0], [200, 0]])
    expectPoints(command.copiedElements[0], [[0, 0], [100, 0]])
    expect(editor.signals.updatedCoordinates.getNumListeners()).toBe(coordinateListeners)
  })
})
