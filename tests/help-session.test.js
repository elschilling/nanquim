// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { HelpSession } from '../src/js/HelpSession.js'
import {
  COMMAND_ILLUSTRATION_NAMES,
  createCommandIllustration,
  hasCommandIllustration,
} from '../src/js/CommandIllustrations.js'
import commands, { commandCategories } from '../src/js/commands/_commands.js'
import { helpCommand } from '../src/js/commands/HelpCommand.js'

const expectedCommands = [
  'HELP',
  'LINE',
  'CIRCLE',
  'ELLIPSE',
  'RECTANGLE',
  'MOVE',
  'COPY',
  'ROTATE',
  'SCALE',
  'OFFSET',
  'FILLET',
  'MATCH_PROPERTIES',
  'ERASE',
  'EXTEND',
  'TRIM',
  'ARC',
  'DIST',
  'MIRROR',
  'GROUP',
  'UNGROUP',
  'HATCH',
  'TEXT',
  'POLYLINE',
  'SPLINE',
  'VIEWPORT',
  'DIMLINEAR',
  'DIMALIGNED',
  'AREA',
  'BLOCK',
  'INSERT',
]

describe('help command registry', () => {
  test('contains every terminal command in the help catalog', () => {
    expect(Object.keys(commands)).toEqual(expectedCommands)
    expect(commandCategories).toEqual([
      'General',
      'Draw',
      'Modify',
      'Organize',
      'Measure & Annotate',
      'Paper Space',
    ])
  })

  test('gives every command complete, searchable metadata', () => {
    const aliases = []
    const usedCategories = new Set()

    for (const [name, definition] of Object.entries(commands)) {
      expect(definition.execute, `${name} execute`).toBeTypeOf('function')
      expect(definition.aliases, `${name} aliases`).toEqual(expect.any(Array))
      expect(definition.aliases.length, `${name} aliases`).toBeGreaterThan(0)
      expect(definition.category, `${name} category`).toBeTypeOf('string')
      expect(commandCategories, `${name} category`).toContain(definition.category)
      expect(definition.description, `${name} description`).toBeTypeOf('string')
      expect(definition.description.trim().length, `${name} description`).toBeGreaterThan(12)

      definition.aliases.forEach(alias => {
        expect(alias, `${name} alias`).toBe(alias.toLowerCase())
        expect(alias.trim(), `${name} alias`).toBe(alias)
        aliases.push(alias)
      })
      usedCategories.add(definition.category)
    }

    expect(new Set(aliases).size).toBe(aliases.length)
    expect([...usedCategories]).toEqual(expect.arrayContaining(commandCategories))
  })

  test('registers HELP with discoverable aliases and the delegating command', () => {
    expect(commands.HELP).toMatchObject({
      execute: helpCommand,
      aliases: ['help', '?'],
      category: 'General',
    })
  })

  test('provides one decorative SVG illustration for every command', () => {
    expect([...COMMAND_ILLUSTRATION_NAMES].sort()).toEqual([...expectedCommands].sort())

    expectedCommands.forEach((name) => {
      expect(hasCommandIllustration(name), name).toBe(true)
      const illustration = createCommandIllustration(name)
      expect(illustration, name).toBeInstanceOf(SVGElement)
      expect(illustration.dataset.commandIllustration, name).toBe(name)
      expect(illustration.getAttribute('viewBox'), name).toBe('0 0 160 96')
      expect(illustration.getAttribute('aria-hidden'), name).toBe('true')
      expect(illustration.getAttribute('focusable'), name).toBe('false')
      expect(illustration.querySelectorAll('.command-help-illustration-shape').length, name).toBeGreaterThan(0)
    })

    expect(hasCommandIllustration('NOT_A_COMMAND')).toBe(false)
    expect(createCommandIllustration('NOT_A_COMMAND')).toBeNull()
  })
})

describe('HelpCommand', () => {
  test('delegates to the editor help session', () => {
    const open = vi.fn()

    helpCommand({ helpSession: { open } })

    expect(open).toHaveBeenCalledOnce()
  })

  test('reports an unavailable session through the terminal', () => {
    const dispatch = vi.fn()

    helpCommand({ signals: { terminalLogged: { dispatch } } })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'span',
      msg: 'Help is not available.',
    })
  })
})

function dispatchInput(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function visibleCommandCards(dialog) {
  return Array.from(dialog.querySelectorAll('.command-help-card')).filter(card => !card.hidden)
}

function commandNames(cards) {
  return cards.map(card => card.querySelector('.command-help-command-name').textContent.replace(/ /g, '_'))
}

describe('HelpSession', () => {
  let editor
  let helpSession
  let opener
  let dialogPrototype
  let originalShowModal
  let originalClose

  beforeAll(() => {
    document.body.innerHTML = `
      <button id="focus-before-help" type="button">Canvas control</button>
      <button id="command-help-open" type="button">Help</button>
    `

    // jsdom exposes HTMLDialogElement and its open property, but not the
    // showModal()/close() methods that browsers use. Keep the native code path
    // realistic, including the close event consumed by HelpSession.
    dialogPrototype = window.HTMLDialogElement.prototype
    originalShowModal = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal')
    originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, 'close')
    Object.defineProperty(dialogPrototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '')
      },
    })
    Object.defineProperty(dialogPrototype, 'close', {
      configurable: true,
      value(returnValue = '') {
        if (!this.open) return
        this.returnValue = returnValue
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      },
    })

    editor = {}
    helpSession = new HelpSession(editor)
    opener = document.getElementById('focus-before-help')
  })

  beforeEach(() => {
    if (helpSession.isOpen) helpSession.close()
    dispatchInput(helpSession.searchInput, '')
    helpSession.filterButtons.get('All').click()
    opener.focus()
  })

  afterEach(() => {
    if (helpSession.isOpen) helpSession.close()
  })

  afterAll(() => {
    helpSession.dialog.remove()
    delete window.openCommandHelp

    if (originalShowModal) Object.defineProperty(dialogPrototype, 'showModal', originalShowModal)
    else delete dialogPrototype.showModal
    if (originalClose) Object.defineProperty(dialogPrototype, 'close', originalClose)
    else delete dialogPrototype.close
  })

  test('publishes the API and renders every registered command', () => {
    expect(editor.helpSession).toBe(helpSession)
    expect(window.openCommandHelp).toBeTypeOf('function')

    window.openCommandHelp()

    expect(helpSession.isOpen).toBe(true)
    expect(helpSession.dialog.id).toBe('command-help-dialog')
    expect(helpSession.dialog.getAttribute('aria-hidden')).toBe('false')
    expect(helpSession.count.textContent).toBe(`${expectedCommands.length} commands`)
    expect(commandNames(visibleCommandCards(helpSession.dialog)).sort()).toEqual([...expectedCommands].sort())

    const illustrations = helpSession.dialog.querySelectorAll('.command-help-card > .command-help-illustration')
    expect(illustrations).toHaveLength(expectedCommands.length)
    illustrations.forEach((illustration) => {
      const card = illustration.closest('.command-help-card')
      const commandName = card.querySelector('.command-help-command-name').textContent.replace(/ /g, '_')
      expect(illustration.dataset.commandIllustration).toBe(commandName)
      expect(illustration.getAttribute('aria-hidden')).toBe('true')
      expect(illustration.hasAttribute('tabindex')).toBe(false)
    })

    const availability = Object.fromEntries(
      [...helpSession.dialog.querySelectorAll('.command-help-card')].map((card) => [
        card.querySelector('.command-help-command-name').textContent.replace(/ /g, '_'),
        card.querySelector('.command-help-availability').textContent,
      ]),
    )
    expect(availability.LINE).toBe('Available in Model and Paper Space')
    expect(availability.BLOCK).toBe('Available in Model Space only')
    expect(availability.VIEWPORT).toBe('Available in Paper Space only')
  })

  test('opens from F1 and moves focus to command search', async () => {
    const event = new KeyboardEvent('keydown', {
      key: 'F1',
      code: 'F1',
      bubbles: true,
      cancelable: true,
    })

    document.body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(helpSession.isOpen).toBe(true)
    await vi.waitFor(() => expect(document.activeElement).toBe(helpSession.searchInput))
  })

  test('filters by search and category while keeping result counts accurate', () => {
    helpSession.open()

    dispatchInput(helpSession.searchInput, 'circle')
    expect(commandNames(visibleCommandCards(helpSession.dialog))).toEqual(['CIRCLE'])
    expect(helpSession.count.textContent).toBe(`1 of ${expectedCommands.length} commands`)

    dispatchInput(helpSession.searchInput, '')
    helpSession.filterButtons.get('Modify').click()
    const modifyCommands = Object.entries(commands)
      .filter(([, definition]) => definition.category === 'Modify')
      .map(([name]) => name)
    expect(commandNames(visibleCommandCards(helpSession.dialog)).sort()).toEqual(modifyCommands.sort())
    expect(helpSession.count.textContent).toBe(`${modifyCommands.length} of ${expectedCommands.length} commands`)
    expect(helpSession.filterButtons.get('Modify').getAttribute('aria-pressed')).toBe('true')
    expect(helpSession.filterButtons.get('All').getAttribute('aria-pressed')).toBe('false')

    dispatchInput(helpSession.searchInput, 'fillet')
    expect(commandNames(visibleCommandCards(helpSession.dialog))).toEqual(['FILLET'])
    expect(helpSession.count.textContent).toBe(`1 of ${expectedCommands.length} commands`)

    dispatchInput(helpSession.searchInput, 'no-such-nanquim-command')
    expect(visibleCommandCards(helpSession.dialog)).toHaveLength(0)
    expect(helpSession.count.textContent).toBe(`0 of ${expectedCommands.length} commands`)
    expect(helpSession.empty.hidden).toBe(false)
  })

  test('closes on Escape and backdrop clicks, restoring prior focus', async () => {
    helpSession.open()
    await vi.waitFor(() => expect(document.activeElement).toBe(helpSession.searchInput))

    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    helpSession.searchInput.dispatchEvent(escapeEvent)

    expect(escapeEvent.defaultPrevented).toBe(true)
    expect(helpSession.isOpen).toBe(false)
    await vi.waitFor(() => expect(document.activeElement).toBe(opener))

    helpSession.open()
    await vi.waitFor(() => expect(document.activeElement).toBe(helpSession.searchInput))
    helpSession.dialog.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: -1,
      clientY: -1,
    }))

    expect(helpSession.isOpen).toBe(false)
    await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  })

  test('suppresses downstream document shortcuts while the dialog is open', () => {
    const documentKeydown = vi.fn()
    const documentKeyup = vi.fn()
    document.addEventListener('keydown', documentKeydown)
    document.addEventListener('keyup', documentKeyup)

    try {
      helpSession.open()
      helpSession.searchInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete',
        code: 'Delete',
        bubbles: true,
        cancelable: true,
      }))
      helpSession.searchInput.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Delete',
        code: 'Delete',
        bubbles: true,
        cancelable: true,
      }))

      expect(documentKeydown).not.toHaveBeenCalled()
      expect(documentKeyup).not.toHaveBeenCalled()

      helpSession.close()
      opener.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete',
        code: 'Delete',
        bubbles: true,
      }))
      opener.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Delete',
        code: 'Delete',
        bubbles: true,
      }))
      expect(documentKeydown).toHaveBeenCalledOnce()
      expect(documentKeyup).toHaveBeenCalledOnce()
    } finally {
      document.removeEventListener('keydown', documentKeydown)
      document.removeEventListener('keyup', documentKeyup)
    }
  })
})
