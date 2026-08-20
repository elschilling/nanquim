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
  return {
    activeEditor: 'canvas',
    isInteracting: false,
    isDrawing: false,
    isTypingText: false,
    selected: [],
    previousSelection: [],
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
  })

  beforeEach(() => {
    editor.activeEditor = 'canvas'
    editor.isInteracting = false
    editor.isDrawing = false
    editor.isTypingText = false
    editor.lastCommand = null
    editor.signals.inputValue.dispatch.mockClear()

    terminalLog.replaceChildren()
    terminalInput.value = ''
    terminalInput.dispatchEvent(new Event('input', { bubbles: true }))
    terminalInput.focus()
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
