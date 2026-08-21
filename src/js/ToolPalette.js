import commands, {
  commandCategories,
  executeRegisteredCommand,
} from './commands/_commands'
import { getCommandIconMetadata } from './CommandIcons'

const TOOL_PALETTE_STORAGE_KEY = 'nanquim.commandToolPalette'
const TOOL_PALETTE_MIN_WIDTH = 48
const TOOL_PALETTE_LABEL_THRESHOLD = 168
const TOOL_PALETTE_MAX_WIDTH = 280
const TOOL_PALETTE_RESIZE_STEP = 8
const TOOL_PALETTE_RESIZE_LARGE_STEP = 32

const COMMAND_LABELS = Object.freeze({
  HELP: 'Help',
  MATCH_PROPERTIES: 'Match Properties',
  DIST: 'Distance',
  DIMLINEAR: 'Linear Dimension',
  DIMALIGNED: 'Aligned Dimension',
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function commandLabel(commandName) {
  if (COMMAND_LABELS[commandName]) return COMMAND_LABELS[commandName]
  return String(commandName)
    .toLocaleLowerCase()
    .replace(/_/g, ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase())
}

function categoryId(category) {
  return `command-tool-category-${String(category)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
}

function normalizeStoredState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
  const parsedWidth = Number(source.width)

  return {
    width: Number.isFinite(parsedWidth)
      ? clamp(parsedWidth, TOOL_PALETTE_MIN_WIDTH, TOOL_PALETTE_MAX_WIDTH)
      : TOOL_PALETTE_MIN_WIDTH,
    visible: typeof source.visible === 'boolean' ? source.visible : true,
  }
}

function resolveStorage(providedStorage) {
  if (providedStorage !== undefined) return providedStorage
  try {
    return window.localStorage
  } catch (_) {
    return null
  }
}

function readStoredState(storage) {
  if (!storage) return normalizeStoredState()
  try {
    const raw = storage.getItem(TOOL_PALETTE_STORAGE_KEY)
    return normalizeStoredState(raw ? JSON.parse(raw) : null)
  } catch (_) {
    return normalizeStoredState()
  }
}

function isModalSurfaceOpen() {
  if (document.querySelector('dialog[open]')) return true
  if (document.querySelector('[role="dialog"][aria-hidden="false"]')) return true
  if (document.querySelector('.prefs-overlay[aria-hidden="false"]')) return true
  if (document.querySelector('#welcome-overlay')) return true
  return Boolean(document.querySelector('.block-modal-overlay'))
}

class ToolPalette {
  constructor(editor, options = {}) {
    this.editor = editor
    this.palette = options.palette || document.getElementById('command-tool-palette')
    this.content = options.content || document.getElementById('command-tool-palette-content')
    this.resizer = options.resizer || document.getElementById('command-tool-palette-resizer')
    this.toggleButton = options.toggleButton || document.getElementById('command-tool-palette-toggle')
    this.terminalInput = options.terminalInput || document.getElementById('terminalInput')
    this.storage = resolveStorage(options.storage)
    this.executeCommand = options.executeCommand || executeRegisteredCommand
    this._resizeState = null
    this._disposed = false

    this._onPaletteClick = this._onPaletteClick.bind(this)
    this._onPaletteKeyDown = this._onPaletteKeyDown.bind(this)
    this._onToggleClick = this._onToggleClick.bind(this)
    this._onToggleKeyDown = this._onToggleKeyDown.bind(this)
    this._onShortcutKeyDown = this._onShortcutKeyDown.bind(this)
    this._onResizerKeyDown = this._onResizerKeyDown.bind(this)
    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onPointerCancel = this._onPointerCancel.bind(this)
    this._onLostPointerCapture = this._onLostPointerCapture.bind(this)
    this._onDocumentSessionReset = this._onDocumentSessionReset.bind(this)

    if (!this.palette || !this.content || !this.resizer || !this.toggleButton) return

    this._renderCommands()
    this._bind()

    const storedState = readStoredState(this.storage)
    this.width = storedState.width
    this.visible = storedState.visible
    this.setWidth(storedState.width)
    this.setVisible(storedState.visible, { persist: false, restoreFocus: false })
  }

  get isReady() {
    return Boolean(this.palette && this.content && this.resizer && this.toggleButton)
  }

  _renderCommands() {
    const fragment = document.createDocumentFragment()

    commandCategories.forEach((category) => {
      const section = document.createElement('section')
      section.className = 'command-tool-category'
      section.dataset.category = category

      const title = document.createElement('h2')
      title.className = 'command-tool-category-title'
      title.id = categoryId(category)
      title.textContent = category
      section.setAttribute('aria-labelledby', title.id)

      const list = document.createElement('div')
      list.className = 'command-tool-list'

      Object.entries(commands)
        .filter(([, command]) => command.category === category)
        .forEach(([name, command]) => {
          const label = commandLabel(name)
          const aliases = (command.aliases || []).map((alias) => String(alias).toLocaleUpperCase())
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'command-tool-button'
          button.dataset.command = name
          button.setAttribute('aria-label', label)
          button.title = aliases.length > 0
            ? `${label} (${aliases.join(', ')}) — ${command.description}`
            : `${label} — ${command.description}`

          const icon = document.createElement('span')
          icon.className = 'command-tool-icon'
          icon.setAttribute('aria-hidden', 'true')
          const iconMetadata = getCommandIconMetadata(name)
          if (iconMetadata) {
            icon.dataset.commandIcon = iconMetadata.id
            icon.style.setProperty('--command-tool-icon-x', iconMetadata.positionX)
            icon.style.setProperty('--command-tool-icon-y', iconMetadata.positionY)
          }

          const text = document.createElement('span')
          text.className = 'command-tool-label'
          text.textContent = label
          button.append(icon, text)
          list.appendChild(button)
        })

      section.append(title, list)
      fragment.appendChild(section)
    })

    this.content.replaceChildren(fragment)
  }

  _bind() {
    this.palette.addEventListener('click', this._onPaletteClick)
    this.palette.addEventListener('keydown', this._onPaletteKeyDown)
    this.toggleButton.addEventListener('click', this._onToggleClick)
    this.toggleButton.addEventListener('keydown', this._onToggleKeyDown)
    this.resizer.addEventListener('keydown', this._onResizerKeyDown)
    this.resizer.addEventListener('pointerdown', this._onPointerDown)
    this.resizer.addEventListener('lostpointercapture', this._onLostPointerCapture)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('pointercancel', this._onPointerCancel)
    document.addEventListener('keydown', this._onShortcutKeyDown, true)
    this.editor?.signals?.documentSessionReset?.add?.(this._onDocumentSessionReset)
  }

  _writeState() {
    if (!this.storage) return
    try {
      this.storage.setItem(TOOL_PALETTE_STORAGE_KEY, JSON.stringify({
        width: this.width,
        visible: this.visible,
      }))
    } catch (_) {
      // Layout persistence is optional; storage failures must not block CAD UI.
    }
  }

  setWidth(value, { persist = false } = {}) {
    if (!this.palette || !this.resizer) return TOOL_PALETTE_MIN_WIDTH
    const parsed = Number(value)
    const width = clamp(
      Number.isFinite(parsed) ? parsed : TOOL_PALETTE_MIN_WIDTH,
      TOOL_PALETTE_MIN_WIDTH,
      TOOL_PALETTE_MAX_WIDTH,
    )

    this.width = width
    this.palette.style.setProperty('--command-tool-palette-width', `${width}px`)
    this.palette.classList.toggle('is-labeled', width >= TOOL_PALETTE_LABEL_THRESHOLD)
    this.resizer.setAttribute('aria-valuemin', String(TOOL_PALETTE_MIN_WIDTH))
    this.resizer.setAttribute('aria-valuemax', String(TOOL_PALETTE_MAX_WIDTH))
    this.resizer.setAttribute('aria-valuenow', String(Math.round(width)))
    this.resizer.setAttribute(
      'aria-valuetext',
      `${Math.round(width)} pixels, ${
        width >= TOOL_PALETTE_LABEL_THRESHOLD ? 'icons and tool names' : 'icons only'
      }`,
    )
    if (persist) this._writeState()
    return width
  }

  setVisible(value, { persist = true, restoreFocus = true } = {}) {
    if (!this.palette || !this.resizer || !this.toggleButton) return false
    const visible = Boolean(value)
    const focusWasInside = this.palette.contains(document.activeElement)
      || document.activeElement === this.resizer

    if (!visible && this._resizeState) this._finishResize({ restoreStart: false, persist: false })

    this.visible = visible
    this.palette.hidden = !visible
    this.palette.setAttribute('aria-hidden', String(!visible))
    this.resizer.hidden = !visible
    this.toggleButton.setAttribute('aria-expanded', String(visible))
    this.toggleButton.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} command tools`)
    this.toggleButton.title = `${visible ? 'Hide' : 'Show'} command tools (F4)`
    this.toggleButton.setAttribute('aria-keyshortcuts', 'F4')
    this.toggleButton.classList.toggle('is-active', visible)
    this.palette.parentElement?.classList.toggle('is-command-tool-palette-hidden', !visible)

    if (!visible && restoreFocus && focusWasInside) {
      this.toggleButton.focus({ preventScroll: true })
    }
    if (persist) this._writeState()
    return visible
  }

  toggle() {
    return this.setVisible(!this.visible)
  }

  _onPaletteClick(event) {
    const button = event.target.closest?.('.command-tool-button[data-command]')
    if (!button || !this.palette.contains(button) || button.disabled) return
    const executed = this.executeCommand(this.editor, button.dataset.command)
    if (executed !== false) this.terminalInput?.focus({ preventScroll: true })
  }

  _onPaletteKeyDown(event) {
    if (!event.target.closest?.('button, [role="separator"]')) return
    if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') {
      // Keep native focus traversal and button activation away from Terminal's
      // document-level command input listener. Do not prevent the default.
      event.stopPropagation()
    }
  }

  _onToggleClick() {
    this.toggle()
  }

  _onToggleKeyDown(event) {
    if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation()
    }
  }

  _onShortcutKeyDown(event) {
    const isF4 = event.key === 'F4' || event.code === 'F4'
    if (
      !isF4
      || event.repeat
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.shiftKey
      || isModalSurfaceOpen()
    ) return

    event.preventDefault()
    event.stopImmediatePropagation()
    this.toggle()
  }

  _onResizerKeyDown(event) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      // Keep a held resize modifier from moving focus into the Terminal before
      // the following Arrow key reaches this separator.
      event.stopPropagation()
      return
    }
    if (event.key === 'Tab') {
      // The terminal owns document-level keyboard input, so keep native focus
      // traversal local to this separator just like the palette buttons.
      event.stopPropagation()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      // A separator has no activation action. Consume activation keys so Space
      // cannot scroll the page or repeat the previous Terminal command.
      event.preventDefault()
      event.stopPropagation()
      return
    }

    let width = this.width
    const step = event.shiftKey ? TOOL_PALETTE_RESIZE_LARGE_STEP : TOOL_PALETTE_RESIZE_STEP
    if (event.key === 'ArrowLeft') width -= step
    else if (event.key === 'ArrowRight') width += step
    else if (event.key === 'Home') width = TOOL_PALETTE_MIN_WIDTH
    else if (event.key === 'End') width = TOOL_PALETTE_MAX_WIDTH
    else return

    event.preventDefault()
    event.stopPropagation()
    this.setWidth(width, { persist: true })
  }

  _onPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false || !this.visible) return
    event.preventDefault()
    event.stopPropagation()
    this._resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.width,
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect,
    }
    this.resizer.classList.add('is-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    try {
      if (event.pointerId !== undefined) this.resizer.setPointerCapture?.(event.pointerId)
    } catch (_) {
      // Pointer capture may be unavailable in synthetic or older browsers.
    }
  }

  _matchesResizePointer(event) {
    if (!this._resizeState) return false
    return this._resizeState.pointerId === undefined
      || event.pointerId === undefined
      || event.pointerId === this._resizeState.pointerId
  }

  _onPointerMove(event) {
    if (!this._matchesResizePointer(event)) return
    this.setWidth(this._resizeState.startWidth + event.clientX - this._resizeState.startX)
  }

  _onPointerUp(event) {
    if (!this._matchesResizePointer(event)) return
    this._finishResize({ restoreStart: false, persist: true })
  }

  _onPointerCancel(event) {
    if (!this._matchesResizePointer(event)) return
    this._finishResize({ restoreStart: true, persist: false })
  }

  _onLostPointerCapture(event) {
    if (!this._matchesResizePointer(event)) return
    this._finishResize({ restoreStart: false, persist: true })
  }

  _finishResize({ restoreStart, persist }) {
    const state = this._resizeState
    if (!state) return
    this._resizeState = null
    if (restoreStart) this.setWidth(state.startWidth)
    this.resizer?.classList.remove('is-resizing')
    document.body.style.cursor = state.bodyCursor
    document.body.style.userSelect = state.bodyUserSelect

    try {
      if (
        state.pointerId !== undefined
        && this.resizer?.hasPointerCapture?.(state.pointerId)
      ) this.resizer.releasePointerCapture(state.pointerId)
    } catch (_) {
      // Capture can already be released by pointerup/lostpointercapture.
    }
    if (persist) this._writeState()
  }

  _onDocumentSessionReset() {
    this._finishResize({ restoreStart: true, persist: false })
  }

  dispose() {
    if (this._disposed) return
    this._disposed = true
    this._finishResize({ restoreStart: true, persist: false })
    this.palette?.removeEventListener('click', this._onPaletteClick)
    this.palette?.removeEventListener('keydown', this._onPaletteKeyDown)
    this.toggleButton?.removeEventListener('click', this._onToggleClick)
    this.toggleButton?.removeEventListener('keydown', this._onToggleKeyDown)
    this.resizer?.removeEventListener('keydown', this._onResizerKeyDown)
    this.resizer?.removeEventListener('pointerdown', this._onPointerDown)
    this.resizer?.removeEventListener('lostpointercapture', this._onLostPointerCapture)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerCancel)
    document.removeEventListener('keydown', this._onShortcutKeyDown, true)
    this.editor?.signals?.documentSessionReset?.remove?.(this._onDocumentSessionReset)
  }
}

export {
  TOOL_PALETTE_LABEL_THRESHOLD,
  TOOL_PALETTE_MAX_WIDTH,
  TOOL_PALETTE_MIN_WIDTH,
  TOOL_PALETTE_STORAGE_KEY,
  ToolPalette,
  commandLabel,
  normalizeStoredState,
}
