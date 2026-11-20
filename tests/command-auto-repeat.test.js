// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { cancelCommandSession, executeRegisteredCommand } from '../src/js/commands/_commands'
import { savePreferences } from '../src/js/Preferences'
import { createDeterministicEditorFixture } from './support/deterministic-harness'

describe('registered command repetition', () => {
  let fixture
  let editor

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    document.body.replaceChildren()
    fixture = createDeterministicEditorFixture()
    editor = fixture.editor
  })

  afterEach(() => {
    cancelCommandSession(editor)
    fixture.dispose()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  function finishRectangle() {
    const rect = editor.activeCollection.findOne('rect[data-nanquim-transient="true"]')
    rect.size(10, 5)
    fixture.fireDraw(rect, 'drawstop')
    return rect
  }

  function enableAutoRepeat() {
    savePreferences({ autoRepeatLastCommand: true })
  }

  test.each(['model', 'paper'])('restarts Rectangle in %s with independent Undo/Redo and clean cancellation', async (mode) => {
    enableAutoRepeat()
    editor.mode = mode
    if (mode === 'paper') editor.activeCollection = editor.paperDrawing
    executeRegisteredCommand(editor, 'rec')
    const revision = editor.commandSessionRevision
    const first = finishRectangle()
    expect(editor.isDrawing).toBe(false)
    await vi.runAllTimersAsync()
    expect(editor.commandSessionRevision).toBe(revision + 1)
    expect(editor.isDrawing).toBe(true)
    expect(editor.lastCommand.commandName).toBe('RECTANGLE')
    expect(editor.history.undos).toHaveLength(1)

    const second = finishRectangle()
    await vi.runAllTimersAsync()
    cancelCommandSession(editor)
    await vi.runAllTimersAsync()
    expect(editor.isDrawing).toBe(false)
    expect(editor.signals.commandCompleted.getNumListeners()).toBe(0)
    expect(editor.activeCollection.find('rect')).toEqual([first, second])

    editor.history.undo()
    await vi.runAllTimersAsync()
    expect(editor.activeCollection.find('rect')).toEqual([first])
    editor.history.redo()
    await vi.runAllTimersAsync()
    expect(editor.activeCollection.find('rect')).toEqual([first, second])
    expect(editor.isDrawing).toBe(false)
  })

  test.each(['pointer', 'typed'])('repeats Circle after %s completion', async (input) => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'c')
    const circle = editor.activeCollection.findOne('circle')
    fixture.fireDraw(circle, 'drawstart', { startPoint: { x: 10, y: 20 } })
    if (input === 'pointer') {
      circle.radius(5)
      fixture.fireDraw(circle, 'drawstop')
    } else {
      editor.length = '5'
      editor.svg.fire('valueInput')
    }
    await vi.runAllTimersAsync()
    expect(editor.isDrawing).toBe(true)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.activeCollection.find('circle')).toHaveLength(2)
  })

  test('repeats a dimensioned Rectangle after its deferred placement cleanup', async () => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'rec')
    const preview = editor.activeCollection.findOne('rect')
    preview.remember('_paintHandler', { startPoint: { x: 10, y: 20 } })
    fixture.fireDraw(preview, 'drawstart')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    editor.signals.inputValue.dispatch('20')
    await Promise.resolve()
    editor.signals.inputValue.dispatch('10')
    editor.signals.pointCaptured.dispatch({ x: 30, y: 40 })
    await vi.runAllTimersAsync()

    expect(editor.isDrawing).toBe(true)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.activeCollection.find('[data-rectangle-preview]')).toHaveLength(0)
    expect(editor.activeCollection.find('rect:not([data-nanquim-transient])')[0].attr())
      .toMatchObject({ x: 10, y: 20, width: 20, height: 10 })
  })

  test('uses the active collection and style for the next repeated drawing', async () => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'rec')
    const first = finishRectangle()
    const nextCollection = editor.drawing.group().attr({ id: 'next', 'data-collection': 'true' })
    editor.collections.set('next', {
      group: nextCollection,
      style: { stroke: '#008877', 'stroke-width': 0.5, fill: 'none' },
    })
    editor.activeCollection = nextCollection
    await vi.runAllTimersAsync()

    const next = nextCollection.findOne('rect')
    expect(next.css('stroke')).toBe('rgb(0, 136, 119)')
    expect(next.css('stroke-width')).toBe('0.5')
    expect(first.parent()).toBe(fixture.activeCollection)
    expect(editor.history.undos).toHaveLength(1)
  })

  test('a failed mutation does not schedule an automatic repeat', async () => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'rec')
    const revision = editor.commandSessionRevision
    vi.spyOn(editor, 'execute').mockImplementation(() => { throw new Error('Commit failed') })
    const onError = vi.fn(event => event.preventDefault())
    window.addEventListener('error', onError)
    try {
      finishRectangle()
      expect(onError).toHaveBeenCalledOnce()
      expect(onError.mock.calls[0][0].error.message).toBe('Commit failed')
    } finally {
      window.removeEventListener('error', onError)
    }
    await vi.runAllTimersAsync()
    expect(editor.commandSessionRevision).toBe(revision)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('repeats an Ellipse only after valid input', async () => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'el')
    editor.signals.pointCaptured.dispatch({ x: 10, y: 20 })
    editor.signals.inputValue.dispatch('5')
    await Promise.resolve()
    editor.signals.inputValue.dispatch('3')
    await vi.runAllTimersAsync()
    expect(editor.isInteracting).toBe(true)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)

    editor.signals.pointCaptured.dispatch({ x: 10, y: 20 })
    editor.signals.inputValue.dispatch('-1')
    await vi.runAllTimersAsync()
    expect(editor.isInteracting).toBe(false)
    expect(editor.history.undos).toHaveLength(1)
  })

  test('repeats Move with a fresh selection without applying the displacement again', async () => {
    enableAutoRepeat()
    const line = editor.activeCollection.line(0, 0, 10, 0)
    editor.selected = [line]
    executeRegisteredCommand(editor, 'm')
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    editor.signals.pointCaptured.dispatch({ x: 5, y: 0 })
    await vi.runAllTimersAsync()
    expect(line.array()).toEqual([[5, 0], [15, 0]])
    expect(editor.selected).toEqual([])
    expect(editor.suppressHandlers).toBe(true)
    expect(editor.history.undos).toHaveLength(1)
    cancelCommandSession(editor)
    editor.history.undo()
    expect(line.array()).toEqual([[0, 0], [10, 0]])
    editor.history.redo()
    expect(line.array()).toEqual([[5, 0], [15, 0]])
  })

  test('repeats a preselected Hatch by awaiting a new region instead of hatching indefinitely', async () => {
    enableAutoRepeat()
    editor.selected = [editor.activeCollection.rect(10, 5)]
    executeRegisteredCommand(editor, 'h')
    await vi.runAllTimersAsync()
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.selected).toEqual([])
    expect(editor.isInteracting).toBe(true)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each(['DIST', 'AREA'])('repeats %s without adding history', async (name) => {
    enableAutoRepeat()
    vi.spyOn(editor.svg, 'zoom').mockReturnValue(1)
    executeRegisteredCommand(editor, name)
    if (name === 'DIST') {
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.pointCaptured.dispatch({ x: 3, y: 4 })
    } else {
      editor.signals.toogledSelect.dispatch(editor.activeCollection.rect(10, 5))
    }
    await vi.runAllTimersAsync()
    expect(editor.isInteracting).toBe(true)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test.each(['cancel', 'document', 'mode', 'surface', 'preference', 'command'])(
    'discards a queued repeat after a %s change',
    async (change) => {
      enableAutoRepeat()
      executeRegisteredCommand(editor, 'rec')
      finishRectangle()
      if (change === 'cancel') cancelCommandSession(editor)
      if (change === 'document') editor.signals.documentSessionReset.dispatch()
      if (change === 'mode') {
        editor.mode = 'paper'
        editor.signals.editorModeChanged.dispatch()
      }
      if (change === 'surface') {
        editor.activeEditor = 'geometry-nodes'
        editor.signals.activeEditorChanged.dispatch()
      }
      if (change === 'preference') {
        const preferences = savePreferences({ autoRepeatLastCommand: false })
        editor.signals.preferencesChanged.dispatch(preferences)
      }
      if (change === 'command') executeRegisteredCommand(editor, 'c')
      await vi.runAllTimersAsync()
      expect(editor.activeCollection.find('rect')).toHaveLength(1)
      expect(editor.isDrawing).toBe(change === 'command')
      expect(editor.history.undos).toHaveLength(1)
      if (change !== 'command') {
        expect(editor.signals.commandCompleted.getNumListeners()).toBe(0)
      }
    },
  )

  test('ignores stale and duplicate completion notifications', async () => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'rec')
    await vi.runAllTimersAsync()
    editor.signals.commandCompleted.dispatch(editor.commandSessionRevision - 1)
    expect(vi.getTimerCount()).toBe(0)
    finishRectangle()
    editor.signals.commandCompleted.dispatch(editor.commandSessionRevision)
    expect(vi.getTimerCount()).toBe(1)
    await vi.runAllTimersAsync()
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.activeCollection.find('rect')).toHaveLength(2)
  })

  test('cancellation before completion and one-shot actions do not schedule a repeat', async () => {
    enableAutoRepeat()
    executeRegisteredCommand(editor, 'rec')
    cancelCommandSession(editor)
    await vi.runAllTimersAsync()
    expect(editor.activeCollection.find('rect')).toHaveLength(0)
    editor.helpSession = { open: vi.fn() }
    executeRegisteredCommand(editor, 'help')
    await vi.runAllTimersAsync()
    expect(editor.helpSession.open).toHaveBeenCalledOnce()
    expect(editor.history.undos).toHaveLength(0)
  })

  test('finishes Rectangle once by default and manually repeats it with a fresh session', async () => {
    executeRegisteredCommand(editor, 'rec')
    const firstSession = editor.lastCommand
    const rectangle = finishRectangle()
    await vi.runAllTimersAsync()

    expect(editor.isDrawing).toBe(false)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.activeCollection.find('rect')).toHaveLength(1)

    firstSession.execute()
    expect(editor.isDrawing).toBe(true)
    expect(editor.lastCommand).not.toBe(firstSession)
    cancelCommandSession(editor)
    expect(editor.activeCollection.find('rect')).toEqual([rectangle])
    expect(editor.history.undos).toHaveLength(1)
  })

  test.each([false, true])('Line keeps its connected-segment workflow with auto repeat %s', (enabled) => {
    savePreferences({ autoRepeatLastCommand: enabled })
    executeRegisteredCommand(editor, 'l')
    const line = editor.activeCollection.findOne('line')
    line.plot([[0, 0], [10, 5]])
    fixture.fireDraw(line, 'drawstop', [[0, 0], [10, 5]])

    expect(editor.isDrawing).toBe(true)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.activeCollection.find('line')).toHaveLength(2)

    cancelCommandSession(editor)
    expect(editor.isDrawing).toBe(false)
    expect(editor.activeCollection.find('line')).toEqual([line])
  })
})
