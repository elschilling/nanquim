// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createDeterministicEditorFixture, installDomListenerTracker } from './support/deterministic-harness.js'

let fixture
let editor
let collection
let listeners

function row(element) {
  return document.getElementById('li' + element.id())
    || [...document.querySelectorAll('[data-outliner-id]')]
      .find(candidate => candidate.dataset.outlinerId === element.id())
    || null
}

function render() {
  editor.signals.updatedOutliner.dispatch()
}

function rect(id, parent = collection) {
  return parent.rect(20, 10).attr('id', id)
}

function addCollection(id) {
  const group = editor.drawing.group().attr({ id, name: id, 'data-collection': 'true' })
  editor.collections.set(id, {
    group,
    visible: true,
    locked: false,
    style: { stroke: '#00ff00', 'stroke-width': 0.5, fill: 'transparent', opacity: 1 },
  })
  return group
}

function click(node) {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function transfer() {
  const values = new Map()
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    types: [],
    setData(type, value) { values.set(type, value); this.types = [...values.keys()] },
    getData(type) { return values.get(type) || '' },
  }
}

function dragEvent(node, type, dataTransfer, fraction = 0.5) {
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    top: 100, left: 0, right: 200, bottom: 140, width: 200, height: 40,
  })
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 100 + 40 * fraction })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  node.dispatchEvent(event)
  return event
}

function startDrag(element) {
  const data = transfer()
  const event = dragEvent(row(element), 'dragstart', data)
  expect(event.defaultPrevented).toBe(false)
  return data
}

function drop(element, data, fraction = 0.5) {
  const targetRow = row(element)
  const hover = dragEvent(targetRow, 'dragover', data, fraction)
  dragEvent(targetRow, 'drop', data, fraction)
  return hover
}

function ids(parent) {
  return [...parent.node.children].map(node => node.id)
}

function key(node, value) {
  node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
}

describe('Outliner tree interactions', () => {
  beforeEach(async () => {
    vi.resetModules()
    document.body.innerHTML = '<div class="outliner-container"><div id="drawing-tree"></div></div>'
    listeners = installDomListenerTracker()
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
    listeners?.dispose()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  test('preserves row selection and collection activation', () => {
    const first = rect('first')
    const second = rect('second')
    const destination = addCollection('destination')
    render()

    click(row(first).querySelector('.collection-name'))
    click(row(second).querySelector('.collection-name'))
    expect(editor.selected).toEqual([first, second])
    expect(row(first).classList.contains('outliner-selected')).toBe(true)
    click(row(first).querySelector('.collection-name'))
    expect(editor.selected).toEqual([second])

    click(row(destination).querySelector('.collection-name'))
    expect(editor.activeCollection).toBe(destination)
    expect(editor.selected).toEqual([destination])
  })

  test('keeps collection and group collapse independent from document ownership', () => {
    const group = collection.group().attr({ id: 'group', 'data-group': 'true' })
    const child = rect('child', group)
    render()

    click(row(group).querySelector('.icon-down'))
    expect(row(child)).toBeNull()
    expect(child.parent()).toBe(group)
    click(row(group).querySelector('.icon-right'))
    expect(row(child)).not.toBeNull()

    click(row(collection).querySelector('.icon-down'))
    expect(row(group)).toBeNull()
    expect(editor.collections.get(collection.id()).collapsed).toBe(true)
    click(row(collection).querySelector('.icon-right'))
    expect(row(child)).not.toBeNull()
    expect(editor.history.undos).toHaveLength(0)
  })

  test('keeps visibility and locking controls separate from selection', () => {
    const child = rect('child')
    render()

    click(row(child).querySelector('.icon-restrict-screen'))
    expect(child.attr('data-hidden')).toBe('true')
    expect(editor.selected).toEqual([])
    click(row(child).querySelector('.collection-name'))
    expect(editor.selected).toEqual([])
    click(row(child).querySelector('.icon-restrict-screen'))
    click(row(child).querySelector('.icon-restrict-edit-mode'))
    expect(child.attr('data-locked')).toBe('true')
    click(row(child).querySelector('.collection-name'))
    expect(editor.selected).toEqual([])
  })

  test('moves an element to another collection only on drop and restores ownership with Undo/Redo', () => {
    const first = rect('first')
    const moving = rect('moving').attr('name', 'Drawing detail')
    const last = rect('last')
    const destination = addCollection('destination')
    const existing = rect('existing', destination)
    editor.selected = [first]
    render()

    const data = startDrag(moving)
    const hover = dragEvent(row(destination), 'dragover', data)
    expect(hover.defaultPrevented).toBe(true)
    expect(row(destination).classList.contains('outliner-drop-inside')).toBe(true)
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()

    drop(destination, data)

    expect(ids(collection)).toEqual([first.id(), last.id()])
    expect(ids(destination)).toEqual([existing.id(), moving.id()])
    expect(moving.attr('name')).toBe('Drawing detail')
    expect(editor.activeCollection).toBe(collection)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.markChanged).toHaveBeenCalledOnce()
    expect(document.querySelector('.outliner-drag-source, .outliner-drop-inside')).toBeNull()
    editor.history.undo()
    expect(ids(collection)).toEqual(['first', 'moving', 'last'])
    expect(ids(destination)).toEqual(['existing'])
    editor.history.redo()
    expect(ids(destination)).toEqual(['existing', 'moving'])
  })

  test.each([0.1, 0.9])('accepts elements across the collection header at height %s', (fraction) => {
    const moving = rect('moving')
    const destination = addCollection('destination')
    render()

    const data = startDrag(moving)
    dragEvent(row(destination), 'dragover', data, fraction)
    expect(data.dropEffect).toBe('move')
    expect(row(destination).classList.contains('outliner-drop-inside')).toBe(true)
    drop(destination, data, fraction)

    expect(moving.parent()).toBe(destination)
    expect(editor.history.undos).toHaveLength(1)
    editor.history.undo()
    expect(moving.parent()).toBe(collection)
    editor.history.redo()
    expect(moving.parent()).toBe(destination)
  })

  test('moves selected contents after activating their collection without dragging the collection', () => {
    const first = rect('first')
    const second = rect('second')
    rect('remaining')
    const destination = addCollection('destination')
    render()
    click(row(collection).querySelector('.collection-name'))
    click(row(first).querySelector('.collection-name'))
    click(row(second).querySelector('.collection-name'))
    expect(editor.selected).toEqual([collection, first, second])

    const data = startDrag(first)
    expect(row(collection).classList.contains('outliner-drag-source')).toBe(false)
    drop(destination, data)

    expect(ids(collection)).toEqual(['remaining'])
    expect(ids(destination)).toEqual(['first', 'second'])
    expect(collection.parent()).toBe(editor.drawing)
    expect(editor.selected).toEqual([first, second])
    editor.history.undo()
    expect(ids(collection)).toEqual(['first', 'second', 'remaining'])
    expect(editor.selected).toEqual([collection, first, second])
    editor.history.redo()
    expect(ids(destination)).toEqual(['first', 'second'])
  })

  test('reorders a selected collection separately from selected geometry', () => {
    const second = addCollection('second')
    const child = rect('child', second)
    render()
    click(row(collection).querySelector('.collection-name'))
    click(row(child).querySelector('.collection-name'))
    expect(editor.selected).toEqual([collection, child])

    drop(second, startDrag(collection), 0.9)

    expect(ids(editor.drawing)).toEqual(['second', collection.id()])
    expect(child.parent()).toBe(second)
    editor.history.undo()
    expect(ids(editor.drawing)).toEqual([collection.id(), 'second'])
  })

  test('places leaf drops above or below the target without changing their parent', () => {
    const first = rect('first')
    const middle = rect('middle')
    const last = rect('last')
    render()

    const above = startDrag(last)
    expect(drop(first, above, 0.1).defaultPrevented).toBe(true)
    expect(ids(collection)).toEqual(['last', 'first', 'middle'])

    const below = startDrag(last)
    expect(drop(middle, below, 0.9).defaultPrevented).toBe(true)
    expect(ids(collection)).toEqual(['first', 'middle', 'last'])
    expect(editor.history.undos).toHaveLength(2)
  })

  test('replaces existing selection highlights when an unselected row moves and restores them on Undo', () => {
    const previouslySelected = rect('previously-selected')
    const moving = rect('moving')
    const destination = addCollection('destination')
    render()
    click(row(previouslySelected).querySelector('.collection-name'))
    expect(previouslySelected.hasClass('elementSelected')).toBe(true)
    expect(row(previouslySelected).classList.contains('outliner-selected')).toBe(true)
    expect(moving.hasClass('elementSelected')).toBe(false)

    drop(destination, startDrag(moving))

    expect(editor.selected).toEqual([moving])
    expect(previouslySelected.hasClass('elementSelected')).toBe(false)
    expect(row(previouslySelected).classList.contains('outliner-selected')).toBe(false)
    expect(moving.hasClass('elementSelected')).toBe(true)
    expect(row(moving).classList.contains('outliner-selected')).toBe(true)

    editor.history.undo()
    expect(editor.selected).toEqual([previouslySelected])
    expect(previouslySelected.hasClass('elementSelected')).toBe(true)
    expect(row(previouslySelected).classList.contains('outliner-selected')).toBe(true)
    expect(moving.hasClass('elementSelected')).toBe(false)
    expect(row(moving).classList.contains('outliner-selected')).toBe(false)

    editor.history.redo()
    expect(editor.selected).toEqual([moving])
    expect(previouslySelected.hasClass('elementSelected')).toBe(false)
    expect(moving.hasClass('elementSelected')).toBe(true)
  })

  test('moves a selected set once in document order and leaves unrelated elements behind', () => {
    const first = rect('first')
    rect('middle')
    const last = rect('last')
    const destination = addCollection('destination')
    editor.selected = [last, first]
    render()

    const data = startDrag(last)
    drop(destination, data)

    expect(ids(collection)).toEqual(['middle'])
    expect(ids(destination)).toEqual(['first', 'last'])
    expect(editor.history.undos).toHaveLength(1)
    editor.history.undo()
    expect(ids(collection)).toEqual(['first', 'middle', 'last'])
    expect(ids(destination)).toEqual([])
  })

  test('drops inside collapsed groups and can move their child back beside the group', () => {
    const moving = rect('moving')
    const group = collection.group().attr({ id: 'group', 'data-group': 'true', 'data-collapsed': 'true' })
    rect('existing', group)
    render()

    drop(group, startDrag(moving))

    expect(ids(group)).toEqual(['existing', 'moving'])
    expect(moving.parent()).toBe(group)
    // Open the group if a valid inside drop kept the user's collapsed state.
    if (!row(moving)) click(row(group).querySelector('.icon-right'))
    drop(group, startDrag(moving), 0.1)
    expect(ids(collection)).toEqual(['moving', 'group'])
    expect(ids(group)).toEqual(['existing'])
  })

  test('reorders whole collections as root siblings instead of nesting them', () => {
    rect('first-child')
    const second = addCollection('second')
    rect('second-child', second)
    const third = addCollection('third')
    render()

    drop(collection, startDrag(third), 0.1)

    expect(ids(editor.drawing)).toEqual(['third', collection.id(), 'second'])
    expect(third.parent()).toBe(editor.drawing)
    expect(ids(collection)).toEqual(['first-child'])
    expect(ids(second)).toEqual(['second-child'])
    editor.history.undo()
    expect(ids(editor.drawing)).toEqual([collection.id(), 'second', 'third'])
  })

  test('rejects dropping a group inside its own descendant without dirtying the drawing', () => {
    const group = collection.group().attr({ id: 'group', 'data-group': 'true' })
    const nested = group.group().attr({ id: 'nested', 'data-group': 'true' })
    rect('child', nested)
    render()

    const data = startDrag(group)
    drop(nested, data)

    expect(data.dropEffect).toBe('none')
    expect(group.parent()).toBe(collection)
    expect(nested.parent()).toBe(group)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('protects locked content and refuses destination ownership that became locked during the drag', () => {
    const moving = rect('moving')
    const locked = rect('locked').attr('data-locked', 'true')
    const destination = addCollection('destination')
    render()
    expect(row(locked).draggable).toBe(false)

    const data = startDrag(moving)
    editor.collections.get(destination.id()).locked = true
    destination.attr('data-locked', 'true')
    drop(destination, data)

    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('ignores external or forged drag data without a local drag session', () => {
    const moving = rect('moving')
    const destination = addCollection('destination')
    render()
    const data = transfer()
    data.setData('text/plain', moving.id())

    expect(drop(destination, data).defaultPrevented).toBe(false)
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
  })

  test.each(['Escape', 'dragend', 'mode change', 'document reset'])('cancels an active drag on %s', (reason) => {
    const moving = rect('moving')
    const destination = addCollection('destination')
    render()
    const sourceRow = row(moving)
    const data = startDrag(moving)
    dragEvent(row(destination), 'dragover', data)
    expect(document.querySelector('.outliner-drop-inside')).not.toBeNull()

    if (reason === 'Escape') key(sourceRow, 'Escape')
    else if (reason === 'dragend') dragEvent(sourceRow, 'dragend', data)
    else if (reason === 'mode change') editor.signals.editorModeChanged.dispatch('paper')
    else editor.signals.documentSessionReset.dispatch()
    drop(destination, data)

    expect(moving.parent()).toBe(collection)
    expect(document.querySelector('.outliner-drag-source, .outliner-drop-inside')).toBeNull()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('allows keyboard pickup, target navigation, and drop with focus restored to the moved row', () => {
    const moving = rect('moving')
    const group = collection.group().attr({ id: 'group', 'data-group': 'true' })
    render()
    const handle = row(moving).querySelector('.outliner-move-handle')
    expect(handle?.tagName).toBe('BUTTON')
    expect(handle.getAttribute('aria-label')).toBeTruthy()
    handle.focus()

    key(handle, 'Enter')
    key(handle, 'ArrowDown')
    const targetHandle = row(group).querySelector('.outliner-move-handle')
    expect(document.activeElement).toBe(targetHandle)
    key(targetHandle, 'ArrowRight')
    key(targetHandle, 'Enter')

    expect(moving.parent()).toBe(group)
    expect(editor.history.undos).toHaveLength(1)
    expect(document.activeElement).toBe(row(moving).querySelector('.outliner-move-handle'))
  })

  test('releases keyboard input when focus leaves the tree during a move', () => {
    const moving = rect('moving')
    render()
    const handle = row(moving).querySelector('.outliner-move-handle')
    handle.focus()
    key(handle, 'Enter')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const confirm = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(confirm)

    expect(document.querySelector('.outliner-drag-source')).toBeNull()
    expect(confirm.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('offers an inside drop when navigating to another collection by keyboard', () => {
    const moving = rect('moving')
    const destination = addCollection('destination')
    render()
    click(row(collection).querySelector('.collection-name'))
    click(row(moving).querySelector('.collection-name'))
    const handle = row(moving).querySelector('.outliner-move-handle')
    handle.focus()

    key(handle, 'Enter')
    key(handle, 'ArrowDown')
    const targetHandle = row(destination).querySelector('.outliner-move-handle')
    expect(document.activeElement).toBe(targetHandle)
    expect(row(destination).classList.contains('outliner-drop-inside')).toBe(true)
    key(targetHandle, 'Enter')

    expect(moving.parent()).toBe(destination)
    expect(collection.parent()).toBe(editor.drawing)
    expect(document.activeElement).toBe(row(moving).querySelector('.outliner-move-handle'))
    expect(editor.history.undos).toHaveLength(1)
  })

  test('cancels a keyboard move without changing selection and returns focus to its source', () => {
    const moving = rect('moving')
    const destination = addCollection('destination')
    render()
    const source = row(moving).querySelector('.outliner-move-handle')
    source.focus()
    key(source, 'Enter')
    key(source, 'ArrowDown')
    const target = row(destination).querySelector('.outliner-move-handle')
    expect(document.activeElement).toBe(target)

    key(target, 'Escape')
    drop(destination, transfer())

    expect(document.activeElement).toBe(source)
    expect(editor.selected).toEqual([])
    expect(moving.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('keeps generated internals and block edit content out of draggable rows', () => {
    const procedural = collection.group().attr({
      id: 'procedural', 'data-group': 'true', 'data-geometry-nodes': 'true',
    })
    const generated = rect('generated', procedural).attr('data-gn-derived', 'true')
    const ordinary = rect('ordinary')
    render()
    expect(row(procedural).draggable).toBe(true)
    expect(row(generated)).toBeNull()
    const data = startDrag(ordinary)
    // The protected wrapper has no inside target; its center chooses a sibling position.
    dragEvent(row(procedural), 'dragover', data)
    expect(row(procedural).classList.contains('outliner-drop-inside')).toBe(false)
    dragEvent(row(ordinary), 'dragend', data)

    const editGroup = editor.drawing.group().attr({ id: 'editing', 'data-block-edit': 'true' })
    const editChild = rect('edit-child', editGroup)
    editor.editingBlock = { name: 'Example', editGroup }
    render()
    expect(row(editChild).draggable).toBe(false)
    expect(row(editChild).querySelector('.outliner-move-handle')).toBeNull()
  })

  test('reorganizes active Paper annotations while keeping Model rows unavailable as drag sources', () => {
    const model = rect('model')
    const annotations = editor.paperDrawing.attr({
      id: 'paper-annotations',
      'data-collection': 'true',
      'data-nanquim-paper-annotations': 'true',
    })
    editor.paperAnnotations = annotations
    editor.collections.set('paper-annotations', {
      group: annotations, visible: true, locked: false,
    })
    const first = rect('paper-first', annotations)
    const second = rect('paper-second', annotations)
    editor.mode = 'paper'
    render()
    expect(row(model).draggable).toBe(false)
    expect(row(first).draggable).toBe(true)

    const data = startDrag(second)
    drop(first, data, 0.1)

    expect(editor.signals.terminalLogged.dispatch.mock.calls).toEqual([])
    expect(ids(annotations)).toEqual(['paper-second', 'paper-first'])
    expect(model.parent()).toBe(collection)
    expect(editor.history.undos).toHaveLength(1)
    editor.history.undo()
    expect(ids(annotations)).toEqual(['paper-first', 'paper-second'])
  })
})
