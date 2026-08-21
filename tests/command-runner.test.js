// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { Command } from '../src/js/Command.js'
import commands, {
  cancelCommandSession,
  executeRegisteredCommand,
  resolveRegisteredCommand,
} from '../src/js/commands/_commands.js'

function createEditor() {
  return {
    distance: 12,
    isDrawing: true,
    isInteracting: true,
    isSelecting: true,
    isTypingText: true,
    length: 8,
    paperSvg: { fire: vi.fn() },
    selected: [{ id: 'selected' }],
    selectSingleElement: true,
    signals: { commandCancelled: { dispatch: vi.fn() } },
    suppressHandlers: true,
    svg: { fire: vi.fn() },
  }
}

const originalHelpExecute = commands.HELP.execute

afterEach(() => {
  commands.HELP.execute = originalHelpExecute
  vi.useRealTimers()
})

describe('registered command runner', () => {
  test('resolves canonical names and aliases through one case-insensitive lookup', () => {
    expect(resolveRegisteredCommand(' line ')).toMatchObject({ name: 'LINE' })
    expect(resolveRegisteredCommand('L')).toMatchObject({ name: 'LINE' })
    expect(resolveRegisteredCommand('?')).toMatchObject({ name: 'HELP' })
    expect(resolveRegisteredCommand('missing')).toBeNull()
  })

  test('normalizes the prior session before canonical and repeated execution', () => {
    const editor = createEditor()
    const execute = vi.fn()
    commands.HELP.execute = execute

    expect(executeRegisteredCommand(editor, 'help')).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(editor)
    expect(editor.signals.commandCancelled.dispatch).toHaveBeenCalledOnce()
    expect(editor.svg.fire).toHaveBeenCalledWith('cancelDrawing', null)
    expect(editor.paperSvg.fire).toHaveBeenCalledWith('cancelDrawing', null)
    expect(editor).toMatchObject({
      distance: null,
      isDrawing: false,
      isInteracting: false,
      isSelecting: false,
      isTypingText: false,
      length: null,
      selectSingleElement: false,
      suppressHandlers: false,
    })
    expect(editor.selected).toHaveLength(1)

    editor.lastCommand.execute()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(editor.signals.commandCancelled.dispatch).toHaveBeenCalledTimes(2)
  })

  test('does not disturb the editor for an unknown command', () => {
    const editor = createEditor()

    expect(executeRegisteredCommand(editor, 'unknown-command')).toBe(false)
    expect(editor.signals.commandCancelled.dispatch).not.toHaveBeenCalled()
    expect(editor.svg.fire).not.toHaveBeenCalled()
    expect(editor.isDrawing).toBe(true)
  })

  test('rejects commands outside their declared editor mode after cancelling the prior session', () => {
    const editor = createEditor()
    editor.mode = 'paper'
    editor.signals.terminalLogged = { dispatch: vi.fn() }
    const execute = vi.fn()
    const original = commands.BLOCK.execute
    commands.BLOCK.execute = execute

    try {
      expect(executeRegisteredCommand(editor, 'block')).toBe(true)
      expect(execute).not.toHaveBeenCalled()
      expect(editor.signals.commandCancelled.dispatch).toHaveBeenCalledOnce()
      expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
        msg: 'Command not available in Paper Space.',
      })
      expect(editor.isDrawing).toBe(false)
      expect(editor.lastCommand).toBeUndefined()
    } finally {
      commands.BLOCK.execute = original
    }
  })

  test('repeat-last remains registry-backed and rechecks mode availability', () => {
    const editor = createEditor()
    editor.mode = 'model'
    editor.signals.terminalLogged = { dispatch: vi.fn() }
    const execute = vi.fn()
    const original = commands.BLOCK.execute
    commands.BLOCK.execute = execute

    try {
      expect(executeRegisteredCommand(editor, 'block')).toBe(true)
      expect(editor.lastCommand.commandName).toBe('BLOCK')
      expect(execute).toHaveBeenCalledOnce()

      editor.mode = 'paper'
      expect(editor.lastCommand.execute()).toBe(true)
      expect(execute).toHaveBeenCalledOnce()
      expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
        msg: 'Command not available in Paper Space.',
      })
    } finally {
      commands.BLOCK.execute = original
    }
  })

  test('returns the editor to neutral state when command startup throws', () => {
    const editor = createEditor()
    const failure = new Error('startup failed')
    commands.HELP.execute = vi.fn(() => {
      editor.isInteracting = true
      throw failure
    })

    expect(() => executeRegisteredCommand(editor, 'help')).toThrow(failure)
    expect(editor.signals.commandCancelled.dispatch).toHaveBeenCalledTimes(2)
    expect(editor.isInteracting).toBe(false)
    expect(editor.isDrawing).toBe(false)
  })

  test('cancels model and Paper draw sessions without clearing selection', () => {
    const editor = createEditor()
    const event = { type: 'escape' }

    cancelCommandSession(editor, event)

    expect(editor.svg.fire).toHaveBeenCalledWith('cancelDrawing', event)
    expect(editor.paperSvg.fire).toHaveBeenCalledWith('cancelDrawing', event)
    expect(editor.signals.commandCancelled.dispatch).toHaveBeenCalledOnce()
    expect(editor.selected).toHaveLength(1)
  })

  test('normalizes state even when a drawing or signal cleanup throws', () => {
    const editor = createEditor()
    const error = new Error('faulty cleanup')
    editor.svg.fire.mockImplementation(() => { throw error })
    editor.signals.commandCancelled.dispatch.mockImplementation(() => { throw error })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => cancelCommandSession(editor)).not.toThrow()
    expect(editor.isDrawing).toBe(false)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
    expect(consoleError).toHaveBeenCalledTimes(2)
  })

  test('does not let a cancelled command timer overwrite its successor session', () => {
    vi.useFakeTimers()
    const editor = createEditor()
    editor.mode = 'model'
    let invocation = 0
    commands.HELP.execute = vi.fn((activeEditor) => {
      invocation += 1
      if (invocation === 1) {
        const staleCommand = new Command(activeEditor)
        staleCommand.deferSessionTask(() => {
          activeEditor.selectSingleElement = false
        }, 10)
        return
      }
      activeEditor.selectSingleElement = true
    })

    executeRegisteredCommand(editor, 'help')
    const firstRevision = editor.commandSessionRevision
    executeRegisteredCommand(editor, 'help')
    expect(editor.commandSessionRevision).toBe(firstRevision + 1)
    expect(editor.selectSingleElement).toBe(true)

    vi.advanceTimersByTime(20)
    expect(editor.selectSingleElement).toBe(true)
  })
})
