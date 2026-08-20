import { DEFAULT_THEME_PREFERENCES, normalizeThemePreferences } from './ThemeController'

const STORAGE_KEY = 'nanquim-preferences'

const DEFAULTS = {
  gridSize: 1,
  handlerSize: 16,
  defaultStrokeWidth: 0.1,
  hoverStrokeWidth: 0.4,
  helperStrokeWidth: 0.2,
  hoverThreshold: 10,
  snapIconSize: 15,
  ...DEFAULT_THEME_PREFERENCES,
}

function normalizePreferences(preferences = {}) {
  const source = preferences && typeof preferences === 'object' && !Array.isArray(preferences)
    ? preferences
    : {}
  return {
    ...DEFAULTS,
    ...source,
    ...normalizeThemePreferences(source),
  }
}

function getPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return normalizePreferences(parsed)
    }
  } catch (e) {
    console.warn('Failed to read preferences from localStorage:', e)
  }
  return normalizePreferences()
}

function savePreferences(prefs) {
  const normalized = normalizePreferences(prefs)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch (e) {
    console.warn('Failed to save preferences to localStorage:', e)
  }
  return normalized
}

export { getPreferences, normalizePreferences, savePreferences, DEFAULTS, STORAGE_KEY }
