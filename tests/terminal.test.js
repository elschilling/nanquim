// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { Terminal } from '../src/js/Terminal.js'

function createSignal() {
  return {
    add: vi.fn(),
    addOnce: vi.fn(),
    remove: vi.fn(),
    dispatch: vi.fn(),
  }
}

function createEditor() {
  const documentSnapshot = {
    sessionId: 1,
    revision: 0,
    savedRevision: 0,
    name: null,
    handle: null,
  }
  return {
    activeEditor: 'canvas',
    isInteracting: false,
    isDrawing: false,
    isTypingText: false,
    commandSessionRevision: 0,
    selected: [],
    previousSelection: [],
    execute: vi.fn(),
    documentSnapshot,
    documentState: {
      createSaveToken: vi.fn(() => Object.freeze({
        sessionId: documentSnapshot.sessionId,
        revision: documentSnapshot.revision,
        name: documentSnapshot.name,
        handle: documentSnapshot.handle,
      })),
      flushObservedMutations: vi.fn(),
      snapshot: vi.fn(() => ({ ...documentSnapshot })),
    },
    signals: new Proxy({}, {
      get(target, key) {
        if (!target[key]) target[key] = createSignal()
        return target[key]
      },
    }),
  }
}

function pressSpace(target) {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

function pressShortcut(key, options = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: true,
    shiftKey: options.shiftKey === true,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  return event
}

describe('Terminal Space confirmation', () => {
  let editor
  let terminalInput
  let terminalLog
  let foreignInput
  const documentListeners = []

  beforeAll(() => {
    document.body.innerHTML = `
      <div class="terminal">
        <div id="terminalLog"></div>
        <input id="terminalInput" type="text">
        <div id="terminalAutocomplete"></div>
      </div>
      <input id="foreignInput" class="property-input" type="text">
    `

    terminalInput = document.getElementById('terminalInput')
    terminalLog = document.getElementById('terminalLog')
    foreignInput = document.getElementById('foreignInput')
    editor = createEditor()

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(),
        writeText: vi.fn(() => Promise.resolve()),
      },
    })

    // Terminal currently installs document-level listeners for the application
    // lifetime. Capture them so this focused unit suite leaves jsdom isolated.
    const addDocumentListener = document.addEventListener.bind(document)
    const addListenerSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      documentListeners.push({ type, listener, options })
      addDocumentListener(type, listener, options)
    })
    Terminal(editor)
    addListenerSpy.mockRestore()
  })

  afterAll(() => {
    documentListeners.forEach(({ type, listener, options }) => {
      document.removeEventListener(type, listener, options)
    })
    delete window.newDocument
    delete window.openSVG
    delete window.saveSVG
    delete window.saveAsSVG
  })

  beforeEach(() => {
    editor.activeEditor = 'canvas'
    editor.isInteracting = false
    editor.isDrawing = false
    editor.isTypingText = false
    editor.lastCommand = null
    editor.commandSessionRevision = 0
    editor.execute.mockClear()
    Object.assign(editor.documentSnapshot, {
      sessionId: 1,
      revision: 0,
      savedRevision: 0,
      name: null,
      handle: null,
    })
    editor.documentState.createSaveToken.mockClear()
    editor.documentState.flushObservedMutations.mockClear()
    editor.documentState.snapshot.mockClear()
    navigator.clipboard.readText.mockReset()
    navigator.clipboard.writeText.mockClear()
    editor.signals.inputValue.dispatch.mockClear()
    window.newDocument = vi.fn()
    window.openSVG = vi.fn()
    window.saveSVG = vi.fn()
    window.saveAsSVG = vi.fn()

    terminalLog.replaceChildren()
    terminalInput.value = ''
    terminalInput.dispatchEvent(new Event('input', { bubbles: true }))
    terminalInput.focus()
  })

  test('routes New, Open, Save, and Save As through their distinct file actions', () => {
    expect(pressShortcut('n').defaultPrevented).toBe(true)
    expect(pressShortcut('o').defaultPrevented).toBe(true)
    expect(pressShortcut('s').defaultPrevented).toBe(true)
    expect(pressShortcut('s', { shiftKey: true }).defaultPrevented).toBe(true)

    expect(window.newDocument).toHaveBeenCalledOnce()
    expect(window.openSVG).toHaveBeenCalledOnce()
    expect(window.saveSVG).toHaveBeenCalledOnce()
    expect(window.saveAsSVG).toHaveBeenCalledOnce()
  })

  test('discards an asynchronous clipboard read after the document session changes', async () => {
    let resolveClipboard
    navigator.clipboard.readText.mockReturnValue(new Promise((resolve) => {
      resolveClipboard = resolve
    }))

    expect(pressShortcut('v').defaultPrevented).toBe(true)
    expect(editor.documentState.createSaveToken).toHaveBeenCalledOnce()

    editor.documentSnapshot.sessionId = 2
    resolveClipboard(JSON.stringify({
      nanquimClipboard: true,
      elements: [{ svg: '<line x1="0" y1="0" x2="1" y2="1" />' }],
    }))
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.documentState.flushObservedMutations).toHaveBeenCalledOnce()
    expect(editor.execute).not.toHaveBeenCalled()
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span',
      msg: 'Paste cancelled because the document or command session changed.',
    })
  })

  test('discards an asynchronous clipboard read after another command session starts', async () => {
    let resolveClipboard
    navigator.clipboard.readText.mockReturnValue(new Promise((resolve) => {
      resolveClipboard = resolve
    }))

    expect(pressShortcut('v').defaultPrevented).toBe(true)
    terminalInput.value = '?'
    expect(pressSpace(terminalInput).defaultPrevented).toBe(true)
    expect(editor.commandSessionRevision).toBe(1)
    resolveClipboard(JSON.stringify({
      nanquimClipboard: true,
      elements: [{ svg: '<line x1="0" y1="0" x2="1" y2="1" />' }],
    }))
    await Promise.resolve()
    await Promise.resolve()

    expect(editor.execute).not.toHaveBeenCalled()
    expect(editor.documentState.snapshot).not.toHaveBeenCalled()
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      type: 'span',
      msg: 'Paste cancelled because the document or command session changed.',
    })
  })

  test('clears pending input and autocomplete when the document session changes', () => {
    const logEntry = editor.signals.terminalLogged.add.mock.calls[0][0]
    const resetSession = editor.signals.documentSessionReset.add.mock.calls[0][0]
    logEntry({ type: 'span', msg: 'Width: ', recordInput: true })
    const prompt = terminalLog.lastElementChild

    terminalInput.value = 'rec'
    terminalInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(document.getElementById('terminalAutocomplete').classList.contains('visible')).toBe(true)

    resetSession()
    expect(terminalInput.value).toBe('')
    expect(document.getElementById('terminalAutocomplete').classList.contains('visible')).toBe(false)

    editor.isInteracting = true
    terminalInput.value = '42'
    pressSpace(terminalInput)
    expect(prompt.textContent).toBe('Width: ')
  })

  test('blank Space repeats the last CAD command from the focused terminal input', () => {
    const execute = vi.fn()
    editor.lastCommand = { execute }

    const event = pressSpace(terminalInput)

    expect(event.defaultPrevented).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
    expect(terminalInput.value).toBe('')
  })

  test('Space confirms an interactive numeric value like Enter', () => {
    editor.isInteracting = true
    terminalInput.value = '42.5'

    const event = pressSpace(terminalInput)

    expect(event.defaultPrevented).toBe(true)
    expect(editor.signals.inputValue.dispatch).toHaveBeenCalledWith('42.5')
    expect(terminalInput.value).toBe('')
  })

  test('records confirmed input on a terminal prompt that requests it', () => {
    const logEntry = editor.signals.terminalLogged.add.mock.calls[0][0]
    logEntry({ type: 'span', msg: 'Width: ', recordInput: true })
    editor.isInteracting = true
    terminalInput.value = '42.5'

    pressSpace(terminalInput)

    expect(terminalLog.lastElementChild.textContent).toBe('Width: 42.5')
  })

  test('Space remains native literal input while a text command is typing', () => {
    editor.isInteracting = true
    editor.isTypingText = true
    terminalInput.value = 'hello'

    const event = pressSpace(terminalInput)

    expect(event.defaultPrevented).toBe(false)
    expect(editor.signals.inputValue.dispatch).not.toHaveBeenCalled()
  })

  test('Space is not intercepted when a non-terminal editable field has focus', () => {
    editor.isInteracting = true
    terminalInput.value = '42.5'
    foreignInput.focus()

    const event = pressSpace(foreignInput)

    expect(event.defaultPrevented).toBe(false)
    expect(editor.signals.inputValue.dispatch).not.toHaveBeenCalled()
    expect(terminalInput.value).toBe('42.5')
  })
})
