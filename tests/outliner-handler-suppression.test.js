// @vitest-environment jsdom

import { Matrix } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MirrorCommand } from '../src/js/commands/MirrorCommand.js'
import {
  createDeterministicEditorFixture,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture, editor, line, listeners, windowListeners

const refreshSignals = ['refreshHandlers', 'zoomChanged', 'preferencesChanged']

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
  document.body.innerHTML = '<div id="drawing-tree"></div>'
  listeners = installDomListenerTracker()
  windowListeners = []
  const addWindowListener = window.addEventListener
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    windowListeners.push({ type, listener, options })
    return addWindowListener.call(window, type, listener, options)
  })
  fixture = createDeterministicEditorFixture()
  editor = fixture.editor
  editor.svg.zoom = vi.fn(() => 2)
  editor.svg.screenCTM = vi.fn(() => new Matrix(2, 0, 0, 2, 100, 50))
  line = editor.activeCollection.line(10, 20, 50, 20).attr('id', 'handler-source')
  line.screenCTM = vi.fn(() => editor.svg.screenCTM())
  for (const name of ['x1', 'y1', 'x2', 'y2']) {
    Object.defineProperty(line.node, name, {
      configurable: true,
      get: () => ({ baseVal: { value: Number(line.attr(name)) } }),
    })
  }
  const { Outliner } = await import('../src/js/Outliner.js')
  new Outliner(editor)
  editor.selected = [line]
  editor.signals.updatedSelection.dispatch()
  expectLineGrips()
})

afterEach(() => {
  editor.signals.commandCancelled.dispatch()
  vi.runOnlyPendingTimers()
  windowListeners.forEach(({ type, listener, options }) => window.removeEventListener(type, listener, options))
  listeners.dispose()
  fixture.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  document.body.replaceChildren()
})

function expectLineGrips() {
  const grips = [...editor.handlers.node.querySelectorAll('.selection-handler')]
  expect(grips).toHaveLength(2)
  expect(grips.map(grip => [
    Number(grip.getAttribute('x')) + Number(grip.getAttribute('width')) / 2,
    Number(grip.getAttribute('y')) + Number(grip.getAttribute('height')) / 2,
  ])).toEqual([[10, 20], [50, 20]])
}

describe('Outliner handler suppression', () => {
  test.each(refreshSignals)('%s clears existing grips while suppressed and restores them afterward', signal => {
    editor.suppressHandlers = true
    editor.signals[signal].dispatch()
    expect(editor.handlers.children()).toHaveLength(0)
    expect(editor.selected).toEqual([line])

    editor.suppressHandlers = false
    editor.signals[signal].dispatch()
    expectLineGrips()
    expect(editor.signals.vertexEditStarted.dispatch).not.toHaveBeenCalled()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test.each(['first point', 'preview', 'source prompt'])('keeps every refresh path suppressed during the MIRROR %s phase', phase => {
    const command = new MirrorCommand(editor)
    command.execute()
    if (phase !== 'first point') {
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      if (phase === 'source prompt') editor.signals.pointCaptured.dispatch({ x: 0, y: 100 })
    }
    expect(editor.isInteracting).toBe(true)
    expect(editor.suppressHandlers).toBe(true)
    expect(editor.handlers.children()).toHaveLength(0)

    refreshSignals.forEach(signal => {
      editor.signals[signal].dispatch()
      expect(editor.handlers.children(), signal).toHaveLength(0)
    })
    expect(editor.selected).toEqual([line])
    expect(editor.signals.vertexEditStarted.dispatch).not.toHaveBeenCalled()

    editor.signals.commandCancelled.dispatch()
    vi.runOnlyPendingTimers()
    editor.signals.refreshHandlers.dispatch()
    expectLineGrips()
    expect(editor.suppressHandlers).toBe(false)
    expect(editor.isInteracting).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.drawing.find('[data-nanquim-transient="true"]')).toHaveLength(0)
  })
})
