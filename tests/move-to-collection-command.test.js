// @vitest-environment jsdom

import { Matrix } from '@svgdotjs/svg.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createCollection } from '../src/js/Collection.js'
import { MoveToCollectionCommand } from '../src/js/commands/MoveToCollectionCommand.js'
import { getParentToRootMatrix } from '../src/js/utils/rootSpaceTransform.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function fixture() {
  const result = createDeterministicEditorFixture()
  Object.assign(result.editor.collections.get(result.activeCollection.attr('id')), { visible: true, locked: false })
  result.editor.collectionIndex = 0
  fixtures.push(result)
  return result
}

function destination(editor, name = 'Destination') {
  return createCollection(editor, name, { activate: false, notify: false })
}

function matrix(element, root) {
  return new Matrix(getParentToRootMatrix(element, root)).multiply(element.matrixify())
}

function expectMatrix(actual, expected) {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) expect(actual[key]).toBeCloseTo(expected[key], 8)
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('Move to collection', () => {
  test('keeps ordinary collection creation active and announced, and supports silent inactive creation', () => {
    const { editor, activeCollection } = fixture()
    const updated = vi.fn()
    editor.signals.updatedCollections.add(updated)
    const outliner = vi.fn()
    editor.signals.updatedOutliner.add(outliner)
    destination(editor)
    expect(editor.activeCollection).toBe(activeCollection)
    expect(updated).not.toHaveBeenCalled()
    expect(outliner).not.toHaveBeenCalled()
    const active = createCollection(editor, 'Active')
    expect(editor.activeCollection).toBe(active)
    expect(updated).toHaveBeenCalledOnce()
    expect(outliner).toHaveBeenCalledOnce()
  })

  test('moves into an existing transformed collection with exact Undo/Redo and one history entry', () => {
    const { editor, activeCollection } = fixture()
    activeCollection.attr('transform', 'translate(12 25) rotate(30)')
    const target = destination(editor).attr('transform', 'translate(-30 10) scale(2 3)')
    editor.collections.get(target.attr('id')).style.stroke = '#ff0000'
    const line = activeCollection.line(0, 0, 10, 20).attr('data-metadata', '{"text":"A & B"}')
    editor.selected = [line]
    const before = editor.drawing.node.outerHTML
    const expected = matrix(line, editor.drawing)
    editor.execute(new MoveToCollectionCommand(editor, [line], { collection: target }))
    expect(line.parent().node).toBe(target.node)
    expectMatrix(matrix(line, editor.drawing), expected)
    expect(line.css('stroke')).toBe('rgb(255, 0, 0)')
    expect(editor.selected).toEqual([line])
    expect(editor.activeCollection).toBe(activeCollection)
    expect(editor.history.undos).toHaveLength(1)
    const after = editor.drawing.node.outerHTML
    editor.history.undo()
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.selected).toEqual([line])
    editor.history.redo()
    expect(editor.drawing.node.outerHTML).toBe(after)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('creates and populates a collection atomically without changing the active collection', () => {
    const { editor, activeCollection } = fixture()
    activeCollection.attr('transform', 'rotate(20)')
    const group = activeCollection.group().attr({ 'data-group': 'true', transform: 'translate(15 25)' })
    const line = group.line(0, 0, 10, 0).attr({ id: 'line', 'data-style-overrides': '{"stroke":true}' }).css('stroke', '#123456')
    const other = activeCollection.circle(5).attr('id', 'other')
    editor.selected = [other, line, group]
    const before = editor.drawing.node.outerHTML
    const entries = [...editor.collections]
    const expected = matrix(group, editor.drawing)
    const observed = []
    editor.signals.updatedCollections.add(() => observed.push([...editor.collections.values()].map(data => data.group.children().length)))
    const command = new MoveToCollectionCommand(editor, editor.selected, { name: '  Furniture & fittings  ' })
    expect(editor.drawing.node.outerHTML).toBe(before)
    editor.execute(command)
    const target = command.target
    const id = target.attr('id')
    expect(target.attr('name')).toBe('Furniture & fittings')
    expect(group.parent().node).toBe(target.node)
    expect(line.parent().node).toBe(group.node)
    expect(line.css('stroke')).toBe('rgb(18, 52, 86)')
    expect(other.parent().node).toBe(target.node)
    expectMatrix(matrix(group, editor.drawing), expected)
    expect(editor.selected).toEqual([group, other])
    expect(editor.activeCollection).toBe(activeCollection)
    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    const after = editor.drawing.node.outerHTML
    editor.history.undo()
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect([...editor.collections]).toEqual(entries)
    expect(editor.selected).toEqual([other, line, group])
    expect(target.node.isConnected).toBe(false)
    expect(editor.activeCollection).toBe(activeCollection)
    editor.history.redo()
    expect(editor.drawing.node.outerHTML).toBe(after)
    expect(command.target).toBe(target)
    expect(editor.collections.get(id).group).toBe(target)
    expect(editor.activeCollection).toBe(activeCollection)
    expect(observed).toEqual([[0, 2], [2], [0, 2]])
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('allocates a collection ID that cannot collide with imported SVG elements or definitions', () => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0).attr('id', 'collection-1')
    editor.svg.defs().group().attr('id', 'collection-2')
    editor.execute(new MoveToCollectionCommand(editor, [line], { name: 'New' }))
    expect(line.parent().attr('id')).toBe('collection-3')
    expect(editor.svg.find('[id="collection-1"]')).toHaveLength(1)
    expect(editor.svg.find('[id="collection-2"]')).toHaveLength(1)
  })

  test.each(['', '   ', null, 5, 'a'.repeat(257), 'bad\u0000name'])('rejects invalid new name %j without mutation', name => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const before = editor.drawing.node.outerHTML
    expect(() => editor.execute(new MoveToCollectionCommand(editor, [line], { name }))).toThrow(/name/)
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.collections.size).toBe(1)
    expect(editor.collectionIndex).toBe(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rejects Paper, collection rows, locked, detached, generated, and block internals before creation', () => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const generated = activeCollection.group().attr('data-gn-output', 'true').rect(5, 5)
    const locked = activeCollection.rect(5, 5).attr('data-locked', 'true')
    const detached = activeCollection.circle(5).remove()
    const block = editor.svg.defs().group().attr('data-block-def', 'true').rect(5, 5)
    const before = editor.drawing.node.outerHTML
    for (const elements of [[], [activeCollection], [generated], [locked], [detached], [block]]) {
      expect(() => editor.execute(new MoveToCollectionCommand(editor, elements, { name: 'Rejected' }))).toThrow(/editable/)
    }
    editor.mode = 'paper'
    expect(() => editor.execute(new MoveToCollectionCommand(editor, [line], { name: 'Rejected' }))).toThrow(/Model/)
    editor.mode = 'model'
    editor.editingBlock = { editGroup: activeCollection }
    expect(() => editor.execute(new MoveToCollectionCommand(editor, [line], { name: 'Rejected' }))).toThrow(/editable/)
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.collections.size).toBe(1)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('rejects ordinary groups, locked collections, Paper destinations, ambiguous options, and no-op transfers', () => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const group = activeCollection.group().attr('data-group', 'true')
    const target = destination(editor)
    const paper = editor.paperDrawing.attr('data-collection', 'true')
    editor.collections.set(paper.attr('id'), { group: paper, visible: true, locked: false, style: {} })
    const before = editor.drawing.node.outerHTML
    for (const collection of [group, paper]) {
      expect(() => editor.execute(new MoveToCollectionCommand(editor, [line], { collection }))).toThrow(/Model collection/)
    }
    expect(() => editor.execute(new MoveToCollectionCommand(editor, [line], { collection: target, name: 'New' }))).toThrow(/existing/)
    editor.collections.get(target.attr('id')).locked = true
    expect(() => editor.execute(new MoveToCollectionCommand(editor, [line], { collection: target }))).toThrow(/Locked/)
    expect(() => editor.execute(new MoveToCollectionCommand(editor, [line, group], { collection: activeCollection }))).toThrow(/already/)
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('removes a newly created collection if transform validation fails, preserving the document and ID counter', () => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0).css('transform', 'rotate(10deg)')
    editor.selected = [line]
    const before = editor.drawing.node.outerHTML
    const updates = vi.fn()
    editor.signals.updatedCollections.add(updates)
    const command = new MoveToCollectionCommand(editor, [line], { name: 'Failed' })
    expect(() => editor.execute(command)).toThrow(/CSS transform/)
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.collections.size).toBe(1)
    expect(editor.collectionIndex).toBe(0)
    expect(editor.selected).toEqual([line])
    expect(editor.activeCollection).toBe(activeCollection)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
    expect(updates).not.toHaveBeenCalled()
  })

  test('rolls back a partially moved selection and the new collection when insertion fails', () => {
    const { editor, activeCollection } = fixture()
    const elements = [activeCollection.line(0, 0, 10, 0), activeCollection.circle(5)]
    const before = editor.drawing.node.outerHTML
    const insert = window.Node.prototype.insertBefore
    let moved = 0
    vi.spyOn(window.Node.prototype, 'insertBefore').mockImplementation(function (node, before) {
      if (this.getAttribute?.('name') === 'Failed' && ++moved === 2) throw new Error('insert failed')
      return insert.call(this, node, before)
    })
    expect(() => editor.execute(new MoveToCollectionCommand(editor, elements, { name: 'Failed' }))).toThrow('insert failed')
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect(editor.collections.size).toBe(1)
    expect(editor.collectionIndex).toBe(0)
    expect(editor.history.undos).toHaveLength(0)
  })

  test('keeps a valid active collection if the newly created collection was activated before Undo', () => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const command = new MoveToCollectionCommand(editor, [line], { name: 'New' })
    editor.execute(command)
    editor.activeCollection = command.target
    editor.history.undo()
    expect(editor.activeCollection).toBe(activeCollection)
    editor.history.redo()
    expect(editor.activeCollection).toBe(activeCollection)
  })

  test('restores collection drawing and Map order when another collection is added after the move', () => {
    const { editor, activeCollection } = fixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const command = new MoveToCollectionCommand(editor, [line], { name: 'Moved' })
    editor.execute(command)
    destination(editor, 'Added later')
    const after = editor.drawing.node.outerHTML
    const keys = [...editor.collections.keys()]
    editor.history.undo()
    editor.history.redo()
    expect(editor.drawing.node.outerHTML).toBe(after)
    expect([...editor.collections.keys()]).toEqual(keys)
  })

  test('failed Undo and Redo preserve the current tree, collection registry, history, and notifications', () => {
    const { editor, activeCollection } = fixture()
    const elements = [activeCollection.line(0, 0, 10, 0), activeCollection.circle(5)]
    const command = new MoveToCollectionCommand(editor, elements, { name: 'Moved' })
    editor.execute(command)
    const after = editor.drawing.node.outerHTML
    const keysAfter = [...editor.collections.keys()]
    const changed = vi.fn()
    editor.signals.updatedCollections.add(changed)
    const sourceInsert = activeCollection.node.insertBefore.bind(activeCollection.node)
    vi.spyOn(activeCollection.node, 'insertBefore').mockImplementationOnce(sourceInsert)
      .mockImplementationOnce(() => { throw new Error('undo failed') }).mockImplementation(sourceInsert)
    expect(() => editor.history.undo()).toThrow('undo failed')
    expect(editor.drawing.node.outerHTML).toBe(after)
    expect([...editor.collections.keys()]).toEqual(keysAfter)
    expect(editor.history.undos).toEqual([command])
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(1)
    expect(changed).not.toHaveBeenCalled()
    editor.history.undo()
    const before = editor.drawing.node.outerHTML
    const keysBefore = [...editor.collections.keys()]
    changed.mockClear()
    const targetInsert = command.target.node.insertBefore.bind(command.target.node)
    vi.spyOn(command.target.node, 'insertBefore').mockImplementationOnce(targetInsert)
      .mockImplementationOnce(() => { throw new Error('redo failed') }).mockImplementation(targetInsert)
    expect(() => editor.history.redo()).toThrow('redo failed')
    expect(editor.drawing.node.outerHTML).toBe(before)
    expect([...editor.collections.keys()]).toEqual(keysBefore)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toEqual([command])
    expect(editor.documentState.revision).toBe(2)
    expect(changed).not.toHaveBeenCalled()
    editor.history.redo()
    expect(editor.drawing.node.outerHTML).toBe(after)
    expect([...editor.collections.keys()]).toEqual(keysAfter)
  })
})
