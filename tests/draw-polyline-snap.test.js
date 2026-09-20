// @vitest-environment jsdom

import { Matrix, Point } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Viewport } from '../src/js/Viewport.js'
import { DrawPolylineCommand } from '../src/js/commands/DrawPolylineCommand.js'
import {
  createDeterministicEditorFixture,
  installClockHarness,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function click(command, x, y) {
  command.handleClick({ button: 0, pageX: x, pageY: y })
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('POLYLINE snapping', () => {
  test('uses snapped coordinates for committed vertices', () => {
    const { editor } = createFixture()
    const command = new DrawPolylineCommand(editor)
    command.execute()

    editor.snapPoint = { x: 4, y: 6 }
    click(command, 40, 60)
    editor.snapPoint = { x: 20, y: 12 }
    click(command, 200, 120)

    expect(command.points).toEqual([[4, 6], [20, 12]])
    command.finalizePolyline()
    expect(editor.activeCollection.findOne('polyline').array()).toEqual([[4, 6], [20, 12]])
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.activeDrawingSnapPoints).toBeNull()
  })

  test('updates the live segment from the post-snap coordinate signal', () => {
    const { editor } = createFixture()
    const command = new DrawPolylineCommand(editor)
    command.execute()
    click(command, 4, 6)

    editor.signals.updatedCoordinates.dispatch({ x: 20, y: 12 })

    expect(command.polyline.array()).toEqual([[4, 6], [20, 12]])
    command.cleanup()
    expect(editor.signals.updatedCoordinates.getNumListeners()).toBe(0)
    expect(editor.activeDrawingSnapPoints).toBeNull()
    expect(editor.svg.findOne('[data-nanquim-transient="true"]')).toBeNull()
  })

  test('flushes a pending snap calculation before a fast vertex click', () => {
    const clock = installClockHarness()
    const listeners = installDomListenerTracker()
    const previousSvg = globalThis.SVG
    const { activeCollection, editor } = createFixture()
    globalThis.SVG = { Point }
    editor.isSnapping = true
    editor.snapTypes = { endpoint: true }
    editor.ortho = false

    for (const svg of [editor.svg, editor.paperSvg]) {
      svg.panZoom = () => svg
      svg.zoom = () => 1
      vi.spyOn(svg, 'screenCTM').mockReturnValue(new Matrix())
      Object.defineProperty(svg.node, 'clientWidth', { configurable: true, value: 1000 })
      vi.spyOn(svg.node, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, width: 1000, height: 1000,
      })
    }
    const target = activeCollection.line(0, 0, 100, 0).attr('id', 'snap-target')
    vi.spyOn(target, 'screenCTM').mockImplementation(() => target.matrix())
    for (const name of ['x1', 'y1', 'x2', 'y2']) {
      Object.defineProperty(target.node, name, {
        configurable: true,
        get: () => ({ baseVal: { value: Number(target.attr(name)) } }),
      })
    }
    editor.spatialIndex.ensureFresh = vi.fn()
    editor.spatialIndex.search = vi.fn(() => [{ element: target }])
    editor.svg.viewbox(0, 0, 1000, 1000)
    new Viewport(editor)
    const command = new DrawPolylineCommand(editor)
    command.execute()

    try {
      editor.svg.node.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: 3, clientY: 4,
      }))
      // Click before requestAnimationFrame has processed the pointer move.
      editor.svg.node.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: 3, clientY: 4,
      }))

      expect(command.points).toEqual([[0, 0]])
      expect(editor.snapPoint).toEqual({ x: 0, y: 0 })

      // The transient preview itself is excluded from the spatial index, but
      // its committed vertices must remain valid endpoint snap targets so the
      // polyline can be closed precisely.
      editor.spatialIndex.search.mockReturnValue([])
      editor.svg.node.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: 6, clientY: 4,
      }))
      editor.svg.node.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: 6, clientY: 4,
      }))

      expect(command.points).toEqual([[0, 0], [0, 0]])
      expect(editor.snapPoint).toEqual({ x: 0, y: 0 })
    } finally {
      command.cleanup()
      listeners.dispose()
      clock.dispose()
      globalThis.SVG = previousSvg
    }
  })
})
