// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { CopyCommand } from '../src/js/commands/CopyCommand.js'
import { MirrorCommand } from '../src/js/commands/MirrorCommand.js'
import { MoveCommand } from '../src/js/commands/MoveCommand.js'
import { RotateCommand } from '../src/js/commands/RotateCommand.js'
import { ScaleCommand } from '../src/js/commands/ScaleCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

function childNodes(parent) {
  return [...parent.node.children]
}

function captureFailureBoundary(editor, parent, detachedElements = []) {
  return {
    detachedMarkup: detachedElements.map((element) => element.node.outerHTML),
    elementIndex: editor.elementIndex,
    fullIndexCalls: editor.fullSpatialIndex.markDirty.mock.calls.length,
    markup: parent.node.innerHTML,
    nodes: childNodes(parent),
    revision: editor.documentState.revision,
    selected: editor.selected,
    selectedElements: editor.selected.slice(),
    spatialIndexCalls: editor.spatialIndex.markDirty.mock.calls.length,
    undoEntries: editor.history.undos.slice(),
    undoStack: editor.history.undos,
    redoEntries: editor.history.redos.slice(),
    redoStack: editor.history.redos,
  }
}

function expectFailureBoundary(editor, parent, snapshot, detachedElements = []) {
  expect(parent.node.innerHTML).toBe(snapshot.markup)
  expect(childNodes(parent)).toEqual(snapshot.nodes)
  expect(detachedElements.map((element) => element.node.outerHTML)).toEqual(
    snapshot.detachedMarkup,
  )
  expect(editor.selected).toBe(snapshot.selected)
  expect(editor.selected).toEqual(snapshot.selectedElements)
  expect(editor.elementIndex).toBe(snapshot.elementIndex)
  expect(editor.history.undos).toBe(snapshot.undoStack)
  expect(editor.history.undos).toEqual(snapshot.undoEntries)
  expect(editor.history.redos).toBe(snapshot.redoStack)
  expect(editor.history.redos).toEqual(snapshot.redoEntries)
  expect(editor.documentState.revision).toBe(snapshot.revision)
  expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(snapshot.spatialIndexCalls + 1)
  expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(snapshot.fullIndexCalls + 1)
}

function configureMove(editor, elements) {
  const command = new MoveCommand(editor)
  command.selectedElements = elements.slice()
  command.originalPositions = elements.map((element) => command.getElementPosition(element))
  command.localDeltas = elements.map(() => ({ dx: 5, dy: 3 }))
  command.interactiveExecutionDone = true
  return command
}

function configureRotate(editor, elements) {
  const command = new RotateCommand(editor)
  command.selectedElements = elements.slice()
  command.originalStates = elements.map((element) => command.getElementState(element))
  command.originalCoordinates = elements.map((element) => command.getElementCoordinates(element))
  command.centerPoint = { x: 0, y: 0 }
  command.angle = 90
  command.angleRad = Math.PI / 2
  command.interactiveExecutionDone = true
  return command
}

function configureScale(editor, elements) {
  const command = new ScaleCommand(editor)
  command.selectedElements = elements.slice()
  command.originalPositions = elements.map((element) => command.getElementPosition(element))
  command.basePoint = { x: 0, y: 0 }
  command.scaleFactor = 2
  command.interactiveExecutionDone = true
  return command
}

describe('transform History failure atomicity', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test.each([
    ['MOVE', configureMove, 'plot', 'plot'],
    ['ROTATE', configureRotate, 'plot', 'rotateElementFromOriginal'],
    ['SCALE', configureScale, 'plot', 'scale'],
  ])('%s restores the exact boundary after later-element Undo and Redo failures', (
    _name,
    configure,
    undoMethod,
    redoMethod,
  ) => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().attr({ id: 'transform-parent' })
    parent.line(-3, 0, -2, 0).attr({ id: 'before' })
    const first = parent.line(1, 0, 2, 0).attr({ id: 'first' })
    const second = parent.line(3, 1, 4, 1).attr({ id: 'second' })
    const sentinel = parent.circle(1).center(8, 8).attr({ id: 'selection-sentinel' })
    parent.line(10, 0, 11, 0).attr({ id: 'after' })
    const command = configure(editor, [first, second])

    try {
      editor.execute(command)
      editor.selected = [sentinel]

      const undoTarget = undoMethod === 'plot' && _name !== 'MOVE' ? first : second
      const originalUndoMethod = undoTarget[undoMethod].bind(undoTarget)
      const undoFailure = new Error(`synthetic ${_name} Undo failure`)
      vi.spyOn(undoTarget, undoMethod)
        .mockImplementation(originalUndoMethod)
        .mockImplementationOnce(() => { throw undoFailure })

      const applied = captureFailureBoundary(editor, parent)
      expect(() => editor.history.undo()).toThrow(undoFailure)
      expectFailureBoundary(editor, parent, applied)

      editor.history.undo()
      const undone = captureFailureBoundary(editor, parent)

      const redoFailure = new Error(`synthetic ${_name} Redo failure`)
      if (redoMethod === 'rotateElementFromOriginal') {
        const rotateElement = command.rotateElementFromOriginal.bind(command)
        let shouldFail = true
        vi.spyOn(command, redoMethod).mockImplementation((element, ...args) => {
          if (element === second && shouldFail) {
            shouldFail = false
            throw redoFailure
          }
          return rotateElement(element, ...args)
        })
      } else {
        const originalRedoMethod = second[redoMethod].bind(second)
        vi.spyOn(second, redoMethod)
          .mockImplementation(originalRedoMethod)
          .mockImplementationOnce(() => { throw redoFailure })
      }

      expect(() => editor.history.redo()).toThrow()
      expectFailureBoundary(editor, parent, undone)
    } finally {
      fixture.dispose()
    }
  })

  test.each([
    ['ROTATE', configureRotate],
    ['SCALE', configureScale],
  ])('%s restores rectangle replacement identity when a later Undo/Redo step fails', (
    _name,
    configure,
  ) => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().attr({ id: 'replacement-parent' })
    parent.line(-3, 0, -2, 0).attr({ id: 'before' })
    const line = parent.line(1, 0, 2, 0).attr({ id: 'failure-line' })
    const rectangle = parent.rect(3, 2).move(3, 1).attr({ id: 'replacement-rect' })
    const sentinel = parent.circle(1).center(8, 8).attr({ id: 'selection-sentinel' })
    parent.line(10, 0, 11, 0).attr({ id: 'after' })
    const command = configure(editor, [line, rectangle])

    try {
      editor.execute(command)
      editor.selected = [sentinel]
      const transformed = command.elementReplacements[1].transformed
      expect(transformed.node.parentNode).toBe(parent.node)
      expect(rectangle.node.isConnected).toBe(false)

      const plot = line.plot.bind(line)
      const undoFailure = new Error(`synthetic ${_name} replacement Undo failure`)
      vi.spyOn(line, 'plot')
        .mockImplementation(plot)
        .mockImplementationOnce(() => { throw undoFailure })

      const applied = captureFailureBoundary(editor, parent, [rectangle])
      expect(() => editor.history.undo()).toThrow(undoFailure)
      expectFailureBoundary(editor, parent, applied, [rectangle])
      expect(transformed.node.parentNode).toBe(parent.node)
      expect(rectangle.node.isConnected).toBe(false)

      editor.history.undo()
      expect(rectangle.node.parentNode).toBe(parent.node)
      expect(transformed.node.isConnected).toBe(false)
      const undone = captureFailureBoundary(editor, parent, [transformed])

      const activateReplacement = command.activateReplacement.bind(command)
      const redoFailure = new Error(`synthetic ${_name} replacement Redo failure`)
      vi.spyOn(command, 'activateReplacement')
        .mockImplementation(activateReplacement)
        .mockImplementationOnce((index) => {
          activateReplacement(index)
          throw redoFailure
        })

      expect(() => editor.history.redo()).toThrow(redoFailure)
      expectFailureBoundary(editor, parent, undone, [transformed])
      expect(rectangle.node.parentNode).toBe(parent.node)
      expect(transformed.node.isConnected).toBe(false)
    } finally {
      fixture.dispose()
    }
  })

  test('COPY restores placements and detached attributes after later-element Undo and Redo failures', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().attr({ id: 'copy-parent' })
    parent.line(-3, 0, -2, 0).attr({ id: 'before' })
    const firstSource = parent.line(1, 0, 2, 0).attr({ id: 'copy-first' })
    const secondSource = parent.line(3, 1, 4, 1).attr({ id: 'copy-second' })
    const sentinel = parent.circle(1).center(8, 8).attr({ id: 'selection-sentinel' })
    parent.line(10, 0, 11, 0).attr({ id: 'after' })
    const firstCopy = firstSource.clone().attr('data-nanquim-transient', 'true').remove()
    const secondCopy = secondSource.clone().attr('data-nanquim-transient', 'true').remove()
    const command = new CopyCommand(editor)
    command.originalSelection = [firstSource, secondSource]
    command.allCopiedElements = [firstCopy, secondCopy]
    command.copyEntries = [firstCopy, secondCopy].map((element) => ({ element, parent }))
    command.interactiveExecutionDone = true

    try {
      editor.execute(command)
      editor.selected = [sentinel]

      const removeCopy = secondCopy.remove.bind(secondCopy)
      const undoFailure = new Error('synthetic COPY Undo failure')
      vi.spyOn(secondCopy, 'remove')
        .mockImplementation(removeCopy)
        .mockImplementationOnce(() => { throw undoFailure })

      const applied = captureFailureBoundary(editor, parent)
      expect(() => editor.history.undo()).toThrow(undoFailure)
      expectFailureBoundary(editor, parent, applied)

      editor.history.undo()
      const undone = captureFailureBoundary(editor, parent, [firstCopy, secondCopy])
      const add = parent.add.bind(parent)
      const redoFailure = new Error('synthetic COPY Redo failure')
      let addCount = 0
      vi.spyOn(parent, 'add').mockImplementation((element) => {
        addCount += 1
        if (addCount === 2) throw redoFailure
        return add(element)
      })

      expect(() => editor.history.redo()).toThrow(redoFailure)
      expectFailureBoundary(editor, parent, undone, [firstCopy, secondCopy])
    } finally {
      fixture.dispose()
    }
  })

  test('MIRROR restores source/copy placements and attributes after later-element Undo and Redo failures', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().attr({ id: 'mirror-parent' })
    parent.line(-3, 0, -2, 0).attr({ id: 'before' })
    const firstSource = parent.line(1, 0, 2, 0).attr({ id: 'mirror-first' })
    const secondSource = parent.line(3, 1, 4, 1).attr({ id: 'mirror-second' })
    const sentinel = parent.circle(1).center(8, 8).attr({ id: 'selection-sentinel' })
    parent.line(10, 0, 11, 0).attr({ id: 'after' })
    const firstCopy = firstSource.clone().attr('data-nanquim-transient', 'true').remove()
    const secondCopy = secondSource.clone().attr('data-nanquim-transient', 'true').remove()
    const command = new MirrorCommand(editor)
    command.originalSelection = [firstSource, secondSource]
    command.originalParents = [parent, parent]
    command.originalNextSiblings = [secondSource.node, sentinel.node]
    command.copiedElements = [firstCopy, secondCopy]
    command.copiedParents = [parent, parent]
    command.deletedSource = true
    command.interactiveExecutionDone = true

    try {
      editor.execute(command)
      editor.selected = [sentinel]

      const removeCopy = secondCopy.remove.bind(secondCopy)
      const undoFailure = new Error('synthetic MIRROR Undo failure')
      vi.spyOn(secondCopy, 'remove')
        .mockImplementation(removeCopy)
        .mockImplementationOnce(() => { throw undoFailure })

      const applied = captureFailureBoundary(editor, parent, [firstSource, secondSource])
      expect(() => editor.history.undo()).toThrow(undoFailure)
      expectFailureBoundary(editor, parent, applied, [firstSource, secondSource])

      editor.history.undo()
      const undone = captureFailureBoundary(editor, parent, [firstCopy, secondCopy])
      const removeSource = secondSource.remove.bind(secondSource)
      const redoFailure = new Error('synthetic MIRROR Redo failure')
      vi.spyOn(secondSource, 'remove')
        .mockImplementation(removeSource)
        .mockImplementationOnce(() => { throw redoFailure })

      expect(() => editor.history.redo()).toThrow(redoFailure)
      expectFailureBoundary(editor, parent, undone, [firstCopy, secondCopy])
    } finally {
      fixture.dispose()
    }
  })
})
