// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import commands, { commandCategories } from '../src/js/commands/_commands'
import {
  TOOL_PALETTE_LABEL_THRESHOLD,
  TOOL_PALETTE_MAX_WIDTH,
  TOOL_PALETTE_MIN_WIDTH,
  TOOL_PALETTE_STORAGE_KEY,
  ToolPalette,
  normalizeStoredState,
} from '../src/js/ToolPalette'

const readProjectFile = (...parts) => readFile(join(process.cwd(), ...parts), 'utf8')

function createSignal() {
  const handlers = new Set()
  return {
    add: vi.fn((handler) => handlers.add(handler)),
    remove: vi.fn((handler) => handlers.delete(handler)),
    dispatch: vi.fn((...args) => handlers.forEach((handler) => handler(...args))),
  }
}

function createEditor() {
  return {
    activeEditor: 'canvas',
    isDrawing: false,
    isInteracting: false,
    isTypingText: false,
    lastCommand: null,
    documentState: { revision: 7, dirty: false },
    history: { undos: [], redos: [] },
    mode: 'model',
    signals: {
      commandCancelled: createSignal(),
      documentSessionReset: createSignal(),
      editorModeChanged: createSignal(),
      terminalLogged: createSignal(),
    },
  }
}

function renderFixture() {
  document.body.innerHTML = `
    <button
      id="command-tool-palette-toggle"
      type="button"
      aria-controls="command-tool-palette"
      aria-expanded="true"
      aria-keyshortcuts="F4"
    >Tools</button>
    <div class="canvas-workspace">
      <nav id="command-tool-palette" class="command-tool-palette" aria-label="Command tools">
        <div id="command-tool-palette-content" class="command-tool-palette-scroll"></div>
      </nav>
      <div
        id="command-tool-palette-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-controls="command-tool-palette"
      ></div>
      <div id="canvas"><input id="terminalInput" type="text"></div>
    </div>
  `
}

function keyboardEvent(key, options = {}) {
  return new KeyboardEvent('keydown', {
    key,
    code: options.code || key,
    bubbles: true,
    cancelable: true,
    ...options,
  })
}

function pointerEvent(type, { pointerId = 3, ...options } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...options,
  })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}

describe('registry-driven command tool palette', () => {
  let editor
  let paletteController

  beforeEach(() => {
    localStorage.clear()
    renderFixture()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    editor = createEditor()
  })

  afterEach(() => {
    paletteController?.dispose()
    paletteController = null
    document.body.replaceChildren()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.clear()
  })

  test('renders every registered command in canonical category order', () => {
    paletteController = new ToolPalette(editor)
    const palette = document.getElementById('command-tool-palette')
    const resizer = document.getElementById('command-tool-palette-resizer')
    const sections = [...palette.querySelectorAll('.command-tool-category')]
    const buttons = [...palette.querySelectorAll('.command-tool-button')]

    const expectedCommandOrder = commandCategories.flatMap((category) => (
      Object.entries(commands)
        .filter(([, command]) => command.category === category)
        .map(([name]) => name)
    ))
    expect(sections.map((section) => section.dataset.category)).toEqual(commandCategories)
    expect(buttons.map((button) => button.dataset.command)).toEqual(expectedCommandOrder)
    expect(buttons).toHaveLength(Object.keys(commands).length)

    buttons.forEach((button) => {
      expect(button.tagName).toBe('BUTTON')
      expect(button.type).toBe('button')
      expect(button.getAttribute('aria-label')).toBeTruthy()
      expect(button.title).toContain(commands[button.dataset.command].description)
      expect(button.querySelector('.command-tool-icon')?.getAttribute('aria-hidden')).toBe('true')
      expect(button.querySelector('.command-tool-icon')?.dataset.commandIcon).toBeTruthy()
      expect(button.querySelector('.command-tool-label')?.textContent).toBeTruthy()
    })

    expect(paletteController.width).toBe(TOOL_PALETTE_MIN_WIDTH)
    expect(palette.classList.contains('is-labeled')).toBe(false)
    expect(resizer.getAttribute('aria-valuemin')).toBe(String(TOOL_PALETTE_MIN_WIDTH))
    expect(resizer.getAttribute('aria-valuemax')).toBe(String(TOOL_PALETTE_MAX_WIDTH))
    expect(resizer.getAttribute('aria-valuenow')).toBe(String(TOOL_PALETTE_MIN_WIDTH))

    paletteController.setWidth(TOOL_PALETTE_LABEL_THRESHOLD - 1)
    expect(palette.classList.contains('is-labeled')).toBe(false)
    paletteController.setWidth(TOOL_PALETTE_LABEL_THRESHOLD)
    expect(palette.classList.contains('is-labeled')).toBe(true)
    expect(resizer.getAttribute('aria-valuetext')).toBe(
      `${TOOL_PALETTE_LABEL_THRESHOLD} pixels, icons and tool names`,
    )
  })

  test('disables commands outside the active Model or Paper contract', () => {
    paletteController = new ToolPalette(editor)
    const button = (name) => document.querySelector(`[data-command="${name}"]`)

    expect(button('BLOCK').disabled).toBe(false)
    expect(button('VIEWPORT').disabled).toBe(true)
    expect(button('VIEWPORT').getAttribute('aria-disabled')).toBe('true')
    expect(button('VIEWPORT').title).toContain('unavailable in Model Space')

    editor.mode = 'paper'
    editor.signals.editorModeChanged.dispatch('paper')

    expect(button('VIEWPORT').disabled).toBe(false)
    expect(button('LINE').disabled).toBe(false)
    expect(button('BLOCK').disabled).toBe(true)
    expect(button('BLOCK').title).toContain('unavailable in Paper Space')

    editor.mode = 'model'
    editor.signals.editorModeChanged.dispatch('model')
    expect(button('BLOCK').disabled).toBe(false)
    expect(button('BLOCK').title).not.toContain('unavailable')
  })

  test('is wired into the real canvas layout, composition root, styles, and shortcut docs', async () => {
    const [canvas, navbar, main, mainStyles, paletteStyles, help, readme] = await Promise.all([
      readProjectFile('src', 'templates', 'Canvas.pug'),
      readProjectFile('src', 'templates', 'NavBar.pug'),
      readProjectFile('src', 'main.js'),
      readProjectFile('src', 'styles', 'main.sass'),
      readProjectFile('src', 'styles', 'components', '_tool-palette.sass'),
      readProjectFile('src', 'js', 'HelpSession.js'),
      readProjectFile('README.md'),
    ])

    const palettePosition = canvas.indexOf('nav.command-tool-palette#command-tool-palette')
    const resizerPosition = canvas.indexOf('.command-tool-palette-resizer#command-tool-palette-resizer')
    const canvasPosition = canvas.indexOf('.layout-editor#canvas')

    expect(canvas).toContain('.canvas-workspace')
    expect(palettePosition).toBeGreaterThan(-1)
    expect(resizerPosition).toBeGreaterThan(palettePosition)
    expect(canvasPosition).toBeGreaterThan(resizerPosition)
    expect(navbar).toContain('#command-tool-palette-toggle')
    expect(navbar).toContain("aria-keyshortcuts='F4'")
    expect(main).toContain("import { ToolPalette } from './js/ToolPalette'")
    expect(main).toContain('const toolPalette = new ToolPalette(editor)')
    expect(main).toContain('editor.toolPalette = toolPalette')
    expect(mainStyles).toContain("@use 'components/tool-palette'")
    expect(paletteStyles).toContain("url('/assets/img/nanquim-command-icons.svg')")
    expect(paletteStyles).toContain('.command-tool-palette.is-labeled')
    expect(help).toContain("keys: ['F4'], description: 'Show or hide the command tools palette.'")
    expect(readme).toContain('`F4`')
  })

  test('restores safe local state and returns focus to the external toggle when hidden', () => {
    localStorage.setItem(TOOL_PALETTE_STORAGE_KEY, JSON.stringify({ width: 214, visible: true }))
    paletteController = new ToolPalette(editor)

    const palette = document.getElementById('command-tool-palette')
    const resizer = document.getElementById('command-tool-palette-resizer')
    const toggle = document.getElementById('command-tool-palette-toggle')
    const firstTool = palette.querySelector('.command-tool-button')

    expect(paletteController.width).toBe(214)
    expect(palette.classList.contains('is-labeled')).toBe(true)
    firstTool.focus()
    paletteController.setVisible(false)

    expect(palette.hidden).toBe(true)
    expect(resizer.hidden).toBe(true)
    expect(palette.getAttribute('aria-hidden')).toBe('true')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-keyshortcuts')).toBe('F4')
    expect(document.activeElement).toBe(toggle)
    expect(JSON.parse(localStorage.getItem(TOOL_PALETTE_STORAGE_KEY))).toEqual({
      width: 214,
      visible: false,
    })

    toggle.click()
    expect(palette.hidden).toBe(false)
    expect(resizer.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(paletteController.width).toBe(214)
  })

  test('normalizes malformed, non-finite, and out-of-range stored widths', () => {
    expect(normalizeStoredState(null)).toEqual({ width: TOOL_PALETTE_MIN_WIDTH, visible: true })
    expect(normalizeStoredState({ width: 'not-a-number', visible: 'no' })).toEqual({
      width: TOOL_PALETTE_MIN_WIDTH,
      visible: true,
    })
    expect(normalizeStoredState({ width: Number.POSITIVE_INFINITY, visible: false })).toEqual({
      width: TOOL_PALETTE_MIN_WIDTH,
      visible: false,
    })
    expect(normalizeStoredState({ width: -100, visible: true }).width).toBe(TOOL_PALETTE_MIN_WIDTH)
    expect(normalizeStoredState({ width: 999, visible: true }).width).toBe(TOOL_PALETTE_MAX_WIDTH)

    const unavailableStorage = {
      getItem: vi.fn(() => { throw new Error('denied') }),
      setItem: vi.fn(() => { throw new Error('denied') }),
    }
    expect(() => {
      paletteController = new ToolPalette(editor, { storage: unavailableStorage })
      paletteController.setWidth(200, { persist: true })
      paletteController.setVisible(false)
    }).not.toThrow()
  })

  test('supports clamped keyboard and pointer resizing with cleanup and final persistence', () => {
    paletteController = new ToolPalette(editor)
    const palette = document.getElementById('command-tool-palette')
    const resizer = document.getElementById('command-tool-palette-resizer')
    resizer.setPointerCapture = vi.fn()
    resizer.hasPointerCapture = vi.fn(() => false)

    const end = keyboardEvent('End')
    resizer.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(true)
    expect(paletteController.width).toBe(TOOL_PALETTE_MAX_WIDTH)
    expect(palette.classList.contains('is-labeled')).toBe(true)

    const home = keyboardEvent('Home')
    resizer.dispatchEvent(home)
    expect(paletteController.width).toBe(TOOL_PALETTE_MIN_WIDTH)

    resizer.focus()
    const modifierLeak = vi.fn()
    document.addEventListener('keydown', modifierLeak)
    const shiftDown = keyboardEvent('Shift', { code: 'ShiftLeft', shiftKey: true })
    resizer.dispatchEvent(shiftDown)
    expect(modifierLeak).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(resizer)
    const largeStep = keyboardEvent('ArrowRight', { shiftKey: true })
    resizer.dispatchEvent(largeStep)
    expect(paletteController.width).toBe(TOOL_PALETTE_MIN_WIDTH + 32)
    expect(resizer.getAttribute('aria-valuetext')).toBe(
      `${TOOL_PALETTE_MIN_WIDTH + 32} pixels, icons only`,
    )
    document.removeEventListener('keydown', modifierLeak)

    const downstreamKeydown = vi.fn()
    document.addEventListener('keydown', downstreamKeydown)
    resizer.dispatchEvent(keyboardEvent('Tab'))
    expect(downstreamKeydown).not.toHaveBeenCalled()
    const separatorSpace = keyboardEvent(' ', { code: 'Space' })
    resizer.dispatchEvent(separatorSpace)
    expect(separatorSpace.defaultPrevented).toBe(true)
    expect(downstreamKeydown).not.toHaveBeenCalled()
    const separatorEnter = keyboardEvent('Enter')
    resizer.dispatchEvent(separatorEnter)
    expect(separatorEnter.defaultPrevented).toBe(true)
    expect(downstreamKeydown).not.toHaveBeenCalled()
    document.removeEventListener('keydown', downstreamKeydown)

    document.body.style.cursor = 'wait'
    document.body.style.userSelect = 'text'
    resizer.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, button: 0 }))
    expect(resizer.classList.contains('is-resizing')).toBe(true)
    expect(document.body.style.cursor).toBe('col-resize')
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 350 }))
    expect(paletteController.width).toBe(TOOL_PALETTE_MAX_WIDTH)
    window.dispatchEvent(pointerEvent('pointerup', { clientX: 350 }))

    expect(resizer.classList.contains('is-resizing')).toBe(false)
    expect(document.body.style.cursor).toBe('wait')
    expect(document.body.style.userSelect).toBe('text')
    expect(JSON.parse(localStorage.getItem(TOOL_PALETTE_STORAGE_KEY)).width).toBe(TOOL_PALETTE_MAX_WIDTH)

    paletteController.setWidth(200)
    resizer.dispatchEvent(pointerEvent('pointerdown', { clientX: 200, button: 0, pointerId: 8 }))
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 100, pointerId: 8 }))
    expect(paletteController.width).toBe(100)
    window.dispatchEvent(pointerEvent('pointercancel', { clientX: 100, pointerId: 8 }))
    expect(paletteController.width).toBe(200)
    expect(resizer.classList.contains('is-resizing')).toBe(false)
  })

  test('uses F4 once without modifiers, ignores modal surfaces, and never cancels a command', () => {
    paletteController = new ToolPalette(editor)
    const palette = document.getElementById('command-tool-palette')
    const initialDocumentState = { ...editor.documentState }

    editor.isDrawing = true
    const hide = keyboardEvent('F4', { code: 'F4' })
    document.dispatchEvent(hide)
    expect(hide.defaultPrevented).toBe(true)
    expect(palette.hidden).toBe(true)
    expect(editor.signals.commandCancelled.dispatch).not.toHaveBeenCalled()
    expect(editor.documentState).toEqual(initialDocumentState)
    expect(editor.history).toEqual({ undos: [], redos: [] })

    document.dispatchEvent(keyboardEvent('F4', { code: 'F4', repeat: true }))
    document.dispatchEvent(keyboardEvent('F4', { code: 'F4', ctrlKey: true }))
    expect(palette.hidden).toBe(true)

    const modal = document.createElement('div')
    modal.className = 'block-modal-overlay'
    document.body.appendChild(modal)
    document.dispatchEvent(keyboardEvent('F4', { code: 'F4' }))
    expect(palette.hidden).toBe(true)

    modal.remove()
    document.dispatchEvent(keyboardEvent('F4', { code: 'F4' }))
    expect(palette.hidden).toBe(false)
    expect(editor.signals.commandCancelled.dispatch).not.toHaveBeenCalled()
  })

  test('routes command buttons through the shared execution contract and preserves native keys', () => {
    const executeCommand = vi.fn(() => true)
    paletteController = new ToolPalette(editor, { executeCommand })
    const line = document.querySelector('[data-command="LINE"]')
    const terminal = document.getElementById('terminalInput')
    const downstreamKeydown = vi.fn()
    document.addEventListener('keydown', downstreamKeydown)

    line.click()
    expect(executeCommand).toHaveBeenCalledOnce()
    expect(executeCommand).toHaveBeenCalledWith(editor, 'LINE')
    expect(document.activeElement).toBe(terminal)

    line.focus()
    const space = keyboardEvent(' ', { code: 'Space' })
    line.dispatchEvent(space)
    expect(space.defaultPrevented).toBe(false)
    expect(downstreamKeydown).not.toHaveBeenCalled()
    document.removeEventListener('keydown', downstreamKeydown)
  })

  test('defaults to the same registered-command dispatcher used by Terminal', () => {
    editor.helpSession = { open: vi.fn() }
    paletteController = new ToolPalette(editor)

    document.querySelector('[data-command="HELP"]').click()

    expect(editor.signals.commandCancelled.dispatch).toHaveBeenCalledOnce()
    expect(editor.helpSession.open).toHaveBeenCalledOnce()
    expect(editor.lastCommand?.execute).toBeTypeOf('function')
    editor.lastCommand.execute()
    expect(editor.helpSession.open).toHaveBeenCalledTimes(2)
  })
})
