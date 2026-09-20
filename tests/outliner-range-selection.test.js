// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createDeterministicEditorFixture, installDomListenerTracker } from './support/deterministic-harness.js'

let fixture
let editor
let collection
let listeners
let windowListeners

function row(element) {
  return document.getElementById('li' + element.id())
    || [...document.querySelectorAll('[data-outliner-id]')]
      .find(candidate => candidate.dataset.outlinerId === element.id())
    || null
}

function click(element, shiftKey = false) {
  row(element).querySelector('.collection-name').dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, shiftKey,
  }))
}

function render() {
  editor.signals.updatedOutliner.dispatch()
}

function rect(id, parent = collection) {
  return parent.rect(20, 10).attr('id', id)
}

function group(id, attributes = {}, parent = collection) {
  return parent.group().attr({ id, 'data-group': 'true', ...attributes })
}

function addCollection(id) {
  const added = editor.drawing.group().attr({ id, name: id, 'data-collection': 'true' })
  editor.collections.set(id, { group: added, visible: true, locked: false, style: {} })
  return added
}

describe('Outliner Shift-click range selection', () => {
  beforeEach(async () => {
    vi.resetModules()
    document.body.innerHTML = '<div class="outliner-container"><div id="drawing-tree"></div></div>'
    listeners = installDomListenerTracker()
    // Window owns its event methods in jsdom, so the EventTarget tracker alone
    // does not clean up the move shortcut's capture listeners between fixtures.
    windowListeners = []
    const addWindowListener = window.addEventListener
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      windowListeners.push({ type, listener, options })
      return addWindowListener.call(window, type, listener, options)
    })
    fixture = createDeterministicEditorFixture()
    editor = fixture.editor
    collection = editor.activeCollection
    Object.assign(editor.collections.get(collection.id()), { visible: true, locked: false })
    editor.suppressHandlers = true
    const { Outliner } = await import('../src/js/Outliner.js')
    new Outliner(editor)
  })

  afterEach(() => {
    fixture?.dispose()
    windowListeners.forEach(({ type, listener, options }) => window.removeEventListener(type, listener, options))
    listeners?.dispose()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  test('selects both endpoints and intervening elements with one selection notification', () => {
    const first = rect('first')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(first)
    editor.signals.updatedSelection.dispatch.mockClear()
    editor.signals.toogledSelect.dispatch.mockClear()
    editor.signals.clearSelection.dispatch.mockClear()

    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
    for (const element of [first, middle, last]) {
      expect(row(element).classList.contains('outliner-selected')).toBe(true)
      expect(element.hasClass('elementSelected')).toBe(true)
    }
    expect(editor.signals.updatedSelection.dispatch).toHaveBeenCalledOnce()
    expect(editor.signals.toogledSelect.dispatch).not.toHaveBeenCalled()
    expect(editor.signals.clearSelection.dispatch).not.toHaveBeenCalled()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('selects backwards from the last ordinary click', () => {
    const first = rect('first')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(last)
    click(first, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
  })

  test('replaces a repeated Shift range when shrinking and crossing the anchor', () => {
    const before = rect('before')
    const anchor = rect('anchor')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(anchor)
    click(last, true)
    click(middle, true)

    expect(new Set(editor.selected)).toEqual(new Set([anchor, middle]))
    expect(row(last).classList.contains('outliner-selected')).toBe(false)
    expect(last.hasClass('elementSelected')).toBe(false)

    click(before, true)

    expect(new Set(editor.selected)).toEqual(new Set([before, anchor]))
    expect(middle.hasClass('elementSelected')).toBe(false)
    expect(row(middle).classList.contains('outliner-selected')).toBe(false)
  })

  test('preserves independent selections and changes the anchor after an ordinary click', () => {
    const outside = rect('outside')
    rect('gap')
    const anchor = rect('anchor')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(outside)
    click(anchor)
    click(last, true)
    expect(new Set(editor.selected)).toEqual(new Set([outside, anchor, middle, last]))
    click(middle, true)
    expect(new Set(editor.selected)).toEqual(new Set([outside, anchor, middle]))

    click(last)
    click(middle, true)
    expect(new Set(editor.selected)).toEqual(new Set([outside, anchor, middle, last]))
    click(last)
    expect(editor.selected.includes(last)).toBe(false)
  })

  test('selects only rendered contents and keeps collapsed and procedural groups intact', () => {
    const first = rect('first')
    const collapsed = group('collapsed', { 'data-collapsed': 'true' })
    const collapsedChild = rect('collapsed-child', collapsed)
    const procedural = group('procedural', { 'data-geometry-nodes': 'true' })
    const generated = rect('generated', procedural).attr('data-gn-derived', 'true')
    const last = rect('last')
    render()
    expect(row(collapsedChild)).toBeNull()
    expect(row(generated)).toBeNull()

    click(first)
    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, collapsed, procedural, last]))
    expect(editor.selected.includes(collapsedChild)).toBe(false)
    expect(editor.selected.includes(generated)).toBe(false)
  })

  test('selects expanded groups once without separately selecting their contained geometry', () => {
    const first = rect('first')
    const expanded = group('expanded')
    const child = rect('child', expanded)
    const last = rect('last')
    render()
    expect(row(child)).not.toBeNull()

    click(first)
    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, expanded, last]))
    expect(editor.selected.includes(child)).toBe(false)
  })

  test('skips hidden and locked rows including inherited group restrictions', () => {
    const first = rect('first')
    rect('hidden').attr('data-hidden', 'true')
    rect('locked').attr('data-locked', 'true')
    const hiddenGroup = group('hidden-group', { 'data-hidden': 'true' })
    rect('hidden-child', hiddenGroup)
    const lockedGroup = group('locked-group', { 'data-locked': 'true' })
    rect('locked-child', lockedGroup)
    rect('generated-cache').attr('data-gn-derived', 'true')
    const source = group('procedural-source', { 'data-gn-source': 'true' })
    rect('source-child', source)
    const last = rect('last')
    render()

    click(first)
    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, last]))
  })

  test('leaves selection and its anchor intact when Shift-clicking an inherited locked endpoint', () => {
    const first = rect('first')
    const middle = rect('middle')
    const lockedGroup = group('locked-group', { 'data-locked': 'true' })
    const lockedChild = rect('locked-child', lockedGroup)
    const last = rect('last')
    render()
    click(first)

    click(lockedChild, true)

    expect(editor.selected).toEqual([first])
    click(last, true)
    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
  })

  test('crosses collection boundaries without selecting headers or unavailable collections', () => {
    const first = rect('first')
    const hiddenCollection = addCollection('hidden-collection')
    editor.collections.get(hiddenCollection.id()).visible = false
    rect('hidden-collection-child', hiddenCollection)
    const lockedCollection = addCollection('locked-collection')
    editor.collections.get(lockedCollection.id()).locked = true
    rect('locked-collection-child', lockedCollection)
    const destination = addCollection('destination')
    const middle = rect('middle', destination)
    const last = rect('last', destination)
    render()

    click(first)
    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
    expect(editor.activeCollection).toBe(collection)
  })

  test('selects only geometry when a collection was activated before the range anchor', () => {
    const first = rect('first')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(collection)
    click(first)

    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
  })

  test('uses collection headers as a separate range without selecting their contents', () => {
    rect('first-child')
    const middle = addCollection('middle-collection')
    rect('middle-child', middle)
    const last = addCollection('last-collection')
    rect('last-child', last)
    render()

    click(collection)
    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([collection, middle, last]))
  })

  test('keeps the anchor across rerenders and uses the current reordered rows', () => {
    const first = rect('first')
    const moved = rect('moved')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(first)
    moved.front()
    render()

    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
    expect(editor.selected.includes(moved)).toBe(false)
  })

  test('falls back to an ordinary click when the anchor row has been collapsed', () => {
    const parent = group('parent')
    const anchor = rect('anchor', parent)
    const between = rect('between')
    const target = rect('target')
    render()
    click(anchor)
    parent.attr('data-collapsed', 'true')
    render()

    click(target, true)

    expect(new Set(editor.selected)).toEqual(new Set([anchor, target]))
    expect(editor.selected.includes(between)).toBe(false)
    expect(editor.signals.toogledSelect.dispatch).toHaveBeenLastCalledWith(target)
  })

  test.each([
    'clearSelection', 'documentSessionReset', 'editorModeChanged',
    'activeEditorChanged', 'commandCancelled',
  ])('forgets the anchor after %s', (signal) => {
    const first = rect('first')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(first)
    editor.signals[signal].dispatch()

    click(last, true)

    expect(editor.selected.includes(last)).toBe(true)
    expect(editor.selected.includes(middle)).toBe(false)
    expect(editor.signals.toogledSelect.dispatch).toHaveBeenLastCalledWith(last)
  })

  test('does not reuse an Outliner anchor after viewport selection changes', () => {
    const first = rect('first')
    const middle = rect('middle')
    const last = rect('last')
    render()
    click(first)
    editor.selected = [middle]
    editor.signals.updatedSelection.dispatch()

    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([middle, last]))
    expect(editor.selected.includes(first)).toBe(false)
    expect(editor.signals.toogledSelect.dispatch).toHaveBeenLastCalledWith(last)
  })

  test('preserves single-element command selection and emits one clicked-element signal', () => {
    const first = rect('first')
    rect('middle')
    const last = rect('last')
    render()
    click(first)
    editor.selectSingleElement = true
    const commandListener = vi.fn()
    editor.signals.toogledSelect.add(commandListener)

    click(last, true)

    expect(editor.selected).toEqual([last])
    expect(commandListener).toHaveBeenCalledOnce()
    expect(commandListener).toHaveBeenCalledWith(last)
  })

  test.each(['preventSelection', 'isInteracting'])('respects %s without bypassing command listeners', (flag) => {
    const first = rect('first')
    rect('middle')
    const last = rect('last')
    render()
    click(first)
    editor[flag] = true
    const commandListener = vi.fn()
    editor.signals.toogledSelect.add(commandListener)

    click(last, true)

    expect(editor.selected).toEqual([first])
    expect(commandListener).toHaveBeenCalledOnce()
    expect(commandListener).toHaveBeenCalledWith(last)
  })

  test('allows Paper annotation ranges and excludes inactive Model geometry', () => {
    const model = rect('model')
    const annotations = editor.paperDrawing.attr({
      id: 'paper-annotations', 'data-collection': 'true', 'data-nanquim-paper-annotations': 'true',
    })
    editor.paperAnnotations = annotations
    editor.collections.set('paper-annotations', { group: annotations, visible: true, locked: false })
    const first = rect('paper-first', annotations)
    const middle = rect('paper-middle', annotations)
    const last = rect('paper-last', annotations)
    editor.mode = 'paper'
    render()
    click(first)
    click(last, true)
    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))

    click(model, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
    expect(editor.selected.includes(model)).toBe(false)
  })

  test('supports ranges within the active block edit group', () => {
    rect('outside')
    const editGroup = editor.drawing.group().attr({ id: 'editing', 'data-block-edit': 'true' })
    const first = rect('edit-first', editGroup)
    const middle = rect('edit-middle', editGroup)
    const last = rect('edit-last', editGroup)
    editor.editingBlock = { name: 'Example', editGroup }
    render()

    click(first)
    click(last, true)

    expect(new Set(editor.selected)).toEqual(new Set([first, middle, last]))
  })
})
