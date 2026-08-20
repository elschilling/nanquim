import { compile } from 'sass'
import { describe, expect, test } from 'vitest'

const compiledStyles = compile('src/styles/main.sass', {
  loadPaths: ['src/styles'],
  style: 'expanded',
}).css

describe('Nanquim theme styles', () => {
  test('publishes the semantic theme contract and all built-in palettes', () => {
    expect(compiledStyles).toContain('--accent-color: #9b6267')
    expect(compiledStyles).toContain('--app-background-color: #211d1e')
    expect(compiledStyles).toContain('--app-foreground-color: #f1eeec')
    expect(compiledStyles).toContain('--surface-0: var(--app-background-color)')
    expect(compiledStyles).toContain('--top-rail-bg-color: color-mix(in srgb, var(--app-background-color) 52%, #000)')
    expect(compiledStyles).toContain('--canvas-bg-color: color-mix(in srgb, var(--app-background-color) 72%, #000)')
    expect(compiledStyles).toContain('[data-nanquim-theme=red]')
    expect(compiledStyles).toContain('[data-nanquim-theme=green]')
    expect(compiledStyles).toContain('[data-nanquim-theme=blue]')
    expect(compiledStyles).toContain('[data-nanquim-theme=custom]')
    expect(compiledStyles).toContain('[data-nanquim-tone=light]')
  })

  test('applies semantic color and focus tokens across the main editor surfaces', () => {
    expect(compiledStyles).toMatch(/\.web-section\s*\{[^}]*background-color: var\(--top-rail-bg-color\)/s)
    expect(compiledStyles).toMatch(/\.canvas\s*\{[^}]*background-color: var\(--canvas-bg-color\)/s)
    expect(compiledStyles).toMatch(/\.outliner-selected\s*\{[^}]*background: var\(--selected-surface\)/s)
    expect(compiledStyles).toMatch(/\.terminal\s*\{[^}]*var\(--surface-0\)/s)
    expect(compiledStyles).toMatch(/\.prefs-dialog[\s\S]*background: var\(--surface-1\)/)
    expect(compiledStyles).toMatch(/\.gn-dock[\s\S]*background: var\(--canvas-bg-color\)/)
    expect(compiledStyles).toContain('outline: 2px solid var(--accent-color)')
    expect(compiledStyles).toContain('@media (max-width: 980px)')
  })

  test('keeps light custom themes adaptive instead of forcing dark rails', () => {
    const lightThemeRule = compiledStyles.match(/:root\[data-nanquim-tone=light\]\s*\{([^}]*)\}/)?.[1] || ''

    expect(lightThemeRule).toContain('--top-rail-bg-color: color-mix(in srgb, var(--app-background-color) 89%, var(--app-foreground-color))')
    expect(lightThemeRule).toContain('--canvas-bg-color: color-mix(in srgb, var(--app-background-color) 92%, var(--app-foreground-color))')
  })

  test('keeps the header accent outside the toolbar flex layout', () => {
    const accentRule = compiledStyles.match(/\.editor-header::before\s*\{([^}]*)\}/)?.[1] || ''

    expect(accentRule).toContain('position: absolute')
    expect(accentRule).toContain('left: 2px')
    expect(accentRule).not.toContain('align-self')
    expect(accentRule).not.toMatch(/(^|;)\s*flex:/)
    expect(compiledStyles).toMatch(/\.canvas-editor > \.editor-header\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s)
  })
})
