import { getPreferences, savePreferences } from './Preferences'
import { THEME_PRESETS, ThemeController, resolveTheme } from './ThemeController'

const NUMERIC_FIELDS = [
  { key: 'gridSize', label: 'Grid Size', step: 0.5, min: 0.1 },
  { key: 'handlerSize', label: 'Handler Size (px)', step: 1, min: 4 },
  { key: 'defaultStrokeWidth', label: 'Default Stroke Width', step: 0.01, min: 0.01 },
  { key: 'hoverStrokeWidth', label: 'Hover Stroke Width', step: 0.1, min: 0.1 },
  { key: 'helperStrokeWidth', label: 'Helper Stroke Width', step: 0.05, min: 0.05 },
  { key: 'hoverThreshold', label: 'Hover Threshold (px)', step: 1, min: 1 },
  { key: 'snapIconSize', label: 'Snap Icon Size (px)', step: 1, min: 4 },
]

function createSection(titleText, id) {
  const section = document.createElement('section')
  section.className = 'prefs-section'
  section.setAttribute('aria-labelledby', id)

  const title = document.createElement('h4')
  title.id = id
  title.className = 'prefs-section-title'
  title.textContent = titleText
  section.appendChild(title)

  return section
}

function createRow({ id, label, input }) {
  const row = document.createElement('div')
  row.className = 'prefs-row'

  const labelElement = document.createElement('label')
  labelElement.className = 'prefs-label'
  labelElement.htmlFor = id
  labelElement.textContent = label

  input.id = id
  row.appendChild(labelElement)
  row.appendChild(input)
  return row
}

function Preferences(editor) {
  const themeController = new ThemeController(document.documentElement)
  const initialPreferences = getPreferences()
  themeController.apply(initialPreferences)

  document.documentElement.style.setProperty('--hover-stroke-width', initialPreferences.hoverStrokeWidth)
  document.documentElement.style.setProperty('--helper-stroke-width', initialPreferences.helperStrokeWidth)

  const overlay = document.createElement('div')
  overlay.className = 'prefs-overlay'
  overlay.style.display = 'none'
  overlay.setAttribute('aria-hidden', 'true')

  const dialog = document.createElement('div')
  dialog.className = 'prefs-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'prefs-title')
  dialog.setAttribute('aria-describedby', 'prefs-theme-help')

  const title = document.createElement('h3')
  title.id = 'prefs-title'
  title.textContent = 'Preferences'
  title.className = 'prefs-title'
  dialog.appendChild(title)

  const appearanceSection = createSection('Appearance', 'prefs-appearance-title')
  const themeSelect = document.createElement('select')
  themeSelect.className = 'prefs-input prefs-select'
  themeSelect.name = 'themePreset'
  Object.entries(THEME_PRESETS).forEach(([value, preset]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = preset.label
    themeSelect.appendChild(option)
  })
  const customOption = document.createElement('option')
  customOption.value = 'custom'
  customOption.textContent = 'Custom'
  themeSelect.appendChild(customOption)
  appearanceSection.appendChild(createRow({
    id: 'prefs-theme-preset',
    label: 'Color theme',
    input: themeSelect,
  }))

  const accentInput = document.createElement('input')
  accentInput.type = 'color'
  accentInput.className = 'prefs-input prefs-color-input'
  accentInput.name = 'customAccentColor'
  appearanceSection.appendChild(createRow({
    id: 'prefs-accent-color',
    label: 'Accent color',
    input: accentInput,
  }))

  const backgroundInput = document.createElement('input')
  backgroundInput.type = 'color'
  backgroundInput.className = 'prefs-input prefs-color-input'
  backgroundInput.name = 'customBackgroundColor'
  appearanceSection.appendChild(createRow({
    id: 'prefs-background-color',
    label: 'Background color',
    input: backgroundInput,
  }))

  const themeHelp = document.createElement('p')
  themeHelp.id = 'prefs-theme-help'
  themeHelp.className = 'prefs-help'
  themeHelp.textContent = 'Theme changes are previewed immediately and saved only on this device.'
  appearanceSection.appendChild(themeHelp)
  dialog.appendChild(appearanceSection)

  const interactionSection = createSection('Drawing and interaction', 'prefs-interaction-title')
  const inputs = {}
  NUMERIC_FIELDS.forEach(({ key, label, step, min }) => {
    const input = document.createElement('input')
    input.type = 'number'
    input.className = 'prefs-input'
    input.name = key
    input.step = step
    input.min = min
    input.required = true
    inputs[key] = input
    interactionSection.appendChild(createRow({
      id: `prefs-${key}`,
      label,
      input,
    }))
  })
  dialog.appendChild(interactionSection)

  const btnRow = document.createElement('div')
  btnRow.className = 'prefs-buttons'

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'prefs-btn prefs-btn-cancel'
  cancelBtn.textContent = 'Cancel'

  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'prefs-btn prefs-btn-save'
  saveBtn.textContent = 'Save'

  btnRow.appendChild(cancelBtn)
  btnRow.appendChild(saveBtn)
  dialog.appendChild(btnRow)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)

  let isOpen = false
  let previouslyFocused = null
  let customTheme = {
    accentColor: initialPreferences.customAccentColor,
    backgroundColor: initialPreferences.customBackgroundColor,
  }

  function applyNumericVariables(preferences) {
    document.documentElement.style.setProperty('--hover-stroke-width', preferences.hoverStrokeWidth)
    document.documentElement.style.setProperty('--helper-stroke-width', preferences.helperStrokeWidth)
  }

  function setDisplayedTheme(themePreset) {
    if (themePreset === 'custom') {
      accentInput.value = customTheme.accentColor
      backgroundInput.value = customTheme.backgroundColor
      return
    }
    accentInput.value = THEME_PRESETS[themePreset].accentColor
    backgroundInput.value = THEME_PRESETS[themePreset].backgroundColor
  }

  function previewTheme() {
    themeController.apply({
      themePreset: themeSelect.value,
      customAccentColor: customTheme.accentColor,
      customBackgroundColor: customTheme.backgroundColor,
    })
  }

  function syncControls(preferences) {
    const theme = resolveTheme(preferences)
    customTheme = {
      accentColor: theme.customAccentColor,
      backgroundColor: theme.customBackgroundColor,
    }
    themeSelect.value = theme.themePreset
    setDisplayedTheme(theme.themePreset)
    NUMERIC_FIELDS.forEach(({ key }) => {
      inputs[key].value = preferences[key]
    })
    themeController.apply(preferences)
  }

  function close({ restoreTheme = true } = {}) {
    if (!isOpen) return
    if (restoreTheme) themeController.apply(getPreferences())
    overlay.style.display = 'none'
    overlay.setAttribute('aria-hidden', 'true')
    isOpen = false
    if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  }

  function open() {
    const current = getPreferences()
    syncControls(current)
    previouslyFocused = document.activeElement
    overlay.style.display = 'flex'
    overlay.setAttribute('aria-hidden', 'false')
    isOpen = true
    themeSelect.focus()
  }

  themeSelect.addEventListener('change', () => {
    setDisplayedTheme(themeSelect.value)
    previewTheme()
  })

  accentInput.addEventListener('input', () => {
    customTheme.accentColor = accentInput.value
    themeSelect.value = 'custom'
    backgroundInput.value = customTheme.backgroundColor
    previewTheme()
  })

  backgroundInput.addEventListener('input', () => {
    customTheme.backgroundColor = backgroundInput.value
    themeSelect.value = 'custom'
    accentInput.value = customTheme.accentColor
    previewTheme()
  })

  saveBtn.addEventListener('click', () => {
    const current = getPreferences()
    const newPreferences = {
      ...current,
      themePreset: themeSelect.value,
      customAccentColor: customTheme.accentColor,
      customBackgroundColor: customTheme.backgroundColor,
    }
    NUMERIC_FIELDS.forEach(({ key }) => {
      const parsed = Number.parseFloat(inputs[key].value)
      newPreferences[key] = Number.isFinite(parsed) ? parsed : current[key]
    })

    const savedPreferences = savePreferences(newPreferences)
    applyNumericVariables(savedPreferences)
    themeController.apply(savedPreferences)
    editor.signals.preferencesChanged.dispatch(savedPreferences)
    close({ restoreTheme: false })
  })

  cancelBtn.addEventListener('click', () => close())
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close()
  })
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [...dialog.querySelectorAll('button, input, select')]
      .filter((element) => !element.disabled)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  this.open = open
  this.close = close
  this.overlay = overlay
  this.themeController = themeController
  this.dispose = () => {
    close()
    overlay.remove()
    if (window.openPreferences === open) delete window.openPreferences
  }

  window.openPreferences = open
}

export { Preferences }
