// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { Terminal } from '../src/js/Terminal.js'
import { eraseCommand } from '../src/js/commands/EraseCommand.js'
import { MultiRemoveElementCommand } from '../src/js/commands/MultiRemoveElementCommand.js'
import { RemoveElementCommand } from '../src/js/commands/RemoveElementCommand.js'
import {
  createDeterministicEditorFixture,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

const fixtures = []
const listenerTrackers = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function childIds(parent) {
  return Array.from(parent.node.children, (node) => node.getAttribute('id'))
}

function pressDelete() {
  const event = new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    code: 'Delete',
    key: 'Delete',
  })
  document.dispatchEvent(event)
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
  while (listenerTrackers.length > 0) listenerTrackers.pop().dispose()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('transactional Delete and Erase', () => {
  test('collapses nested selections and restores exact identity, order, and selection', () => {
    const { activeCollection, editor } = createFixture()
    const before = activeCollection.rect(1, 1).attr('id', 'before')
    const group = activeCollection.group().attr({ id: 'group', 'data-group': 'true' })
    const child = group.line(0, 0, 2, 0).attr('id', 'child')
    const between = activeCollection.rect(1, 1).attr('id', 'between')
    const other = activeCollection.circle(1).attr('id', 'other')
    const after = activeCollection.rect(1, 1).attr('id', 'after')
    const selectionBefore = [child, group, other, child]
    editor.selected = [...selectionBefore]

    const command = new MultiRemoveElementCommand(editor, editor.selected)
    expect(command.elements).toEqual([group, other])

    editor.execute(command)

    expect(editor.history.undos).toEqual([command])
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.selected).toEqual([])
    expect(childIds(activeCollection)).toEqual(['before', 'between', 'after'])
    expect(group.node.isConnected).toBe(false)
    expect(other.node.isConnected).toBe(false)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()

    editor.history.undo()

    expect(editor.documentState.revision).toBe(2)
    expect(editor.selected).toEqual(selectionBefore)
    expect(childIds(activeCollection)).toEqual(['before', 'group', 'between', 'other', 'after'])
    expect(Array.from(group.node.children)).toEqual([child.node])
    expect(group.parent()).toBe(activeCollection)
    expect(other.parent()).toBe(activeCollection)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)

    editor.history.redo()

    expect(editor.documentState.revision).toBe(3)
    expect(editor.selected).toEqual([])
    expect(childIds(activeCollection)).toEqual(['before', 'between', 'after'])
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(before.parent()).toBe(activeCollection)
    expect(between.parent()).toBe(activeCollection)
    expect(after.parent()).toBe(activeCollection)
  })

  test('rolls back second-node failures during execute, Undo, and Redo', () => {
    const { activeCollection, editor } = createFixture()
    const before = activeCollection.rect(1, 1).attr('id', 'before')
    const first = activeCollection.line(0, 0, 1, 0).attr('id', 'first')
    const middle = activeCollection.rect(1, 1).attr('id', 'middle')
    const second = activeCollection.circle(1).attr('id', 'second')
    const after = activeCollection.rect(1, 1).attr('id', 'after')
    const selectionBefore = [first, second]
    editor.selected = [...selectionBefore]
    const command = new MultiRemoveElementCommand(editor, editor.selected)
    const originalRemove = activeCollection.node.removeChild.bind(activeCollection.node)
    let removeCount = 0
    const executeFailure = vi.spyOn(activeCollection.node, 'removeChild').mockImplementation((node) => {
      removeCount += 1
      if (removeCount === 2) throw new Error('injected second removal failure')
      return originalRemove(node)
    })

    expect(() => editor.execute(command)).toThrow('injected second removal failure')
    executeFailure.mockRestore()
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'middle', 'second', 'after'])
    expect(editor.selected).toEqual(selectionBefore)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()

    editor.execute(command)
    expect(childIds(activeCollection)).toEqual(['before', 'middle', 'after'])
    const originalInsert = activeCollection.node.insertBefore.bind(activeCollection.node)
    let insertCount = 0
    const undoFailure = vi.spyOn(activeCollection.node, 'insertBefore').mockImplementation((node, reference) => {
      insertCount += 1
      const result = originalInsert(node, reference)
      if (insertCount === 2) throw new Error('injected second restoration failure')
      return result
    })

    expect(() => editor.history.undo()).toThrow('injected second restoration failure')
    undoFailure.mockRestore()
    expect(childIds(activeCollection)).toEqual(['before', 'middle', 'after'])
    expect(editor.selected).toEqual([])
    expect(editor.history.undos).toEqual([command])
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'middle', 'second', 'after'])
    expect(editor.selected).toEqual(selectionBefore)
    const redoRemove = activeCollection.node.removeChild.bind(activeCollection.node)
    removeCount = 0
    const redoFailure = vi.spyOn(activeCollection.node, 'removeChild').mockImplementation((node) => {
      removeCount += 1
      if (removeCount === 2) throw new Error('injected second redo failure')
      return redoRemove(node)
    })

    expect(() => editor.history.redo()).toThrow('injected second redo failure')
    redoFailure.mockRestore()
    expect(childIds(activeCollection)).toEqual(['before', 'first', 'middle', 'second', 'after'])
    expect(editor.selected).toEqual(selectionBefore)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toEqual([command])
    expect(editor.documentState.revision).toBe(2)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)

    editor.history.redo()
    expect(childIds(activeCollection)).toEqual(['before', 'middle', 'after'])
    expect(editor.selected).toEqual([])
    expect(editor.documentState.revision).toBe(3)
    expect(before.parent()).toBe(activeCollection)
    expect(middle.parent()).toBe(activeCollection)
    expect(after.parent()).toBe(activeCollection)
  })

  test('single-element compatibility command preserves its node and placement', () => {
    const { activeCollection, editor } = createFixture()
    const before = activeCollection.rect(1, 1).attr('id', 'before')
    const target = activeCollection.circle(1).attr('id', 'target')
    const after = activeCollection.rect(1, 1).attr('id', 'after')
    editor.selected = [target]
    const command = new RemoveElementCommand(editor, target)

    editor.execute(command)
    expect(childIds(activeCollection)).toEqual(['before', 'after'])
    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'target', 'after'])
    expect(activeCollection.node.children[1]).toBe(target.node)
    expect(editor.selected).toEqual([target])
    expect(before.parent()).toBe(activeCollection)
    expect(after.parent()).toBe(activeCollection)
  })

  test('restores selected roots to their exact separate parents', () => {
    const { activeCollection, editor } = createFixture()
    const leftParent = activeCollection.group().attr('id', 'left-parent')
    const rightParent = activeCollection.group().attr('id', 'right-parent')
    const leftBefore = leftParent.rect(1, 1).attr('id', 'left-before')
    const left = leftParent.line(0, 0, 1, 0).attr('id', 'left')
    const leftAfter = leftParent.rect(1, 1).attr('id', 'left-after')
    const rightBefore = rightParent.rect(1, 1).attr('id', 'right-before')
    const right = rightParent.circle(1).attr('id', 'right')
    const rightAfter = rightParent.rect(1, 1).attr('id', 'right-after')
    editor.selected = [right, left]
    const command = new MultiRemoveElementCommand(editor, editor.selected)

    editor.execute(command)
    expect(childIds(leftParent)).toEqual(['left-before', 'left-after'])
    expect(childIds(rightParent)).toEqual(['right-before', 'right-after'])

    editor.history.undo()
    expect(childIds(leftParent)).toEqual(['left-before', 'left', 'left-after'])
    expect(childIds(rightParent)).toEqual(['right-before', 'right', 'right-after'])
    expect(left.parent()).toBe(leftParent)
    expect(right.parent()).toBe(rightParent)
    expect(editor.selected).toEqual([right, left])
    expect(leftParent.node.children).toContain(leftBefore.node)
    expect(leftParent.node.children).toContain(leftAfter.node)
    expect(rightParent.node.children).toContain(rightBefore.node)
    expect(rightParent.node.children).toContain(rightAfter.node)
  })

  test('Erase commits one transaction and reports the canonical root count', () => {
    const { activeCollection, editor } = createFixture()
    const messages = []
    editor.signals.terminalLogged.add((entry) => messages.push(entry.msg))
    const group = activeCollection.group().attr('id', 'group')
    const child = group.line(0, 0, 1, 0).attr('id', 'child')
    editor.selected = [child, group]

    eraseCommand(editor)

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(group.node.isConnected).toBe(false)
    expect(editor.selected).toEqual([])
    expect(messages).toContain('Erased 1 elements.')
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
  })

  test('Delete uses History without clearing selection optimistically', () => {
    const listenerTracker = installDomListenerTracker()
    listenerTrackers.push(listenerTracker)
    const { activeCollection, editor } = createFixture()
    const target = activeCollection.line(0, 0, 1, 0).attr('id', 'target')
    editor.selected = [target]
    const clearListener = vi.fn()
    editor.signals.clearSelection.add(clearListener)
    Terminal(editor)

    const event = pressDelete()

    expect(event.defaultPrevented).toBe(true)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(target.node.isConnected).toBe(false)
    expect(editor.selected).toEqual([])
    expect(clearListener).toHaveBeenCalledOnce()
  })

  test('rejects Paper viewport deletion without changing either document surface', () => {
    const listenerTracker = installDomListenerTracker()
    listenerTrackers.push(listenerTracker)
    const { activeCollection, editor } = createFixture()
    const modelElement = activeCollection.rect(1, 1).attr('id', 'model-element')
    const viewport = { id: 'vp-1' }
    const wrapper = { _paperVp: viewport }
    editor.selected = [wrapper]
    const messages = []
    editor.signals.terminalLogged.add((entry) => messages.push(entry.msg))
    Terminal(editor)

    const event = pressDelete()

    expect(event.defaultPrevented).toBe(true)
    expect(editor.paperEditor.removeViewport).not.toHaveBeenCalled()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.selected).toEqual([wrapper])
    expect(modelElement.node.isConnected).toBe(true)
    expect(messages).toContain(
      'Paper viewports cannot be erased with Delete. Use the Paper Space viewport controls.',
    )
    expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
  })
})
