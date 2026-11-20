// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getPreferences, normalizePreferences, savePreferences, STORAGE_KEY } from '../src/js/Preferences'
import { Preferences } from '../src/js/PreferencesUI'
import {
  DEFAULT_THEME_PREFERENCES,
  THEME_PRESETS,
  ThemeController,
  contrastRatio,
  resolveTheme,
} from '../src/js/ThemeController'

function dispatchChange(element) {
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function dispatchInput(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ThemeController', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-nanquim-theme')
    document.documentElement.removeAttribute('data-nanquim-tone')
    document.documentElement.removeAttribute('style')
  })

  test.each(Object.entries(THEME_PRESETS))('applies the %s preset through the root theme contract', (name, preset) => {
    const controller = new ThemeController(document.documentElement)

    const theme = controller.apply({ themePreset: name })

    expect(theme.accentColor).toBe(preset.accentColor)
    expect(theme.backgroundColor).toBe(preset.backgroundColor)
    expect(document.documentElement.dataset.nanquimTheme).toBe(name)
    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe(preset.accentColor)
    expect(document.documentElement.style.getPropertyValue('--app-background-color')).toBe(preset.backgroundColor)
  })

  test('chooses a readable light foreground for a dark custom background', () => {
    const controller = new ThemeController(document.documentElement)

    const theme = controller.apply({
      themePreset: 'custom',
      customAccentColor: '#2d2f31',
      customBackgroundColor: '#070809',
    })

    expect(theme.tone).toBe('dark')
    expect(document.documentElement.dataset.nanquimTone).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--app-foreground-color')).toBe('#f4f4f2')
    expect(contrastRatio(theme.backgroundColor, theme.foregroundColor)).toBeGreaterThanOrEqual(4.5)
  })

  test('chooses a readable dark foreground for a light custom background and accent', () => {
    const controller = new ThemeController(document.documentElement)

    const theme = controller.apply({
      themePreset: 'custom',
      customAccentColor: '#f4d9c8',
      customBackgroundColor: '#f3eee7',
    })

    expect(theme.tone).toBe('light')
    expect(document.documentElement.dataset.nanquimTone).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--app-foreground-color')).toBe('#171817')
    expect(document.documentElement.style.getPropertyValue('--accent-foreground-color')).toBe('#171817')
    expect(contrastRatio(theme.backgroundColor, theme.foregroundColor)).toBeGreaterThanOrEqual(4.5)
  })

  test('rejects invalid stored CSS colors and unknown presets', () => {
    const theme = resolveTheme({
      themePreset: 'javascript:alert(1)',
      customAccentColor: 'red; background: url(evil)',
      customBackgroundColor: '#12345g',
    })

    expect(theme.themePreset).toBe('red')
    expect(theme.customAccentColor).toBe(DEFAULT_THEME_PREFERENCES.customAccentColor)
    expect(theme.customBackgroundColor).toBe(DEFAULT_THEME_PREFERENCES.customBackgroundColor)
    expect(theme.accentColor).toBe(THEME_PRESETS.red.accentColor)
  })
})

describe('Preferences appearance controls', () => {
  let preferences
  let editor
  let launcher

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-nanquim-theme')
    document.documentElement.removeAttribute('data-nanquim-tone')
    document.documentElement.removeAttribute('style')
    document.body.replaceChildren()
    launcher = document.createElement('button')
    launcher.textContent = 'Preferences'
    document.body.appendChild(launcher)
    editor = {
      signals: { preferencesChanged: { dispatch: vi.fn() } },
      documentState: { markChanged: vi.fn() },
    }
    preferences = new Preferences(editor)
  })

  afterEach(() => {
    preferences?.dispose()
    delete window.openPreferences
  })

  test('auto repeat defaults off, accepts only booleans, and preserves older preferences', () => {
    expect(getPreferences().autoRepeatLastCommand).toBe(false)
    expect(normalizePreferences({ gridSize: 2 }).autoRepeatLastCommand).toBe(false)
    for (const value of ['true', 'false', 1, null, {}, []]) {
      expect(normalizePreferences({ autoRepeatLastCommand: value }).autoRepeatLastCommand).toBe(false)
    }
    expect(savePreferences({ autoRepeatLastCommand: true }).autoRepeatLastCommand).toBe(true)
    expect(getPreferences().autoRepeatLastCommand).toBe(true)
  })

  test('saves auto repeat locally, restores the checkbox on reopen, and can disable it', () => {
    preferences.open()
    const checkbox = document.getElementById('prefs-auto-repeat-last-command')
    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.checked).toBe(false)
    expect(checkbox.labels[0].textContent).toBe('Auto repeat last command')
    expect(document.getElementById(checkbox.getAttribute('aria-describedby')).textContent).toContain('Esc')

    checkbox.click()
    expect(getPreferences().autoRepeatLastCommand).toBe(false)
    document.querySelector('.prefs-btn-save').click()
    expect(getPreferences().autoRepeatLastCommand).toBe(true)
    expect(editor.signals.preferencesChanged.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoRepeatLastCommand: true }),
    )
    preferences.open()
    expect(checkbox.checked).toBe(true)
    checkbox.click()
    document.querySelector('.prefs-btn-save').click()
    expect(getPreferences().autoRepeatLastCommand).toBe(false)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test.each(['Cancel', 'Escape', 'backdrop'])('%s discards an unsaved auto repeat change', (exit) => {
    preferences.open()
    const checkbox = document.getElementById('prefs-auto-repeat-last-command')
    checkbox.click()
    if (exit === 'Cancel') document.querySelector('.prefs-btn-cancel').click()
    else if (exit === 'backdrop') preferences.overlay.click()
    else checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(getPreferences().autoRepeatLastCommand).toBe(false)
    expect(editor.signals.preferencesChanged.dispatch).not.toHaveBeenCalled()
    preferences.open()
    expect(checkbox.checked).toBe(false)
  })

  test('previews a preset without persisting it and Cancel restores the saved theme and focus', () => {
    launcher.focus()
    preferences.open()
    const select = document.getElementById('prefs-theme-preset')

    expect(document.querySelector('.prefs-dialog').getAttribute('role')).toBe('dialog')
    expect(document.querySelector('.prefs-dialog').getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(select)
    expect([...select.options].map(({ value }) => value)).toEqual(['red', 'green', 'blue', 'custom'])

    select.value = 'green'
    dispatchChange(select)

    expect(document.documentElement.dataset.nanquimTheme).toBe('green')
    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe(THEME_PRESETS.green.accentColor)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    document.querySelector('.prefs-btn-cancel').click()
    expect(document.documentElement.dataset.nanquimTheme).toBe('red')
    expect(document.activeElement).toBe(launcher)
    expect(editor.signals.preferencesChanged.dispatch).not.toHaveBeenCalled()
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('preserves custom colors while switching presets and across a saved preset', () => {
    preferences.open()
    const select = document.getElementById('prefs-theme-preset')
    const accent = document.getElementById('prefs-accent-color')
    const background = document.getElementById('prefs-background-color')

    select.value = 'custom'
    dispatchChange(select)
    accent.value = '#8a657d'
    dispatchInput(accent)
    background.value = '#161b20'
    dispatchInput(background)

    select.value = 'red'
    dispatchChange(select)
    expect(accent.value).toBe(THEME_PRESETS.red.accentColor)
    expect(background.value).toBe(THEME_PRESETS.red.backgroundColor)

    select.value = 'custom'
    dispatchChange(select)
    expect(accent.value).toBe('#8a657d')
    expect(background.value).toBe('#161b20')

    select.value = 'red'
    dispatchChange(select)
    document.querySelector('.prefs-btn-save').click()

    expect(getPreferences()).toMatchObject({
      themePreset: 'red',
      customAccentColor: '#8a657d',
      customBackgroundColor: '#161b20',
    })
    expect(document.documentElement.dataset.nanquimTheme).toBe('red')
    expect(editor.signals.preferencesChanged.dispatch).toHaveBeenCalledOnce()
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()

    preferences.open()
    select.value = 'custom'
    dispatchChange(select)
    expect(accent.value).toBe('#8a657d')
    expect(background.value).toBe('#161b20')
  })

  test('saves a custom light background locally and Escape discards a later preview', () => {
    preferences.open()
    const accent = document.getElementById('prefs-accent-color')
    const background = document.getElementById('prefs-background-color')
    accent.value = '#d4b6a1'
    dispatchInput(accent)
    background.value = '#f2eee8'
    dispatchInput(background)
    document.querySelector('.prefs-btn-save').click()

    expect(document.documentElement.dataset.nanquimTheme).toBe('custom')
    expect(document.documentElement.dataset.nanquimTone).toBe('light')
    expect(getPreferences()).toMatchObject({
      themePreset: 'custom',
      customAccentColor: '#d4b6a1',
      customBackgroundColor: '#f2eee8',
    })

    preferences.open()
    const select = document.getElementById('prefs-theme-preset')
    select.value = 'blue'
    dispatchChange(select)
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(preferences.overlay.style.display).toBe('none')
    expect(document.documentElement.dataset.nanquimTheme).toBe('custom')
    expect(document.documentElement.dataset.nanquimTone).toBe('light')
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })
})
