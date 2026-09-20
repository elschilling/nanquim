// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { Navbar } from '../src/js/Navbar.js'

describe('Navbar document actions', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="dropdown-menu show-menu"></div>'
  })

  afterEach(() => {
    for (const name of [
      'newDocument',
      'openSVG',
      'saveSVG',
      'saveAsSVG',
      'exportSVG',
      'saveDXF',
      'welcomeScreen',
    ]) delete window[name]
    window.onclick = null
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('delegates native document actions to the canonical controller', async () => {
    const documents = {
      newDocument: vi.fn(async () => ({ ok: true })),
      open: vi.fn(async () => ({ ok: true })),
      save: vi.fn(async () => ({ ok: true })),
      saveAs: vi.fn(async () => ({ ok: true })),
      exportSvg: vi.fn(async () => ({ ok: true })),
    }
    Navbar({ documents })

    await window.newDocument()
    await window.openSVG()
    await window.saveSVG()
    await window.saveAsSVG()
    await window.exportSVG()

    expect(documents.newDocument).toHaveBeenCalledOnce()
    expect(documents.open).toHaveBeenCalledOnce()
    expect(documents.save).toHaveBeenCalledOnce()
    expect(documents.saveAs).toHaveBeenCalledOnce()
    expect(documents.exportSvg).toHaveBeenCalledOnce()
  })

  test('delegates directly when no Welcome overlay is active', async () => {
    const documents = {
      newDocument: vi.fn(async () => ({ ok: true })),
      open: vi.fn(async () => ({ ok: true })),
    }
    const runDocumentAction = vi.fn()
    window.welcomeScreen = {
      isVisible: vi.fn(() => false),
      runDocumentAction,
    }
    Navbar({ documents })

    await window.newDocument()
    await window.openSVG()

    expect(documents.newDocument).toHaveBeenCalledOnce()
    expect(documents.open).toHaveBeenCalledOnce()
    expect(runDocumentAction).not.toHaveBeenCalled()
  })

  test('requires the controller to exist before installing file actions', () => {
    expect(() => Navbar({})).toThrow('DocumentController must be initialized')
  })

  test('opens Welcome from the logo without invoking a document action or terminal keys', () => {
    document.body.innerHTML = '<button id="navbar-welcome-open" type="button">Nanquim</button>'
    const show = vi.fn()
    const newDocument = vi.fn()
    window.welcomeScreen = { show }
    Navbar({ documents: { newDocument } })
    const button = document.getElementById('navbar-welcome-open')
    const terminalInput = vi.fn()
    document.addEventListener('keydown', terminalInput)

    button.click()
    for (const key of ['Enter', ' ']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }

    expect(show).toHaveBeenCalledTimes(3)
    expect(newDocument).not.toHaveBeenCalled()
    expect(terminalInput).not.toHaveBeenCalled()
    document.removeEventListener('keydown', terminalInput)
  })
})
