// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Navbar } from '../src/js/Navbar.js'
import { WelcomeScreen } from '../src/js/WelcomeScreen'

const screens = []

afterEach(() => {
  for (const screen of screens.splice(0)) {
    const overlay = screen._overlay
    screen.dismiss()
    if (overlay) finishDismissal(overlay)
  }
})

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function createWelcomeScreen({ documents = {}, recentFiles = [] } = {}) {
  const editor = {
    currentFileHandle: { name: 'current.svg' },
    currentFileName: 'current.svg',
    documents: {
      newDocument: vi.fn(async () => ({ ok: true })),
      open: vi.fn(async () => ({ ok: true })),
      openFile: vi.fn(async () => ({ ok: true, kind: 'native' })),
      ...documents,
    },
    signals: { terminalLogged: { dispatch: vi.fn() } },
  }
  const welcomeScreen = new WelcomeScreen(editor, {
    getRecentFiles: vi.fn(async () => recentFiles),
  })
  screens.push(welcomeScreen)
  await vi.waitFor(() => expect(document.querySelector('#welcome-overlay')).not.toBeNull())
  return { editor, welcomeScreen }
}

function finishDismissal(overlay) {
  overlay.dispatchEvent(new Event('animationend', { bubbles: true }))
}

describe('WelcomeScreen document actions', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('New awaits the controller and dismisses only after success', async () => {
    const pending = deferred()
    const newDocument = vi.fn(() => pending.promise)
    const { welcomeScreen } = await createWelcomeScreen({ documents: { newDocument } })
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('#ws-new').click()
    expect(newDocument).toHaveBeenCalledTimes(1)
    expect(overlay.classList.contains('ws-fade-out')).toBe(false)

    pending.resolve({ ok: true })
    await vi.waitFor(() => expect(overlay.classList.contains('ws-fade-out')).toBe(true))
    expect(welcomeScreen._overlay).toBe(overlay)

    finishDismissal(overlay)
    expect(welcomeScreen._overlay).toBeNull()
  })

  test('renders adversarial recent filenames as inert text and attribute content', async () => {
    const name = '"><img id="recent-file-injection" src="x" onerror="alert(1)"><span title="'
    await createWelcomeScreen({
      recentFiles: [{ id: 'recent-1', name, handle: {}, timestamp: 1 }],
    })

    const item = document.querySelector('.ws-recent-item')
    expect(item.title).toBe(name)
    expect(item.querySelector('.ws-recent-name').textContent).toBe(name)
    expect(document.querySelector('#recent-file-injection')).toBeNull()
    expect(item.querySelector('[onerror]')).toBeNull()
  })

  test.each([
    ['cancellation', { ok: false, cancelled: true }],
    ['failure', { ok: false, error: new Error('open failed') }],
  ])('Open keeps the welcome screen visible after %s', async (_label, result) => {
    const open = vi.fn(async () => result)
    const { welcomeScreen } = await createWelcomeScreen({ documents: { open } })
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('#ws-open').click()
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    expect(overlay.classList.contains('ws-fade-out')).toBe(false)
    expect(overlay.isConnected).toBe(true)
    expect(welcomeScreen._overlay).toBe(overlay)
  })

  test('unexpected controller rejection is reported without dismissing', async () => {
    const open = vi.fn(async () => { throw new Error('unexpected') })
    const { editor } = await createWelcomeScreen({ documents: { open } })
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('#ws-open').click()
    await vi.waitFor(() => expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'Could not open a drawing.',
    }))

    expect(overlay.classList.contains('ws-fade-out')).toBe(false)
    expect(overlay.isConnected).toBe(true)
  })

  test('a newer document action supersedes an earlier pending action', async () => {
    const pendingOpen = deferred()
    const open = vi.fn(() => pendingOpen.promise)
    const newDocument = vi.fn(async () => ({ ok: true, kind: 'native' }))
    const { welcomeScreen } = await createWelcomeScreen({
      documents: { open, newDocument },
    })
    const overlay = document.querySelector('#welcome-overlay')

    const opening = welcomeScreen.runDocumentAction(
      () => open(),
      'Could not open a drawing.',
    )
    const creating = welcomeScreen.runDocumentAction(
      () => newDocument(),
      'Could not create a new drawing.',
    )

    await expect(creating).resolves.toMatchObject({ ok: true })
    expect(open).toHaveBeenCalledTimes(1)
    expect(newDocument).toHaveBeenCalledTimes(1)
    expect(overlay.classList.contains('ws-fade-out')).toBe(true)

    pendingOpen.resolve({ ok: true, kind: 'native' })
    await expect(opening).resolves.toMatchObject({ ok: true })
    expect(welcomeScreen._dismissState?.overlay).toBe(overlay)
  })

  test('recent file permission and Open complete before dismissal without preassigning a handle', async () => {
    const currentHandle = { name: 'current.svg' }
    const file = { name: 'recent.svg', type: 'image/svg+xml' }
    const recentHandle = {
      getFile: vi.fn(async () => file),
      name: 'recent.svg',
      queryPermission: vi.fn(async () => 'granted'),
      requestPermission: vi.fn(async () => 'granted'),
    }
    const recent = { id: 'recent-1', name: 'recent.svg', handle: recentHandle, timestamp: 1 }
    const opened = deferred()
    let editor
    const openFile = vi.fn((_file, _options) => {
      expect(editor.currentFileHandle).toBe(currentHandle)
      expect(editor.currentFileName).toBe('current.svg')
      return opened.promise
    })
    const created = await createWelcomeScreen({
      documents: { openFile },
      recentFiles: [recent],
    })
    editor = created.editor
    editor.currentFileHandle = currentHandle
    const { welcomeScreen } = created
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('.ws-recent-item').click()
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(file, { handle: recentHandle }))
    expect(recentHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(recentHandle.requestPermission).not.toHaveBeenCalled()
    expect(overlay.classList.contains('ws-fade-out')).toBe(false)

    opened.resolve({ ok: true, kind: 'native' })
    await vi.waitFor(() => expect(overlay.classList.contains('ws-fade-out')).toBe(true))
    finishDismissal(overlay)
    expect(welcomeScreen._overlay).toBeNull()
  })

  test('opens a readable recent file without requesting denied write access', async () => {
    const file = { name: 'read-only.svg', type: 'image/svg+xml' }
    const recentHandle = {
      getFile: vi.fn(async () => file),
      name: 'read-only.svg',
      queryPermission: vi.fn(async ({ mode }) => mode === 'read' ? 'granted' : 'denied'),
      requestPermission: vi.fn(async ({ mode }) => mode === 'read' ? 'granted' : 'denied'),
    }
    const openFile = vi.fn(async () => ({ ok: true, kind: 'native' }))
    const { welcomeScreen } = await createWelcomeScreen({
      documents: { openFile },
      recentFiles: [{ id: 'recent-read-only', name: file.name, handle: recentHandle }],
    })
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('.ws-recent-item').click()
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(file, { handle: recentHandle }))

    expect(recentHandle.queryPermission).toHaveBeenCalledTimes(1)
    expect(recentHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(recentHandle.queryPermission).not.toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(recentHandle.requestPermission).not.toHaveBeenCalled()
    finishDismissal(overlay)
    expect(welcomeScreen._overlay).toBeNull()
  })

  test('recent permission denial keeps the overlay and does not call Open', async () => {
    const recentHandle = {
      getFile: vi.fn(),
      name: 'recent.svg',
      queryPermission: vi.fn(async () => 'prompt'),
      requestPermission: vi.fn(async () => 'denied'),
    }
    const openFile = vi.fn()
    const { editor, welcomeScreen } = await createWelcomeScreen({
      documents: { openFile },
      recentFiles: [{ id: 'recent-1', name: 'recent.svg', handle: recentHandle }],
    })
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('.ws-recent-item').click()
    await vi.waitFor(() => expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'Access to recent.svg was not granted.',
    }))

    expect(openFile).not.toHaveBeenCalled()
    expect(recentHandle.getFile).not.toHaveBeenCalled()
    expect(recentHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(recentHandle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(overlay.classList.contains('ws-fade-out')).toBe(false)
    expect(welcomeScreen._overlay).toBe(overlay)
  })

  test.each([
    ['cancellation', { ok: false, cancelled: true }],
    ['failure', { ok: false, error: new Error('unsafe document') }],
  ])('recent Open %s keeps the overlay visible', async (_label, result) => {
    const file = { name: 'recent.svg', type: 'image/svg+xml' }
    const recentHandle = {
      getFile: vi.fn(async () => file),
      name: 'recent.svg',
      queryPermission: vi.fn(async () => 'granted'),
    }
    const openFile = vi.fn(async () => result)
    const { welcomeScreen } = await createWelcomeScreen({
      documents: { openFile },
      recentFiles: [{ id: 'recent-1', name: 'recent.svg', handle: recentHandle }],
    })
    const overlay = document.querySelector('#welcome-overlay')

    overlay.querySelector('.ws-recent-item').click()
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    expect(overlay.classList.contains('ws-fade-out')).toBe(false)
    expect(overlay.isConnected).toBe(true)
    expect(welcomeScreen._overlay).toBe(overlay)
  })
})

describe('WelcomeScreen Navbar integration', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
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

  test.each([
    ['New', 'newDocument', 'newDocument', { ok: true }, true],
    ['New cancellation', 'newDocument', 'newDocument', { ok: false, cancelled: true }, false],
    ['New failure', 'newDocument', 'newDocument', { ok: false, error: new Error('new failed') }, false],
    ['Open', 'open', 'openSVG', { ok: true }, true],
    ['Open cancellation', 'open', 'openSVG', { ok: false, cancelled: true }, false],
    ['Open failure', 'open', 'openSVG', { ok: false, error: new Error('open failed') }, false],
  ])('%s through the global entry point dismisses only after success', async (
    _label,
    method,
    entryPoint,
    result,
    dismisses,
  ) => {
    const pending = deferred()
    const action = vi.fn(() => pending.promise)
    const { editor, welcomeScreen } = await createWelcomeScreen({
      documents: { [method]: action },
    })
    window.welcomeScreen = welcomeScreen
    Navbar(editor)
    const overlay = document.querySelector('#welcome-overlay')

    const running = window[entryPoint]()
    expect(action).toHaveBeenCalledTimes(1)
    expect(overlay.classList.contains('ws-fade-out')).toBe(false)

    pending.resolve(result)
    await expect(running).resolves.toBe(result)
    expect(overlay.classList.contains('ws-fade-out')).toBe(dismisses)
    expect(overlay.isConnected).toBe(true)

    if (!dismisses) welcomeScreen.dismiss()
    finishDismissal(overlay)
    expect(welcomeScreen._overlay).toBeNull()
  })
})

describe('WelcomeScreen dismissal', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  test('coalesces repeated dismissals after a successful file action', async () => {
    const { welcomeScreen, editor } = await createWelcomeScreen()
    const overlay = document.querySelector('#welcome-overlay')
    const dialog = overlay.querySelector('#ws-dialog')
    const completion = vi.fn()
    const runtimeErrors = vi.fn()
    window.addEventListener('error', runtimeErrors)

    overlay.querySelector('#ws-open').click()
    await vi.waitFor(() => expect(overlay.classList.contains('ws-fade-out')).toBe(true))
    welcomeScreen.dismiss(completion)

    expect(editor.documents.open).toHaveBeenCalledTimes(1)
    expect(overlay.isConnected).toBe(true)

    // The dialog has its own entrance animation. Its bubbling event must not
    // complete the overlay's fade-out or consume the overlay listener.
    dialog.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(overlay.isConnected).toBe(true)
    expect(welcomeScreen._overlay).toBe(overlay)

    finishDismissal(overlay)

    expect(runtimeErrors).not.toHaveBeenCalled()
    expect(completion).toHaveBeenCalledTimes(1)
    expect(overlay.isConnected).toBe(false)
    expect(welcomeScreen._overlay).toBeNull()
    window.removeEventListener('error', runtimeErrors)
  })

  test('treats a delayed dismissal of an already removed overlay as complete', async () => {
    const { welcomeScreen } = await createWelcomeScreen()
    const overlay = document.querySelector('#welcome-overlay')

    welcomeScreen.dismiss()
    finishDismissal(overlay)

    const completion = vi.fn()
    expect(() => welcomeScreen.dismiss(completion)).not.toThrow()
    expect(completion).toHaveBeenCalledTimes(1)
    expect(welcomeScreen._overlay).toBeNull()
  })

  test('finishes a pending dismissal if another owner removes the overlay', async () => {
    const { welcomeScreen } = await createWelcomeScreen()
    const overlay = document.querySelector('#welcome-overlay')
    const firstCompletion = vi.fn()
    const delayedCompletion = vi.fn()

    welcomeScreen.dismiss(firstCompletion)
    overlay.remove()
    welcomeScreen.dismiss(delayedCompletion)

    expect(firstCompletion).toHaveBeenCalledTimes(1)
    expect(delayedCompletion).toHaveBeenCalledTimes(1)
    expect(welcomeScreen._overlay).toBeNull()
    expect(welcomeScreen._dismissState).toBeNull()
  })
})

describe('WelcomeScreen reopening and keyboard access', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="logo">Open welcome screen</button>'
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('reopens with current recent files, dated history, and a focusable close button', async () => {
    const logo = document.getElementById('logo')
    logo.focus()
    const { welcomeScreen, editor } = await createWelcomeScreen()
    expect(document.querySelector('#ws-dialog').getAttribute('aria-modal')).toBe('true')
    expect(document.querySelector('#ws-dialog').getAttribute('role')).toBe('dialog')
    expect(document.querySelectorAll('#ws-changelog time').length).toBeGreaterThan(0)
    expect(document.activeElement.id).toBe('ws-dismiss')
    welcomeScreen.dismiss()
    finishDismissal(welcomeScreen._overlay)
    expect(document.activeElement).toBe(logo)

    welcomeScreen._getRecentFiles.mockResolvedValue([{ name: 'recent.svg', timestamp: 1, handle: {} }])
    await welcomeScreen.show()
    expect(document.querySelector('.ws-recent-item').tagName).toBe('BUTTON')
    expect(document.querySelector('.ws-recent-name').textContent).toBe('recent.svg')
    expect(editor.documents.newDocument).not.toHaveBeenCalled()
    expect(editor.documents.open).not.toHaveBeenCalled()
  })

  test('coalesces requests while recent files load and tolerates unavailable storage', async () => {
    const { welcomeScreen } = await createWelcomeScreen()
    welcomeScreen.dismiss()
    finishDismissal(welcomeScreen._overlay)
    const pending = deferred()
    welcomeScreen._getRecentFiles.mockImplementation(() => pending.promise)
    const opening = welcomeScreen.show()
    await welcomeScreen.show()
    pending.resolve([])
    await opening
    expect(document.querySelectorAll('#welcome-overlay')).toHaveLength(1)
    expect(welcomeScreen._getRecentFiles).toHaveBeenCalledTimes(2)

    welcomeScreen.dismiss()
    finishDismissal(welcomeScreen._overlay)
    welcomeScreen._getRecentFiles.mockRejectedValue(new Error('Storage unavailable'))
    await expect(welcomeScreen.show()).resolves.toBeUndefined()
    expect(welcomeScreen.isVisible()).toBe(true)
  })

  test('keeps document shortcuts available to the existing document controller entry points', async () => {
    await createWelcomeScreen()
    const documentShortcut = vi.fn(event => event.preventDefault())
    document.addEventListener('keydown', documentShortcut)
    try {
      for (const key of ['n', 'o', 's']) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
          key, ctrlKey: true, bubbles: true, cancelable: true,
        }))
        document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key, ctrlKey: true, bubbles: true }))
      }
      expect(documentShortcut.mock.calls.map(([event]) => event.key)).toEqual(['n', 'o', 's'])
    } finally {
      document.removeEventListener('keydown', documentShortcut)
    }
  })

  test('dismissal cancels a pending show and prevents late document results from closing a reopened screen', async () => {
    const { welcomeScreen } = await createWelcomeScreen()
    const pendingAction = deferred()
    const action = welcomeScreen.runDocumentAction(() => pendingAction.promise, 'Open failed')
    welcomeScreen.dismiss()
    finishDismissal(welcomeScreen._overlay)
    const pendingFiles = deferred()
    welcomeScreen._getRecentFiles.mockImplementationOnce(() => pendingFiles.promise)
    const opening = welcomeScreen.show()
    welcomeScreen.dismiss()
    pendingFiles.resolve([])
    await opening
    expect(welcomeScreen.isVisible()).toBe(false)

    await welcomeScreen.show()
    pendingAction.resolve({ ok: true })
    await action
    expect(welcomeScreen._overlay.classList.contains('ws-fade-out')).toBe(false)
  })

  test('traps focus and consumes editor keys, paste, and the closing Escape keyup', async () => {
    document.getElementById('logo').focus()
    const { welcomeScreen } = await createWelcomeScreen()
    const editorKey = vi.fn()
    const editorPaste = vi.fn()
    document.addEventListener('keydown', editorKey)
    document.addEventListener('keyup', editorKey)
    document.addEventListener('paste', editorPaste)
    const press = (key, extra = {}) => {
      for (const type of ['keydown', 'keyup']) {
        document.activeElement.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra }))
      }
    }
    const links = document.querySelectorAll('#ws-dialog a')
    links[links.length - 1].focus()
    press('Tab')
    expect(document.activeElement.id).toBe('ws-new')
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(links[links.length - 1])
    document.getElementById('logo').focus()
    expect(document.activeElement.id).toBe('ws-dismiss')
    for (const key of ['l', 'Delete', 'F3']) press(key)
    const findShortcut = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(findShortcut)
    expect(findShortcut.defaultPrevented).toBe(true)
    document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'F3', bubbles: true }))
    press('z', { ctrlKey: true })
    document.activeElement.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    finishDismissal(welcomeScreen._overlay)
    expect(document.activeElement.id).toBe('logo')
    document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    expect(editorKey).not.toHaveBeenCalled()
    expect(editorPaste).not.toHaveBeenCalled()
    press('l')
    expect(editorKey).toHaveBeenCalledTimes(2)
    document.removeEventListener('keydown', editorKey)
    document.removeEventListener('keyup', editorKey)
    document.removeEventListener('paste', editorPaste)
  })
})
