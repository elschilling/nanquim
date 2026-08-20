// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { initToolbarHandlers } from '../src/js/utils/toolbarHandlers'

const projectPath = (...parts) => join(process.cwd(), ...parts)

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  for (const name of [
    'handleToogleOrtho',
    'handleToogleSnap',
    'handleTogglePolarTracking',
    'toggleSnapMenu',
  ]) delete window[name]
})

describe('center toolbar accessibility', () => {
  test('uses named native controls without invalid image attributes', async () => {
    const canvasTemplate = await readFile(projectPath('src', 'templates', 'Canvas.pug'), 'utf8')

    for (const [id, label, shortcut] of [
      ['ortho-toggle', 'Ortho', 'F8'],
      ['object-snap-toggle', 'Object Snap', 'F9'],
      ['polar-tracking-toggle', 'Polar Tracking', 'F10'],
    ]) {
      expect(canvasTemplate).toContain(`button.icon`)
      expect(canvasTemplate).toContain(`#${id}(type='button'`)
      expect(canvasTemplate).toContain(`aria-label='${label}'`)
      expect(canvasTemplate).toContain(`aria-keyshortcuts='${shortcut}'`)
      expect(canvasTemplate).toContain("aria-pressed='false'")
    }

    expect(canvasTemplate).toContain('button.toolbar-icon-button.toolbar-composite-button#snap-options-button')
    expect(canvasTemplate).toContain("title='Object Snap settings'")
    expect(canvasTemplate).toContain("aria-haspopup='dialog'")
    expect(canvasTemplate).toContain("aria-controls='snap-options-menu'")
    expect(canvasTemplate).toContain("aria-expanded='false'")
    expect(canvasTemplate).toContain(".snap-options-menu#snap-options-menu(role='dialog'")
    expect(canvasTemplate).toContain("span.icon.icon-snap-options(aria-hidden='true')")
    expect(canvasTemplate).toContain("span.icon.icon-dropdown(aria-hidden='true')")
    expect(canvasTemplate).not.toMatch(/\balt\s*=/)
  })

  test('synchronizes toggle and popup state, including outside and Escape close', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <button id="ortho-toggle" class="icon icon-orthomode" aria-pressed="false"></button>
      <button id="object-snap-toggle" class="icon icon-snap-off" aria-pressed="false"></button>
      <button id="snap-options-button" aria-controls="snap-options-menu" aria-expanded="false"></button>
      <div id="snap-options-menu" aria-hidden="true"><input id="snap-option" /></div>
      <button id="polar-tracking-toggle" class="icon icon-polartrack" aria-pressed="false"></button>
    `
    const terminalLogged = { dispatch: vi.fn() }
    const editor = {
      ortho: true,
      isSnapping: false,
      polarTracking: false,
      mode: 'model',
      svg: { fire: vi.fn(), node: document.createElement('div') },
      signals: { terminalLogged },
    }

    initToolbarHandlers(editor)

    const ortho = document.getElementById('ortho-toggle')
    const snap = document.getElementById('object-snap-toggle')
    const polar = document.getElementById('polar-tracking-toggle')
    const menuButton = document.getElementById('snap-options-button')
    const menu = document.getElementById('snap-options-menu')

    expect(ortho.getAttribute('aria-pressed')).toBe('true')
    expect(ortho.classList.contains('is-active')).toBe(true)
    window.handleToogleOrtho()
    expect(editor.ortho).toBe(false)
    expect(ortho.getAttribute('aria-pressed')).toBe('false')
    expect(ortho.classList.contains('is-active')).toBe(false)

    window.handleToogleSnap()
    expect(editor.isSnapping).toBe(true)
    expect(snap.getAttribute('aria-pressed')).toBe('true')
    expect(snap.classList.contains('is-active')).toBe(true)

    window.handleTogglePolarTracking()
    expect(editor.polarTracking).toBe(true)
    expect(polar.getAttribute('aria-pressed')).toBe('true')
    expect(polar.classList.contains('is-active')).toBe(true)

    const terminalKeydown = vi.fn()
    document.addEventListener('keydown', terminalKeydown)
    const activationEvent = new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    menuButton.dispatchEvent(activationEvent)
    expect(terminalKeydown).not.toHaveBeenCalled()
    document.removeEventListener('keydown', terminalKeydown)

    const stopPropagation = vi.fn()
    window.toggleSnapMenu({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(menu.classList.contains('show-menu')).toBe(true)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(menu.getAttribute('aria-hidden')).toBe('false')
    expect(document.activeElement).toBe(document.getElementById('snap-option'))

    vi.runOnlyPendingTimers()
    menuButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menu.classList.contains('show-menu')).toBe(true)

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menu.classList.contains('show-menu')).toBe(false)
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(menu.getAttribute('aria-hidden')).toBe('true')

    window.toggleSnapMenu({ stopPropagation: vi.fn() })
    expect(document.activeElement).toBe(document.getElementById('snap-option'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(menu.classList.contains('show-menu')).toBe(false)
    expect(document.activeElement).toBe(menuButton)
  })
})
