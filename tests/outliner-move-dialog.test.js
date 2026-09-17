// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createDeterministicEditorFixture, installDomListenerTracker } from './support/deterministic-harness.js'

let fixture
let editor
let collection
let listeners
let outliner
let originalShowModal
let originalClose
let terminalKeydown
let terminalKeyup
let windowListeners

function dialog() {
  return document.querySelector('dialog.outliner-move-dialog[open]')
}

function key(target, value, options = {}, type = 'keydown') {
  const event = new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...options })
  target.dispatchEvent(event)
  return event
}

function hover(inside = true) {
  outliner.dispatchEvent(new Event(inside ? 'pointerenter' : 'pointerleave'))
}

function addCollection(id, options = {}) {
  const group = editor.drawing.group().attr({ id, name: id, 'data-collection': 'true' })
  editor.collections.set(id, {
    group,
    name: id,
    visible: true,
    locked: false,
    style: { stroke: '#00ff00', 'stroke-width': 0.5, fill: 'transparent', opacity: 1 },
    ...options,
  })
  return group
}

function selectElements(...elements) {
  editor.selected = elements
  editor.signals.updatedOutliner.dispatch()
  editor.signals.updatedSelection.dispatch()
}

function openMove() {
  hover()
  const event = key(document.activeElement, 'm')
  expect(event.defaultPrevented).toBe(true)
  expect(dialog()).not.toBeNull()
  return dialog()
}

function choose(value) {
  const input = dialog().querySelector('select[name="collection"]')
  input.value = value
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function submit() {
  dialog().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('Outliner move-to-collection dialog', () => {
  beforeEach(async () => {
    vi.resetModules()
    document.body.innerHTML = '<section class="outliner"><div class="outliner-container"><div id="drawing-tree"></div></div></section>'
    listeners = installDomListenerTracker()
    // Window owns its event methods in jsdom, so the EventTarget tracker alone
    // does not clean up the shortcut's capture listeners between fixtures.
    windowListeners = []
    const addWindowListener = window.addEventListener
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      windowListeners.push({ type, listener, options })
      return addWindowListener.call(window, type, listener, options)
    })
    fixture = createDeterministicEditorFixture()
    editor = fixture.editor
    collection = editor.activeCollection
    editor.commandSessionRevision = 0
    editor.suppressHandlers = true
    Object.assign(editor.collections.get(collection.id()), { visible: true, locked: false })
    outliner = document.querySelector('.outliner')

    // Keep the same open/close lifecycle as a native dialog without claiming
    // that jsdom proves browser focus trapping or backdrop behavior.
    const prototype = window.HTMLDialogElement.prototype
    originalShowModal = Object.getOwnPropertyDescriptor(prototype, 'showModal')
    originalClose = Object.getOwnPropertyDescriptor(prototype, 'close')
    Object.defineProperty(prototype, 'showModal', {
      configurable: true,
      value() { this.setAttribute('open', '') },
    })
    Object.defineProperty(prototype, 'close', {
      configurable: true,
      value() {
        if (!this.open) return
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      },
    })

    // Modal ownership must stop keys before document bubble listeners, even
    // when another interface's listener was registered first.
    terminalKeydown = vi.fn()
    terminalKeyup = vi.fn()
    document.addEventListener('keydown', terminalKeydown)
    document.addEventListener('keyup', terminalKeyup)
    const { Outliner } = await import('../src/js/Outliner.js')
    new Outliner(editor)
  })

  afterEach(() => {
    dialog()?.close()
    fixture?.dispose()
    windowListeners.forEach(({ type, listener, options }) => window.removeEventListener(type, listener, options))
    listeners?.dispose()
    const prototype = window.HTMLDialogElement.prototype
    if (originalShowModal) Object.defineProperty(prototype, 'showModal', originalShowModal)
    else delete prototype.showModal
    if (originalClose) Object.defineProperty(prototype, 'close', originalClose)
    else delete prototype.close
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  test('opens only while the pointer is over the Outliner and captures M from the empty terminal', () => {
    const moving = collection.line(0, 0, 20, 10)
    selectElements(moving)
    fixture.terminal.input.focus()

    expect(key(fixture.terminal.input, 'm').defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
    terminalKeydown.mockClear()
    const modal = openMove()
    expect(terminalKeydown).not.toHaveBeenCalled()
    expect(modal.contains(document.activeElement)).toBe(true)
    expect(fixture.terminal.input.value).toBe('')
    expect(editor.selected).toEqual([moving])
    expect(editor.history.undos).toHaveLength(0)

    key(document.activeElement, 'Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(fixture.terminal.input)
    hover(false)
    expect(key(fixture.terminal.input, 'm').defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
  })

  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['repeat', { repeat: true }],
  ])('does not replace the %s shortcut or repeat a held key', (_label, options) => {
    selectElements(collection.rect(20, 10))
    hover()
    expect(key(document.body, 'm', options).defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
  })

  test('opens over the Outliner with terminal text preserved while leaving foreign editable controls alone', () => {
    selectElements(collection.rect(20, 10))
    hover()
    fixture.terminal.input.value = 'li'
    fixture.terminal.input.focus()
    expect(key(fixture.terminal.input, 'm').defaultPrevented).toBe(true)
    expect(dialog()).not.toBeNull()
    expect(fixture.terminal.input.value).toBe('li')
    key(document.activeElement, 'Escape')
    expect(fixture.terminal.input.value).toBe('li')

    fixture.terminal.input.value = ''
    const input = document.createElement('input')
    outliner.appendChild(input)
    input.focus()
    expect(key(input, 'm').defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.innerHTML = '<span>Collection name</span>'
    outliner.appendChild(editable)
    editable.focus()
    expect(key(editable.firstChild, 'm').defaultPrevented).toBe(false)
    expect(dialog()).toBeNull()
  })

  test.each(['isDrawing', 'isInteracting', 'isEditingVertex', 'isTypingText'])('does not interrupt %s', (flag) => {
    selectElements(collection.rect(20, 10))
    editor[flag] = true
    hover()
    key(document.body, 'm')
    expect(dialog()).toBeNull()
    expect(editor[flag]).toBe(true)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('does not open in Geometry Nodes', () => {
    selectElements(collection.rect(20, 10))
    editor.activeEditor = 'geometry-nodes'
    hover()
    key(document.body, 'm')
    expect(dialog()).toBeNull()
  })

  test.each([
    ['Paper Space', 'mode', 'paper'],
    ['block editing', 'editingBlock', {}],
  ])('explains why moving collections is unavailable in %s', (_label, property, value) => {
    const moving = collection.rect(20, 10)
    selectElements(moving)
    editor[property] = value
    const modal = openMove()
    expect(modal.querySelector('[type="submit"]').disabled).toBe(true)
    expect(modal.querySelector('[role="status"]').textContent.trim()).not.toBe('')
    submit()
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('does not open above another modal', () => {
    selectElements(collection.rect(20, 10))
    const other = document.createElement('dialog')
    document.body.appendChild(other)
    other.showModal()
    hover()
    key(document.body, 'm')
    expect(dialog()).toBeNull()
    expect(other.open).toBe(true)
  })

  test('explains why a Paper viewport selected from the Outliner cannot move to a collection', () => {
    editor.mode = 'paper'
    editor.selected = [{ _paperVp: {} }]
    const modal = openMove()
    expect(modal.querySelector('[type="submit"]').disabled).toBe(true)
    expect(modal.querySelector('[role="status"]').textContent).toContain('Model')
    expect(editor.history.undos).toHaveLength(0)
  })

  test.each([false, true])('explains a selection with no movable contents (collection selected: %s)', (collectionSelected) => {
    const selected = collectionSelected ? [collection] : []
    selectElements(...selected)
    const modal = openMove()
    expect(modal.querySelector('[type="submit"]').disabled).toBe(true)
    expect(modal.querySelector('[role="status"]').textContent.trim()).not.toBe('')
    expect(editor.history.undos).toHaveLength(0)
    modal.querySelector('button[type="button"]').click()
    expect(dialog()).toBeNull()
    expect(editor.selected).toEqual(selected)
  })

  test('offers existing editable collections and moves the captured selection with Undo/Redo', () => {
    const moving = collection.rect(20, 10).attr('id', 'moving')
    const remaining = collection.rect(5, 5).attr('id', 'remaining')
    const destination = addCollection('destination')
    addCollection('locked', { locked: true })
    selectElements(collection, moving)
    const modal = openMove()
    const values = [...modal.querySelectorAll('select[name="collection"] option')].map(option => option.value)
    expect(values).toContain('destination')
    expect(values).toContain('new')
    expect(values).not.toContain('locked')

    // A background selection change must not retarget an already open dialog.
    editor.selected = [remaining]
    choose('destination')
    submit()

    expect(dialog()).toBeNull()
    expect(moving.parent()).toBe(destination)
    expect(remaining.parent()).toBe(collection)
    expect(collection.parent()).toBe(editor.drawing)
    expect(editor.history.undos).toHaveLength(1)
    editor.history.undo()
    expect(moving.parent()).toBe(collection)
    editor.history.redo()
    expect(moving.parent()).toBe(destination)
  })

  test('creates a named collection and moves the elements in one undoable submission', () => {
    const moving = collection.rect(20, 10)
    selectElements(moving)
    openMove()
    choose('new')
    const input = dialog().querySelector('input[name="collection-name"]')
    input.value = 'Details & notes'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(dialog().querySelector('[type="submit"]').disabled).toBe(false)
    submit()

    expect(dialog()).toBeNull()
    const created = moving.parent()
    expect(created.attr('name')).toBe('Details & notes')
    expect(editor.collections.get(created.id()).group).toBe(created)
    expect(editor.history.undos).toHaveLength(1)
    editor.history.undo()
    expect(moving.parent()).toBe(collection)
    expect(editor.collections.has(created.id())).toBe(false)
    expect(created.node.isConnected).toBe(false)
    editor.history.redo()
    expect(moving.parent()).toBe(created)
    expect(editor.collections.get(created.id()).group).toBe(created)
  })

  test('distinguishes an existing collection whose ID is new from creating a collection', () => {
    const moving = collection.rect(20, 10)
    const destination = addCollection('new')
    selectElements(moving)
    openMove()
    choose('new')
    expect(dialog().querySelector('input[name="collection-name"]').disabled).toBe(true)
    submit()
    expect(moving.parent()).toBe(destination)
    expect(editor.collections.size).toBe(2)
    editor.history.undo()

    openMove()
    const select = dialog().querySelector('select[name="collection"]')
    // Setting option.selected also refreshes jsdom's selectedOptions cache.
    select.options[select.options.length - 1].selected = true
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const input = dialog().querySelector('input[name="collection-name"]')
    expect(input.disabled).toBe(false)
    input.value = 'Another collection'
    submit()
    expect(moving.parent()).not.toBe(destination)
    expect(moving.parent().attr('name')).toBe('Another collection')
    expect(editor.collections.size).toBe(3)
  })

  test('keeps an invalid new collection name editable without partially moving elements', () => {
    const moving = collection.rect(20, 10)
    selectElements(moving)
    openMove()
    choose('new')
    const input = dialog().querySelector('input[name="collection-name"]')
    input.value = '   '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    submit()
    expect(dialog()).not.toBeNull()
    expect(dialog().querySelector('[role="status"]').textContent.trim()).not.toBe('')
    expect(moving.parent()).toBe(collection)
    expect(editor.collections.size).toBe(1)
    expect(editor.history.undos).toHaveLength(0)

    input.value = 'Details'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    submit()
    expect(dialog()).toBeNull()
    expect(moving.parent().attr('name')).toBe('Details')
    expect(editor.history.undos).toHaveLength(1)
  })

  test('keeps Tab and Shift+Tab within the modal controls', () => {
    selectElements(collection.rect(20, 10))
    const modal = openMove()
    const last = modal.querySelector('[type="submit"]')
    const first = modal.querySelector('select[name="collection"]')
    last.focus()
    key(last, 'Tab')
    expect(document.activeElement).toBe(first)
    key(first, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
    expect(terminalKeydown).not.toHaveBeenCalled()
  })

  test('keeps text paste inside the modal without feeding the terminal import listener', () => {
    selectElements(collection.rect(20, 10))
    const modal = openMove()
    const terminalPaste = vi.fn()
    document.addEventListener('paste', terminalPaste)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    modal.querySelector('input[name="collection-name"]').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(terminalPaste).not.toHaveBeenCalled()
    expect(editor.history.undos).toHaveLength(0)
  })

  test('cancels without clearing selection or letting modal Escape and its keyup reach Terminal', () => {
    const moving = collection.rect(20, 10)
    selectElements(moving)
    fixture.terminal.input.focus()
    openMove()
    terminalKeydown.mockClear()
    terminalKeyup.mockClear()
    key(document.activeElement, 'm', {}, 'keyup')
    key(document.activeElement, 'ArrowDown')
    key(document.activeElement, 'ArrowDown', {}, 'keyup')
    key(document.activeElement, 'Escape')
    key(document.activeElement, 'Escape', {}, 'keyup')
    expect(dialog()).toBeNull()
    expect(editor.selected).toEqual([moving])
    expect(editor.history.undos).toHaveLength(0)
    expect(terminalKeydown).not.toHaveBeenCalled()
    expect(terminalKeyup).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(fixture.terminal.input)

    // Closing must not retain a blanket keyboard interceptor.
    key(fixture.terminal.input, 'l')
    expect(terminalKeydown).toHaveBeenCalledOnce()
  })

  test.each(['documentSessionReset', 'editorModeChanged', 'activeEditorChanged', 'commandCancelled'])('closes on %s without changing ownership', (signal) => {
    const moving = collection.rect(20, 10)
    selectElements(moving)
    openMove()
    editor.signals[signal].dispatch()
    expect(dialog()).toBeNull()
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
  })

  test.each(['command session', 'document root'])('rejects a submission after the %s changed', (changed) => {
    const moving = collection.rect(20, 10)
    addCollection('destination')
    selectElements(moving)
    openMove()
    choose('destination')
    if (changed === 'command session') editor.commandSessionRevision += 1
    else editor.drawing = editor.svg.group()
    submit()
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
    expect(dialog()).toBeNull()
  })

  test('revalidates a destination locked while the modal was open', () => {
    const moving = collection.rect(20, 10)
    addCollection('destination')
    selectElements(moving)
    openMove()
    choose('destination')
    editor.collections.get('destination').locked = true
    submit()
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
    expect(dialog().querySelector('[role="status"]').textContent.trim()).not.toBe('')
  })
})
