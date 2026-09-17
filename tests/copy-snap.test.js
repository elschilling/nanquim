// @vitest-environment jsdom

import { Matrix, Point } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Viewport } from '../src/js/Viewport.js'
import { Terminal } from '../src/js/Terminal.js'
import { CopyCommand } from '../src/js/commands/CopyCommand.js'
import {
  createDeterministicEditorFixture,
  installClockHarness,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture, editor, source, target, command, clock, listeners, windowProperties

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
  source = editor.activeCollection.line(0, 0, 100, 0).attr('id', 'copy-source')
  target = editor.activeCollection.line(200, 150, 300, 150).attr('id', 'copy-target')
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
  command = new CopyCommand(editor)
  command.execute()
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

function expectStart(element, x, y) {
  const point = new Point(element.array()[0]).transform(element.matrix())
  expect(point.x).toBeCloseTo(x, 8)
  expect(point.y).toBeCloseTo(y, 8)
}

describe('COPY viewport snapping', () => {
  test.each(['F9', 'toolbar'])('refreshes snap immediately when toggled with %s during COPY', async method => {
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
    await move(3, 4)
    expect(editor.snapPoint).toBeNull()
    await toggle()
    expect(editor.isSnapping).toBe(true)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({ type: 'strong', msg: 'Snap ON' })
    expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    expect(editor.snap.children().length).toBeGreaterThan(0)
    click(3, 4)
    expect(command.basePoint).toEqual({ x: 0, y: 0 })

    await toggle()
    expect(editor.snapPoint).toBeNull()
    expect(editor.snap.children()).toHaveLength(0)
    await move(205, 154)
    expectStart(command.currentGhosts[0], 205, 154)
    await toggle()
    expect(editor.snapPoint).toEqual({ x: 200, y: 150 })
    expectStart(command.currentGhosts[0], 200, 150)
    expect(editor.isInteracting).toBe(true)

    await toggle()
    expect(editor.snapPoint).toBeNull()
    expect(editor.snap.children()).toHaveLength(0)
    expectStart(command.currentGhosts[0], 205, 154)
    await toggle()
    click(205, 154)
    expectStart(command.allCopiedElements[0], 200, 150)
  })

  test.each(['document', 'mode'])('does not reuse a pending pointer after a %s change', async change => {
    editor.isSnapping = false
    editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 3, clientY: 4 }))
    if (change === 'document') {
      editor.signals.documentSessionReset.dispatch()
    } else {
      editor.mode = 'paper'
      editor.signals.editorModeChanged.dispatch('paper')
    }
    window.handleToogleSnap()
    await clock.advanceFrame()
    expect(editor.snapPoint).toBeNull()
    expect(editor.snap.children()).toHaveLength(0)
  })

  test('uses preselection immediately to snap the base point and successive destinations', async () => {
    expect(editor.isInteracting).toBe(true)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    await move(3, 4)
    expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    click(3, 4)
    expect(command.basePoint).toEqual({ x: 0, y: 0 })

    await move(205, 154)
    expect(editor.snapPoint).toEqual({ x: 200, y: 150 })
    expectStart(command.currentGhosts[0], 200, 150)
    expectStart(source, 0, 0)
    click(205, 154)
    await Promise.resolve()
    expectStart(command.allCopiedElements[0], 200, 150)

    await move(103, 4)
    expect(editor.snapPoint).toEqual({ x: 100, y: 0 })
    expectStart(command.currentGhosts[0], 100, 0)
    click(103, 4)
    await Promise.resolve()
    keydown('Enter')
    await clock.advance(20)

    expect(editor.history.undos).toHaveLength(1)
    expect(command.allCopiedElements).toHaveLength(2)
    expectStart(command.allCopiedElements[1], 100, 0)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.ghostNodes).toBeNull()
    expect(editor.drawing.find('[data-nanquim-transient="true"]')).toHaveLength(0)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.inputValue.getNumListeners()).toBe(0)
    editor.history.undo()
    expect(command.allCopiedElements.every(element => !element.node.isConnected)).toBe(true)
    expectStart(source, 0, 0)
    editor.history.redo()
    expectStart(command.allCopiedElements[0], 200, 150)
    expectStart(command.allCopiedElements[1], 100, 0)
  })

  test('waits for selection confirmation when COPY starts without selected elements', async () => {
    editor.signals.commandCancelled.dispatch()
    await clock.advance(20)
    command = new CopyCommand(editor)
    command.execute()
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span', msg: 'Select elements to copy and press Enter to confirm.',
    })

    editor.selected = [source]
    keydown('Enter')
    expect(editor.isInteracting).toBe(true)
    await move(3, 4)
    expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    click(3, 4)
    expect(command.basePoint).toEqual({ x: 0, y: 0 })
    await move(205, 154)
    expectStart(command.currentGhosts[0], 200, 150)
  })

  test.each([
    ['Ortho', { ortho: true }, [200, 0]],
    ['a fixed distance', { distance: 100 }, [80, 60]],
    ['grid snap', { isSnapping: false, gridSnap: true }, [210, 150]],
    ['snap disabled', { isSnapping: false }, [205, 154]],
  ])('keeps the preview and placement consistent with %s', async (_label, options, expected) => {
    click(0, 0)
    Object.assign(editor, options)
    if (options.gridSnap) editor.signals.preferencesChanged.dispatch({ gridSize: 10 })
    await move(205, 154)
    expectStart(command.currentGhosts[0], ...expected)
    click(205, 154)
    expectStart(command.allCopiedElements[0], ...expected)
  })

  test('cancels a snapped preview without leaving a copy or changing the source', async () => {
    click(0, 0)
    await move(205, 154)
    expect(editor.snapPoint).toEqual({ x: 200, y: 150 })
    expectStart(command.currentGhosts[0], 200, 150)
    editor.signals.commandCancelled.dispatch()
    await clock.advance(20)
    expect(editor.activeCollection.children()).toHaveLength(2)
    expectStart(source, 0, 0)
    expect(source.attr('transform')).toBeUndefined()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.ghostNodes).toBeNull()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.inputValue.getNumListeners()).toBe(0)
  })
})
