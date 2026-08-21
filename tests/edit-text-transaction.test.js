// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { EditTextCommand } from '../src/js/commands/EditTextCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('EditTextCommand transaction boundary', () => {
  test('previews without dirtying and restores exact state on cancellation', () => {
    vi.useFakeTimers()
    const { activeCollection, editor, terminal } = createFixture()
    const text = activeCollection.text('Original').attr({ id: 'text-1', name: 'Note' })
    const priorSelection = activeCollection.line(0, 0, 1, 1).attr('id', 'line-1')
    editor.selected = [priorSelection]
    const command = new EditTextCommand(editor, text)

    command.execute()
    terminal.input.value = 'Draft preview'
    terminal.input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(text.text()).toBe('Draft preview')
    expect(editor.documentState.revision).toBe(0)
    expect(editor.history.undos).toEqual([])
    expect(editor.isInteracting).toBe(true)
    expect(command.pointCaptureTimer).not.toBeNull()

    editor.signals.commandCancelled.dispatch()

    expect(text.text()).toBe('Original')
    expect(editor.documentState.revision).toBe(0)
    expect(editor.history.undos).toEqual([])
    expect(editor.isInteracting).toBe(false)
    expect(editor.isTypingText).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.selected).toEqual([priorSelection])
    expect(editor.signals.inputValue.getNumListeners()).toBe(0)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(command.pointCaptureTimer).toBeNull()
  })

  test('commits the first persistent text mutation once and round-trips Undo/Redo', () => {
    const { activeCollection, editor } = createFixture()
    const text = activeCollection.text('Original').attr({ id: 'text-1', name: 'Note' })
    const command = new EditTextCommand(editor, text)

    command.execute()
    const result = command.onTextInput('Revised')

    expect(result).toBe(command)
    expect(text.text()).toBe('Revised')
    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()

    editor.history.undo()
    expect(text.text()).toBe('Original')
    expect(editor.documentState.revision).toBe(2)

    editor.history.redo()
    expect(text.text()).toBe('Revised')
    expect(editor.documentState.revision).toBe(3)
  })

  test('does not create History for unchanged text and rolls back a failed apply', () => {
    const { activeCollection, editor } = createFixture()
    const unchanged = activeCollection.text('Same').attr('id', 'text-1')
    const noOp = new EditTextCommand(editor, unchanged)
    noOp.execute()
    expect(noOp.onTextInput('Same')).toBeNull()
    expect(editor.history.undos).toEqual([])
    expect(editor.documentState.revision).toBe(0)

    const text = activeCollection.text('Original').attr('id', 'text-2')
    const command = new EditTextCommand(editor, text)
    command.execute()
    editor.signals.updatedOutliner.dispatch = vi.fn(() => {
      throw new Error('outliner failure')
    })

    expect(() => command.onTextInput('Revised')).toThrow('outliner failure')
    expect(text.text()).toBe('Original')
    expect(editor.history.undos).toEqual([])
    expect(editor.history.idCounter).toBe(0)
    expect(editor.documentState.revision).toBe(0)
  })
})
