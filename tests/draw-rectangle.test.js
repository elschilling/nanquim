// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import {
  DrawRectangleCommand,
  getRectangleOrigin,
} from '../src/js/commands/DrawRectangleCommand.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

class TestSignal {
  constructor() {
    this.listeners = []
  }

  add(listener, context) {
    this.listeners.push({ listener, context, once: false })
  }

  addOnce(listener, context) {
    this.listeners.push({ listener, context, once: true })
  }

  remove(listener, context) {
    this.listeners = this.listeners.filter((entry) => (
      entry.listener !== listener || (context !== undefined && entry.context !== context)
    ))
  }

  dispatch(...args) {
    for (const entry of [...this.listeners]) {
      if (entry.once) this.remove(entry.listener, entry.context)
      entry.listener.apply(entry.context, args)
    }
  }

  getNumListeners() {
    return this.listeners.length
  }
}

function createEditor(coordinates = { x: 120, y: 120 }) {
  const svgNode = document.createElementNS(SVG_NS, 'svg')
  document.body.appendChild(svgNode)

  const svg = SVG(svgNode)
  const drawing = svg.group().attr('id', 'Collection')
  const collection = drawing.group().attr({
    id: 'collection-test',
    'data-collection': 'true',
  })
  const signals = new Proxy({}, {
    get(target, key) {
      if (!target[key]) target[key] = new TestSignal()
      return target[key]
    },
  })

  return {
    activeCollection: collection,
    collections: new Map([['collection-test', {
      group: collection,
      style: {
        stroke: '#ffffff',
        'stroke-width': 0.25,
        fill: 'transparent',
        opacity: 1,
      },
    }]]),
    coordinates,
    elementIndex: 1,
    history: { undos: [], redos: [] },
    isDrawing: true,
    isInteracting: false,
    mode: 'model',
    selectSingleElement: false,
    signals,
    snapPoint: null,
    svg,
    setIsDrawing(value) {
      this.isDrawing = value
    },
  }
}

describe('rectangle dimension placement', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test.each([
    [{ x: 120, y: 120 }, { x: 100, y: 100 }],
    [{ x: 80, y: 120 }, { x: 70, y: 100 }],
    [{ x: 120, y: 80 }, { x: 100, y: 80 }],
    [{ x: 80, y: 80 }, { x: 70, y: 80 }],
  ])('anchors the start point in the cursor quadrant %#', (directionPoint, expected) => {
    expect(getRectangleOrigin({ x: 100, y: 100 }, 30, 20, directionPoint)).toEqual(expected)
  })

  test('shows the exact-size preview immediately after typed width and height', async () => {
    const editor = createEditor({ x: 80, y: 80 })
    const command = new DrawRectangleCommand(editor)
    command._startPoint = { x: 100, y: 100 }
    command._rect = { draw: vi.fn() }

    command._enterDimensionMode()
    editor.signals.inputValue.dispatch('30')
    await Promise.resolve()
    editor.signals.inputValue.dispatch('20')

    const preview = editor.svg.node.querySelector('[data-rectangle-preview="true"]')
    expect(preview).not.toBeNull()
    expect(preview.getAttribute('x')).toBe('70')
    expect(preview.getAttribute('y')).toBe('80')
    expect(preview.getAttribute('width')).toBe('30')
    expect(preview.getAttribute('height')).toBe('20')

    editor.signals.updatedCoordinates.dispatch({ x: 120, y: 80 })
    expect(preview.getAttribute('x')).toBe('100')
    expect(preview.getAttribute('y')).toBe('80')

    editor.signals.pointCaptured.dispatch({ x: 80, y: 120 })
    vi.runOnlyPendingTimers()

    expect(preview.isConnected).toBe(false)
    const rectangle = editor.activeCollection.node.querySelector('rect')
    expect(rectangle).not.toBeNull()
    expect(rectangle.getAttribute('x')).toBe('70')
    expect(rectangle.getAttribute('y')).toBe('100')
    expect(rectangle.getAttribute('width')).toBe('30')
    expect(rectangle.getAttribute('height')).toBe('20')
    expect(rectangle.getAttribute('name')).toBe('Rectangle')
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.lastCommand).toBe(command)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
  })

  test('accepts a typed direction relative to the starting point', () => {
    const editor = createEditor()
    const command = new DrawRectangleCommand(editor)
    command._dimensionModeActive = true
    command._waitForPlacement({ x: 100, y: 100 }, 30, 20)

    editor.inputCoord = { x: -1, y: -1 }
    editor.inputCoordMode = 'relative'
    editor.signals.coordinateInput.dispatch()

    const rectangle = editor.activeCollection.node.querySelector('rect')
    expect(rectangle.getAttribute('x')).toBe('70')
    expect(rectangle.getAttribute('y')).toBe('80')
    expect(editor.svg.node.querySelector('[data-rectangle-preview="true"]')).toBeNull()
  })

  test('cancelling while entering dimensions removes the pending value listener', () => {
    const editor = createEditor()
    const command = new DrawRectangleCommand(editor)
    command._startPoint = { x: 100, y: 100 }
    command._rect = { draw: vi.fn() }

    command._enterDimensionMode()
    expect(editor.signals.inputValue.getNumListeners()).toBe(1)

    editor.signals.commandCancelled.dispatch()
    expect(editor.signals.inputValue.getNumListeners()).toBe(0)
    expect(editor.isInteracting).toBe(false)

    editor.signals.inputValue.dispatch('30')
    expect(editor.svg.node.querySelector('[data-rectangle-preview="true"]')).toBeNull()
  })
})
