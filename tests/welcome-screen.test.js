// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WelcomeScreen } from '../src/js/WelcomeScreen'

async function createWelcomeScreen() {
  const editor = {
    loader: { loadFile: vi.fn() },
    signals: { terminalLogged: { dispatch: vi.fn() } },
  }
  const welcomeScreen = new WelcomeScreen(editor)
  await vi.waitFor(() => expect(document.querySelector('#welcome-overlay')).not.toBeNull())
  return welcomeScreen
}

describe('WelcomeScreen dismissal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    vi.stubGlobal('openSVG', vi.fn())
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  test('coalesces repeated dismissals while the file chooser is opening', async () => {
    const welcomeScreen = await createWelcomeScreen()
    const overlay = document.querySelector('#welcome-overlay')
    const dialog = overlay.querySelector('#ws-dialog')
    const completion = vi.fn()
    const runtimeErrors = vi.fn()
    window.addEventListener('error', runtimeErrors)

    overlay.querySelector('#ws-open').click()
    welcomeScreen.dismiss(completion)

    expect(window.openSVG).toHaveBeenCalledTimes(1)
    expect(overlay.classList.contains('ws-fade-out')).toBe(true)
    expect(overlay.isConnected).toBe(true)

    // The dialog has its own entrance animation. Its bubbling event must not
    // complete the overlay's fade-out or consume the overlay listener.
    dialog.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(overlay.isConnected).toBe(true)
    expect(welcomeScreen._overlay).toBe(overlay)

    overlay.dispatchEvent(new Event('animationend', { bubbles: true }))

    expect(runtimeErrors).not.toHaveBeenCalled()
    expect(completion).toHaveBeenCalledTimes(1)
    expect(overlay.isConnected).toBe(false)
    expect(welcomeScreen._overlay).toBeNull()
    window.removeEventListener('error', runtimeErrors)
  })

  test('treats a delayed dismissal of an already removed overlay as complete', async () => {
    const welcomeScreen = await createWelcomeScreen()
    const overlay = document.querySelector('#welcome-overlay')

    welcomeScreen.dismiss()
    overlay.dispatchEvent(new Event('animationend', { bubbles: true }))

    const completion = vi.fn()
    expect(() => welcomeScreen.dismiss(completion)).not.toThrow()
    expect(completion).toHaveBeenCalledTimes(1)
    expect(welcomeScreen._overlay).toBeNull()
  })

  test('finishes a pending dismissal if another owner removes the overlay', async () => {
    const welcomeScreen = await createWelcomeScreen()
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
