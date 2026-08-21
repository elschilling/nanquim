// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { FilletCommand } from '../src/js/commands/FilletCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function configureFillet(editor, first, second, radius) {
  const command = new FilletCommand(editor)
  command.selectedElements = [
    [first, { x: 8, y: 0 }],
    [second, { x: 0, y: 8 }],
  ]
  command.storeOriginalStates()
  command.radius = radius
  command._mutationPrepared = true
  return command
}

function captureBoundary(editor, parent, arc = null) {
  return {
    arcConnected: arc ? arc.node.isConnected : null,
    arcMarkup: arc ? arc.node.outerHTML : null,
    arcNextSibling: arc ? arc.node.nextSibling : null,
    arcParent: arc ? arc.node.parentNode : null,
    elementIndex: editor.elementIndex,
    fullIndexCalls: editor.fullSpatialIndex.markDirty.mock.calls.length,
    markup: parent.node.innerHTML,
    nodes: [...parent.node.children],
    redoEntries: editor.history.redos.slice(),
    redoStack: editor.history.redos,
    revision: editor.documentState.revision,
    selected: editor.selected,
    selectedElements: editor.selected.slice(),
    spatialIndexCalls: editor.spatialIndex.markDirty.mock.calls.length,
    undoEntries: editor.history.undos.slice(),
    undoStack: editor.history.undos,
  }
}

function expectBoundaryRestored(editor, parent, snapshot, arc = null) {
  expect(parent.node.innerHTML).toBe(snapshot.markup)
  expect([...parent.node.children]).toEqual(snapshot.nodes)
  if (arc) {
    expect(arc.node.outerHTML).toBe(snapshot.arcMarkup)
    expect(arc.node.isConnected).toBe(snapshot.arcConnected)
    expect(arc.node.parentNode).toBe(snapshot.arcParent)
    expect(arc.node.nextSibling).toBe(snapshot.arcNextSibling)
  }
  expect(editor.elementIndex).toBe(snapshot.elementIndex)
  expect(editor.selected).toBe(snapshot.selected)
  expect(editor.selected).toEqual(snapshot.selectedElements)
  expect(editor.history.undos).toBe(snapshot.undoStack)
  expect(editor.history.undos).toEqual(snapshot.undoEntries)
  expect(editor.history.redos).toBe(snapshot.redoStack)
  expect(editor.history.redos).toEqual(snapshot.redoEntries)
  expect(editor.documentState.revision).toBe(snapshot.revision)
  expect(editor.spatialIndex.markDirty.mock.calls.length)
    .toBeGreaterThan(snapshot.spatialIndexCalls)
  expect(editor.fullSpatialIndex.markDirty.mock.calls.length)
    .toBeGreaterThan(snapshot.fullIndexCalls)
}

function failAfterOneAttributeWrite(element, message) {
  const original = element.attr.bind(element)
  const error = new Error(message)
  let shouldFail = true
  const spy = vi.spyOn(element, 'attr').mockImplementation((...args) => {
    const result = original(...args)
    if (shouldFail) {
      shouldFail = false
      throw error
    }
    return result
  })
  return { error, spy }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('FILLET History failure atomicity', () => {
  test('radius zero restores the exact applied/undone boundary after a later line write fails', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.circle(1).center(-5, -5).attr('id', 'before')
    const horizontal = activeCollection.line(2, 0, 10, 0).attr('id', 'horizontal')
    const vertical = activeCollection.line(0, 2, 0, 10).attr('id', 'vertical')
    const sentinel = activeCollection.circle(1).center(12, 12).attr('id', 'sentinel')
    const command = configureFillet(editor, horizontal, vertical, 0)

    editor.execute(command)
    editor.selected = [sentinel]

    const undoFailure = failAfterOneAttributeWrite(vertical, 'synthetic FILLET line Undo failure')
    const applied = captureBoundary(editor, activeCollection)
    expect(() => editor.history.undo()).toThrow(undoFailure.error)
    expectBoundaryRestored(editor, activeCollection, applied)

    undoFailure.spy.mockRestore()
    editor.history.undo()
    const undone = captureBoundary(editor, activeCollection)

    const redoFailure = failAfterOneAttributeWrite(vertical, 'synthetic FILLET line Redo failure')
    expect(() => editor.history.redo()).toThrow(redoFailure.error)
    expectBoundaryRestored(editor, activeCollection, undone)
  })

  test('radius fillet restores arc identity and order after remove and add failures', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.circle(1).center(-5, -5).attr('id', 'before')
    const horizontal = activeCollection.line(0, 0, 10, 0).attr('id', 'horizontal')
    const vertical = activeCollection.line(0, 0, 0, 10).attr('id', 'vertical')
    const command = configureFillet(editor, horizontal, vertical, 2)

    editor.execute(command)
    const arc = command.createdElements[0]
    const sentinel = activeCollection.circle(1).center(12, 12).attr('id', 'sentinel')
    editor.selected = [sentinel]
    expect(arc.node.nextSibling).toBe(sentinel.node)

    const removeArc = arc.remove.bind(arc)
    const undoFailure = new Error('synthetic FILLET arc remove failure')
    let shouldFailRemove = true
    const removeSpy = vi.spyOn(arc, 'remove').mockImplementation((...args) => {
      const result = removeArc(...args)
      if (shouldFailRemove) {
        shouldFailRemove = false
        throw undoFailure
      }
      return result
    })

    const applied = captureBoundary(editor, activeCollection, arc)
    expect(() => editor.history.undo()).toThrow(undoFailure)
    expectBoundaryRestored(editor, activeCollection, applied, arc)

    removeSpy.mockRestore()
    editor.history.undo()
    expect(arc.node.isConnected).toBe(false)
    const undone = captureBoundary(editor, activeCollection, arc)

    const addElement = editor.addElement.bind(editor)
    const redoFailure = new Error('synthetic FILLET arc add failure')
    let shouldFailAdd = true
    vi.spyOn(editor, 'addElement').mockImplementation((...args) => {
      const result = addElement(...args)
      if (shouldFailAdd) {
        shouldFailAdd = false
        throw redoFailure
      }
      return result
    })

    expect(() => editor.history.redo()).toThrow(redoFailure)
    expectBoundaryRestored(editor, activeCollection, undone, arc)

    editor.history.redo()
    expect(command.createdElements[0]).toBe(arc)
    expect(arc.node.parentNode).toBe(activeCollection.node)
    expect(arc.node.nextSibling).toBe(sentinel.node)
  })
})
