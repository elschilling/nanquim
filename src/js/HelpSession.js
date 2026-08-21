import commands, { commandCategories } from './commands/_commands'
import { createCommandIllustration } from './CommandIllustrations'

const TERMINAL_SHORTCUTS = [
  { keys: ['F1'], description: 'Open this command reference.' },
  { keys: ['Space', 'Enter'], description: 'Confirm terminal input. Blank Space repeats the previous command.' },
  { keys: ['Esc'], description: 'Cancel the active command or interaction.' },
  { keys: ['Delete'], description: 'Delete the current canvas selection.' },
  { keys: ['Ctrl + Z', 'Ctrl + Shift + Z'], description: 'Undo or redo the last canvas edit.' },
  { keys: ['Ctrl/⌘ + N', 'Ctrl/⌘ + O'], description: 'Create a new drawing or open another one.' },
  { keys: ['Ctrl/⌘ + S', 'Ctrl/⌘ + Shift + S'], description: 'Save or Save As an editable Nanquim SVG.' },
  { keys: ['Ctrl/⌘ + C', 'Ctrl/⌘ + V'], description: 'Copy or paste selected Nanquim geometry.' },
  { keys: ['↑ / ↓', 'Tab'], description: 'Navigate and accept terminal autocomplete suggestions.' },
  { keys: ['P'], description: 'Restore the previous selection when one is available.' },
  { keys: ['@x,y', '#x,y'], description: 'Enter relative or absolute coordinates.' },
  { keys: ['F2'], description: 'Expand or restore the terminal.' },
  { keys: ['F3'], description: 'Toggle all viewport overlays.' },
  { keys: ['F4'], description: 'Show or hide the command tools palette.' },
  { keys: ['F7'], description: 'Toggle the drawing grid.' },
  { keys: ['F8'], description: 'Toggle Ortho.' },
  { keys: ['F9'], description: 'Toggle object snapping.' },
  { keys: ['F10'], description: 'Toggle polar tracking.' },
  { keys: ['Wheel', 'Middle drag'], description: 'Zoom or pan the drawing canvas.' },
  { keys: ['Double middle-click'], description: 'Frame all drawing geometry.' },
]

const GEOMETRY_NODE_SHORTCUTS = [
  { keys: ['Shift + A'], description: 'Open the searchable Add Node menu.' },
  { keys: ['X', 'Delete', 'Backspace'], description: 'Delete selected nodes or wires.' },
  { keys: ['Home'], description: 'Frame every node in the active graph.' },
  { keys: ['Ctrl/⌘ + Z'], description: 'Undo the last graph edit.' },
  { keys: ['Ctrl/⌘ + Shift + Z', 'Ctrl/⌘ + Y'], description: 'Redo the last graph edit.' },
  { keys: ['Esc'], description: 'Cancel a connection or close the Add Node menu.' },
  { keys: ['Right-click blank space'], description: 'Open Add Node at the pointer.' },
  { keys: ['Drag socket → blank space'], description: 'Search for nodes with a compatible socket.' },
  { keys: ['Drag node → wire'], description: 'Insert a compatible node into the existing flow.' },
  { keys: ['Double-click wire'], description: 'Remove a connection.' },
  { keys: ['Wheel', 'Left or middle drag'], description: 'Zoom or pan the node graph.' },
]

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

function commandLabel(name) {
  return String(name).replace(/_/g, ' ')
}

class HelpSession {
  constructor(editor) {
    this.editor = editor
    this.activeCategory = 'All'
    this.previousFocus = null
    this.suppressedKeyups = new Set()
    this.commandRecords = []
    this.filterButtons = new Map()

    this._build()
    this._bind()

    editor.helpSession = this
    window.openCommandHelp = () => this.open()
  }

  get isOpen() {
    return !!this.dialog?.open
  }

  open() {
    if (this.isOpen) {
      this.searchInput.focus({ preventScroll: true })
      this.searchInput.select()
      return
    }

    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof this.dialog.showModal === 'function') {
      this.dialog.showModal()
    } else {
      this.dialog.setAttribute('open', '')
      this.dialog.classList.add('is-fallback-open')
    }
    this.dialog.setAttribute('aria-hidden', 'false')
    this._updateResults()
    requestAnimationFrame(() => {
      this.searchInput.focus({ preventScroll: true })
      this.searchInput.select()
    })
  }

  close() {
    if (!this.isOpen) return
    if (typeof this.dialog.close === 'function') {
      this.dialog.close()
    } else {
      this.dialog.removeAttribute('open')
      this.dialog.classList.remove('is-fallback-open')
      this._afterClose()
    }
  }

  _build() {
    const dialog = el('dialog', 'command-help-dialog')
    dialog.id = 'command-help-dialog'
    dialog.setAttribute('aria-labelledby', 'command-help-title')
    dialog.setAttribute('aria-describedby', 'command-help-intro')
    dialog.setAttribute('aria-hidden', 'true')

    const shell = el('div', 'command-help-shell')

    const header = el('header', 'command-help-header')
    const heading = el('div', 'command-help-heading')
    heading.append(
      el('span', 'command-help-eyebrow', 'Nanquim reference'),
      el('h2', 'command-help-title', 'Commands & shortcuts'),
      el('p', 'command-help-intro', 'Search every available CAD command, then keep the essential canvas and Geometry Nodes controls close at hand.'),
    )
    heading.querySelector('h2').id = 'command-help-title'
    heading.querySelector('p').id = 'command-help-intro'

    const closeButton = el('button', 'command-help-close', '×')
    closeButton.id = 'command-help-close'
    closeButton.type = 'button'
    closeButton.setAttribute('aria-label', 'Close command help')
    closeButton.title = 'Close (Esc)'
    header.append(heading, closeButton)

    const tools = el('div', 'command-help-tools')
    const searchWrap = el('label', 'command-help-search-wrap')
    searchWrap.setAttribute('for', 'command-help-search')
    const searchIcon = el('span', 'command-help-search-icon')
    searchIcon.setAttribute('aria-hidden', 'true')
    const searchInput = el('input', 'command-help-search')
    searchInput.id = 'command-help-search'
    searchInput.type = 'search'
    searchInput.placeholder = 'Search commands, aliases, or actions…'
    searchInput.autocomplete = 'off'
    searchInput.spellcheck = false
    searchInput.setAttribute('aria-label', 'Search commands')
    const searchHint = el('kbd', 'command-help-search-hint', 'Ctrl/⌘ F')
    searchWrap.append(searchIcon, searchInput, searchHint)

    const filters = el('div', 'command-help-filters')
    filters.setAttribute('aria-label', 'Filter commands by category')
    ;['All', ...commandCategories].forEach((category) => {
      const button = el('button', 'command-help-filter', category)
      button.type = 'button'
      button.dataset.category = category
      button.setAttribute('aria-pressed', String(category === 'All'))
      this.filterButtons.set(category, button)
      filters.appendChild(button)
    })
    tools.append(searchWrap, filters)

    const scroller = el('div', 'command-help-scroller')
    const commandSection = el('section', 'command-help-command-section')
    commandSection.setAttribute('aria-labelledby', 'command-help-command-heading')
    const sectionHeader = el('div', 'command-help-section-header')
    const sectionTitle = el('div')
    const commandsHeading = el('h3', '', 'Command terminal')
    commandsHeading.id = 'command-help-command-heading'
    sectionTitle.append(commandsHeading, el('p', '', 'Type a command name or one of its aliases, then press Space or Enter.'))
    const count = el('span', 'command-help-count')
    count.id = 'command-help-count'
    count.setAttribute('role', 'status')
    count.setAttribute('aria-live', 'polite')
    sectionHeader.append(sectionTitle, count)

    const groups = el('div', 'command-help-groups')
    commandCategories.forEach((category) => {
      const group = el('section', 'command-help-group')
      group.dataset.category = category
      const groupHeading = el('div', 'command-help-group-heading')
      groupHeading.append(el('h4', '', category), el('span', 'command-help-group-count'))
      const cards = el('div', 'command-help-card-grid')

      Object.entries(commands)
        .filter(([, command]) => command.category === category)
        .forEach(([name, command]) => {
          const card = this._buildCommandCard(name, command)
          cards.appendChild(card)
          this.commandRecords.push({
            element: card,
            group,
            category,
            haystack: normalize([name, commandLabel(name), category, command.description, ...(command.aliases || [])].join(' ')),
          })
        })

      group.append(groupHeading, cards)
      groups.appendChild(group)
    })

    const empty = el('div', 'command-help-empty')
    empty.id = 'command-help-empty'
    empty.hidden = true
    empty.append(el('strong', '', 'No matching commands'), el('span', '', 'Try a command name, alias, or a broader action such as “draw”.'))
    commandSection.append(sectionHeader, groups, empty)

    const shortcutSection = el('section', 'command-help-shortcut-section')
    shortcutSection.setAttribute('aria-labelledby', 'command-help-shortcut-heading')
    const shortcutHeading = el('div', 'command-help-section-header')
    const shortcutTitle = el('div')
    const shortcutsH3 = el('h3', '', 'Quick controls')
    shortcutsH3.id = 'command-help-shortcut-heading'
    shortcutTitle.append(shortcutsH3, el('p', '', 'Shortcuts follow whichever editor surface is active.'))
    shortcutHeading.appendChild(shortcutTitle)
    const shortcutColumns = el('div', 'command-help-shortcut-columns')
    shortcutColumns.append(
      this._buildShortcutGroup('Terminal & canvas', TERMINAL_SHORTCUTS),
      this._buildShortcutGroup('Geometry Nodes', GEOMETRY_NODE_SHORTCUTS),
    )
    shortcutSection.append(shortcutHeading, shortcutColumns)

    scroller.append(commandSection, shortcutSection)
    shell.append(header, tools, scroller)
    dialog.appendChild(shell)
    document.body.appendChild(dialog)

    this.dialog = dialog
    this.shell = shell
    this.closeButton = closeButton
    this.searchInput = searchInput
    this.groups = groups
    this.empty = empty
    this.count = count
  }

  _buildCommandCard(name, command) {
    const card = el('article', 'command-help-card')
    const top = el('div', 'command-help-card-top')
    top.appendChild(el('code', 'command-help-command-name', commandLabel(name)))
    const aliases = el('span', 'command-help-aliases')
    ;(command.aliases || []).forEach((alias) => aliases.appendChild(el('kbd', '', String(alias).toUpperCase())))
    top.appendChild(aliases)
    card.appendChild(top)
    const illustration = createCommandIllustration(name)
    if (illustration) card.appendChild(illustration)
    card.appendChild(el('p', '', command.description || `Run the ${commandLabel(name)} command.`))
    const availability = command.modes.length === 2
      ? 'Available in Model and Paper Space'
      : `Available in ${command.modes[0] === 'paper' ? 'Paper' : 'Model'} Space only`
    card.appendChild(el('small', 'command-help-availability', availability))
    return card
  }

  _buildShortcutGroup(title, entries) {
    const group = el('article', 'command-help-shortcut-group')
    group.appendChild(el('h4', '', title))
    const list = el('div', 'command-help-shortcut-list')
    entries.forEach((entry) => {
      const row = el('div', 'command-help-shortcut-row')
      const keys = el('span', 'command-help-shortcut-keys')
      entry.keys.forEach((key) => keys.appendChild(el('kbd', '', key)))
      row.append(keys, el('span', 'command-help-shortcut-description', entry.description))
      list.appendChild(row)
    })
    group.appendChild(list)
    return group
  }

  _bind() {
    document.getElementById('command-help-open')?.addEventListener('click', () => this.open())
    this.closeButton.addEventListener('click', () => this.close())
    this.searchInput.addEventListener('input', () => this._updateResults())

    this.filterButtons.forEach((button, category) => {
      button.addEventListener('click', () => {
        this.activeCategory = category
        this.filterButtons.forEach((candidate, candidateCategory) => {
          candidate.setAttribute('aria-pressed', String(candidateCategory === category))
        })
        this._updateResults()
      })
    })

    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      this.close()
    })
    this.dialog.addEventListener('close', () => this._afterClose())
    this.dialog.addEventListener('contextmenu', (event) => event.stopPropagation())
    this.dialog.addEventListener('click', (event) => {
      if (event.target !== this.dialog) return
      const rect = this.dialog.getBoundingClientRect()
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      if (!inside) this.close()
    })

    window.addEventListener('keydown', (event) => this._guardKeyDown(event), true)
    window.addEventListener('keyup', (event) => this._guardKeyUp(event), true)
  }

  _guardKeyDown(event) {
    const isF1 = event.key === 'F1' || event.code === 'F1'
    if (!this.isOpen && !isF1) return

    this.suppressedKeyups.add(event.code || event.key)
    event.stopImmediatePropagation()

    if (isF1) {
      event.preventDefault()
      if (this.isOpen) this.close()
      else this.open()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
      event.preventDefault()
      this.searchInput.focus({ preventScroll: true })
      this.searchInput.select()
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      this._moveFocus(event.shiftKey ? -1 : 1)
      return
    }

    const target = event.target
    if (target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      target.click()
      return
    }

    if (target !== this.searchInput && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      this.searchInput.focus({ preventScroll: true })
      this.searchInput.value += event.key
      this._updateResults()
    }
  }

  _guardKeyUp(event) {
    const key = event.code || event.key
    if (!this.isOpen && !this.suppressedKeyups.has(key)) return
    event.stopImmediatePropagation()
    this.suppressedKeyups.delete(key)
  }

  _moveFocus(direction) {
    const focusable = Array.from(this.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && !node.closest('[hidden]'))
    if (!focusable.length) return
    const current = focusable.indexOf(document.activeElement)
    const next = current < 0 ? 0 : (current + direction + focusable.length) % focusable.length
    focusable[next].focus({ preventScroll: true })
  }

  _updateResults() {
    const query = normalize(this.searchInput.value)
    let visibleCount = 0
    const groupCounts = new Map(commandCategories.map((category) => [category, 0]))

    this.commandRecords.forEach((record) => {
      const categoryMatches = this.activeCategory === 'All' || record.category === this.activeCategory
      const queryMatches = !query || record.haystack.includes(query)
      const visible = categoryMatches && queryMatches
      record.element.hidden = !visible
      if (visible) {
        visibleCount += 1
        groupCounts.set(record.category, (groupCounts.get(record.category) || 0) + 1)
      }
    })

    this.groups.querySelectorAll('.command-help-group').forEach((group) => {
      const groupCount = groupCounts.get(group.dataset.category) || 0
      group.hidden = groupCount === 0
      const badge = group.querySelector('.command-help-group-count')
      if (badge) badge.textContent = `${groupCount}`
    })

    const total = this.commandRecords.length
    this.count.textContent = visibleCount === total ? `${total} commands` : `${visibleCount} of ${total} commands`
    this.empty.hidden = visibleCount !== 0
  }

  _afterClose() {
    this.dialog.setAttribute('aria-hidden', 'true')
    this.dialog.classList.remove('is-fallback-open')
    const restore = this.previousFocus
    this.previousFocus = null
    if (restore?.isConnected && typeof restore.focus === 'function') {
      requestAnimationFrame(() => restore.focus({ preventScroll: true }))
    }
  }
}

export { HelpSession }
