const THEME_PRESETS = Object.freeze({
  red: Object.freeze({
    label: 'Oxide Red',
    accentColor: '#9b6267',
    backgroundColor: '#211d1e',
  }),
  green: Object.freeze({
    label: 'Verdigris Green',
    accentColor: '#5f806a',
    backgroundColor: '#1c211e',
  }),
  blue: Object.freeze({
    label: 'Blueprint Blue',
    accentColor: '#607d9e',
    backgroundColor: '#1d2024',
  }),
})

const DEFAULT_THEME_PREFERENCES = Object.freeze({
  themePreset: 'red',
  customAccentColor: '#746b8f',
  customBackgroundColor: '#202124',
})

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const LIGHT_FOREGROUND = '#f4f4f2'
const LIGHT_MUTED_FOREGROUND = '#b9b9b5'
const DARK_FOREGROUND = '#171817'
const DARK_MUTED_FOREGROUND = '#4d514e'

function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) return fallback
  return value.trim().toLowerCase()
}

function normalizeThemePreferences(preferences = {}) {
  const source = preferences && typeof preferences === 'object' ? preferences : {}
  const requestedPreset = typeof source.themePreset === 'string'
    ? source.themePreset.toLowerCase()
    : DEFAULT_THEME_PREFERENCES.themePreset
  const themePreset = requestedPreset === 'custom' || THEME_PRESETS[requestedPreset]
    ? requestedPreset
    : DEFAULT_THEME_PREFERENCES.themePreset

  // The legacy aliases make hand-authored or early-development preference
  // records recoverable without letting an arbitrary value reach CSS.
  const customAccentColor = normalizeHexColor(
    source.customAccentColor ?? source.accentColor,
    DEFAULT_THEME_PREFERENCES.customAccentColor,
  )
  const customBackgroundColor = normalizeHexColor(
    source.customBackgroundColor ?? source.backgroundColor,
    DEFAULT_THEME_PREFERENCES.customBackgroundColor,
  )

  return { themePreset, customAccentColor, customBackgroundColor }
}

function hexToRgb(color) {
  const value = Number.parseInt(color.slice(1), 16)
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  }
}

function relativeLuminance(color) {
  const channels = Object.values(hexToRgb(color)).map((channel) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function readableForeground(backgroundColor) {
  const lightContrast = contrastRatio(backgroundColor, LIGHT_FOREGROUND)
  const darkContrast = contrastRatio(backgroundColor, DARK_FOREGROUND)
  const useDarkForeground = darkContrast >= lightContrast

  return {
    tone: useDarkForeground ? 'light' : 'dark',
    foregroundColor: useDarkForeground ? DARK_FOREGROUND : LIGHT_FOREGROUND,
    mutedForegroundColor: useDarkForeground ? DARK_MUTED_FOREGROUND : LIGHT_MUTED_FOREGROUND,
  }
}

function resolveTheme(preferences = {}) {
  const normalized = normalizeThemePreferences(preferences)
  const palette = normalized.themePreset === 'custom'
    ? {
        accentColor: normalized.customAccentColor,
        backgroundColor: normalized.customBackgroundColor,
      }
    : THEME_PRESETS[normalized.themePreset]
  const backgroundContrast = readableForeground(palette.backgroundColor)
  const accentContrast = readableForeground(palette.accentColor)

  return {
    ...normalized,
    accentColor: palette.accentColor,
    backgroundColor: palette.backgroundColor,
    tone: backgroundContrast.tone,
    foregroundColor: backgroundContrast.foregroundColor,
    mutedForegroundColor: backgroundContrast.mutedForegroundColor,
    accentForegroundColor: accentContrast.foregroundColor,
  }
}

class ThemeController {
  constructor(root = document.documentElement) {
    this.root = root
    this.current = null
  }

  apply(preferences) {
    const theme = resolveTheme(preferences)
    this.root.setAttribute('data-nanquim-theme', theme.themePreset)
    this.root.setAttribute('data-nanquim-tone', theme.tone)
    this.root.style.setProperty('--accent-color', theme.accentColor)
    this.root.style.setProperty('--accent-foreground-color', theme.accentForegroundColor)
    this.root.style.setProperty('--app-background-color', theme.backgroundColor)
    this.root.style.setProperty('--app-foreground-color', theme.foregroundColor)
    this.root.style.setProperty('--app-muted-foreground-color', theme.mutedForegroundColor)
    this.current = theme
    return { ...theme }
  }
}

export {
  DEFAULT_THEME_PREFERENCES,
  THEME_PRESETS,
  ThemeController,
  contrastRatio,
  normalizeHexColor,
  normalizeThemePreferences,
  readableForeground,
  resolveTheme,
}
