// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { copyCommand } from '../src/js/commands/CopyCommand.js'
import { AddElementCommand } from '../src/js/commands/AddElementCommand.js'
import { mirrorCommand, MirrorCommand } from '../src/js/commands/MirrorCommand.js'
import { moveCommand } from '../src/js/commands/MoveCommand.js'
import { offsetCommand } from '../src/js/commands/OffsetCommand.js'
import { rotateCommand, RotateCommand } from '../src/js/commands/RotateCommand.js'
import { scaleCommand } from '../src/js/commands/ScaleCommand.js'
import {
  createDeterministicEditorFixture,
  expectNoInteractionLeaks,
  installDomListenerTracker,
  snapshotInteractionState,
} from './support/deterministic-harness.js'

function keydown(key, code = key) {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    key,
  }))
}

function points(element) {
  return element.array().map(([x, y]) => [Number(x), Number(y)])
}

function expectPointsClose(actual, expected) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach(([x, y], index) => {
    expect(x).toBeCloseTo(expected[index][0], 8)
    expect(y).toBeCloseTo(expected[index][1], 8)
  })
}

function matrixValues(element) {
  const { a, b, c, d, e, f } = element.matrix()
  return { a, b, c, d, e, f }
}

function seedRedo(editor) {
  editor.history.redos.push({ execute: vi.fn(), undo: vi.fn() })
}

function childIds(parent) {
  return parent.children().map((element) => element.attr('id'))
}

function expectIndexInvalidations(editor, count) {
  expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(count)
  expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(count)
}

describe('transactional modification commands', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('MOVE applies once through History and preserves transformed metadata on Undo/Redo', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().translate(20, 10)
    const line = parent.line(1, 2, 5, 2).attr({ id: 'move-line', name: 'Move line' })
    const arcData = {
      p1: { x: 1, y: 2 },
      p2: { x: 3, y: 4 },
      p3: { x: 5, y: 2 },
    }
    line.data('arcData', arcData)
    editor.selected = [line]
    seedRedo(editor)

    try {
      moveCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.pointCaptured.dispatch({ x: 3, y: 4 })

      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(1)
      expectPointsClose(points(line), [[4, 6], [8, 6]])
      expect(line.data('arcData')).toEqual({
        p1: { x: 4, y: 6 },
        p2: { x: 6, y: 8 },
        p3: { x: 8, y: 6 },
      })
      expectIndexInvalidations(editor, 1)

      editor.history.undo()
      expectPointsClose(points(line), [[1, 2], [5, 2]])
      expect(line.data('arcData')).toEqual(arcData)
      expectIndexInvalidations(editor, 2)

      editor.history.redo()
      expectPointsClose(points(line), [[4, 6], [8, 6]])
      expect(line.attr('name')).toBe('Move line')
      expectIndexInvalidations(editor, 3)
    } finally {
      fixture.dispose()
    }
  })

  test('ROTATE commits line and rectangle geometry once and restores semantic state', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const line = editor.activeCollection.line(1, 0, 3, 0)
      .attr({ id: 'rotate-line', name: 'Axis' })
    line.data('arcData', {
      p1: { x: 1, y: 0 },
      p2: { x: 2, y: 0 },
      p3: { x: 3, y: 0 },
    })
    const rectangle = editor.activeCollection.rect(4, 2).move(1, 1)
      .attr({ id: 'rotate-rect', name: 'Rotated room', 'data-zone': 'A' })
    editor.activeCollection.line(10, 0, 12, 0).attr({ id: 'rotate-after' })
    const originalRectangleMarkup = rectangle.node.outerHTML
    const originalOrder = childIds(editor.activeCollection)
    editor.selected = [line, rectangle]
    seedRedo(editor)

    try {
      rotateCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.distance = 90
      editor.signals.inputValue.dispatch('90')
      vi.runOnlyPendingTimers()

      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(1)
      expectPointsClose(points(line), [[0, 1], [0, 3]])
      expect(line.data('arcData').p2.x).toBeCloseTo(0, 8)
      expect(line.data('arcData').p2.y).toBeCloseTo(2, 8)
      const polygon = editor.activeCollection.findOne('[id="rotate-rect"]')
      expect(polygon.type).toBe('polygon')
      expect(polygon.attr()).toMatchObject({ name: 'Rotated room', 'data-zone': 'A' })
      const transformedRectangleNode = polygon.node
      const transformedRectangleMarkup = polygon.node.outerHTML
      expect(childIds(editor.activeCollection)).toEqual(originalOrder)
      expectIndexInvalidations(editor, 1)

      editor.history.undo()
      const restoredRectangle = editor.activeCollection.findOne('[id="rotate-rect"]')
      expect(restoredRectangle.type).toBe('rect')
      expect(restoredRectangle.node).toBe(rectangle.node)
      expect(restoredRectangle.node.outerHTML).toBe(originalRectangleMarkup)
      expect(restoredRectangle.attr()).toMatchObject({ name: 'Rotated room', 'data-zone': 'A' })
      expect(childIds(editor.activeCollection)).toEqual(originalOrder)
      expectPointsClose(points(line), [[1, 0], [3, 0]])
      expect(line.data('arcData')).toEqual({
        p1: { x: 1, y: 0 },
        p2: { x: 2, y: 0 },
        p3: { x: 3, y: 0 },
      })
      expectIndexInvalidations(editor, 2)

      editor.history.redo()
      const redonePolygon = editor.activeCollection.findOne('[id="rotate-rect"]')
      expect(redonePolygon.type).toBe('polygon')
      expect(redonePolygon.node).toBe(transformedRectangleNode)
      expect(redonePolygon.node.outerHTML).toBe(transformedRectangleMarkup)
      expect(childIds(editor.activeCollection)).toEqual(originalOrder)
      expectPointsClose(points(line), [[0, 1], [0, 3]])
      expectIndexInvalidations(editor, 3)
    } finally {
      fixture.dispose()
    }
  })

  test('ROTATE rolls back a mid-apply failure with selection, order, redo, and revision intact', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().attr({ id: 'rotate-failure-parent' })
    parent.line(-2, 0, -1, 0).attr({ id: 'before' })
    const first = parent.line(1, 0, 2, 0).attr({ id: 'first' })
    const second = parent.line(3, 0, 4, 0).attr({ id: 'second' })
    parent.line(5, 0, 6, 0).attr({ id: 'after' })
    const originalOrder = childIds(parent)
    const originalSelection = [first, second]
    editor.selected = originalSelection.slice()
    seedRedo(editor)
    const initialElementIndex = editor.elementIndex
    const command = new RotateCommand(editor)
    const rotateElement = command.rotateElementFromOriginal.bind(command)
    const failure = new Error('synthetic rotate failure')

    try {
      command.execute()
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      vi.spyOn(command, 'rotateElementFromOriginal').mockImplementation((element, ...args) => {
        if (element === second) throw failure
        return rotateElement(element, ...args)
      })
      editor.distance = 90
      expect(() => editor.signals.inputValue.dispatch('90')).toThrow('Unable to rotate element 2.')
      vi.runOnlyPendingTimers()

      expectPointsClose(points(first), [[1, 0], [2, 0]])
      expectPointsClose(points(second), [[3, 0], [4, 0]])
      expect(childIds(parent)).toEqual(originalOrder)
      expect(editor.selected).toEqual(originalSelection)
      expect(editor.elementIndex).toBe(initialElementIndex)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.history.redos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(0)
      expect(editor.isInteracting).toBe(false)
      expect(editor.suppressHandlers).toBe(false)
      expectIndexInvalidations(editor, 1)
    } finally {
      fixture.dispose()
    }
  })

  test('SCALE keeps groups reversible and round-trips rectangle replacement', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const group = editor.activeCollection.group()
      .attr({ id: 'scale-group', name: 'Assembly' })
      .translate(4, 6)
    const child = group.line(0, 0, 2, 0).attr({ id: 'scale-child', name: 'Member' })
    const rectangle = editor.activeCollection.rect(4, 2).move(1, 1)
      .attr({ id: 'scale-rect', name: 'Panel', 'data-part': 'panel-a' })
    editor.activeCollection.line(10, 0, 12, 0).attr({ id: 'scale-after' })
    const originalGroupMatrix = matrixValues(group)
    const originalChildPoints = points(child)
    const originalRectangleMarkup = rectangle.node.outerHTML
    const originalOrder = childIds(editor.activeCollection)
    editor.selected = [group, rectangle]
    seedRedo(editor)

    try {
      scaleCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.inputValue.dispatch('2')
      vi.runOnlyPendingTimers()

      const scaledGroupMatrix = matrixValues(group)
      expect(scaledGroupMatrix).not.toEqual(originalGroupMatrix)
      expect(points(child)).toEqual(originalChildPoints)
      const scaledPolygon = editor.activeCollection.findOne('[id="scale-rect"]')
      expect(scaledPolygon.type).toBe('polygon')
      expect(scaledPolygon.attr()).toMatchObject({
        name: 'Panel',
        'data-part': 'panel-a',
      })
      const scaledPolygonNode = scaledPolygon.node
      const scaledPolygonMarkup = scaledPolygon.node.outerHTML
      expect(childIds(editor.activeCollection)).toEqual(originalOrder)
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expectIndexInvalidations(editor, 1)

      editor.history.undo()
      expect(matrixValues(group)).toEqual(originalGroupMatrix)
      expect(points(child)).toEqual(originalChildPoints)
      const restoredRectangle = editor.activeCollection.findOne('[id="scale-rect"]')
      expect(restoredRectangle.type).toBe('rect')
      expect(restoredRectangle.node).toBe(rectangle.node)
      expect(restoredRectangle.node.outerHTML).toBe(originalRectangleMarkup)
      expect(childIds(editor.activeCollection)).toEqual(originalOrder)
      expectIndexInvalidations(editor, 2)

      editor.history.redo()
      expect(matrixValues(group)).toEqual(scaledGroupMatrix)
      expect(points(child)).toEqual(originalChildPoints)
      const redonePolygon = editor.activeCollection.findOne('[id="scale-rect"]')
      expect(redonePolygon.type).toBe('polygon')
      expect(redonePolygon.node).toBe(scaledPolygonNode)
      expect(redonePolygon.node.outerHTML).toBe(scaledPolygonMarkup)
      expect(childIds(editor.activeCollection)).toEqual(originalOrder)
      expectIndexInvalidations(editor, 3)
    } finally {
      fixture.dispose()
    }
  })

  test('SCALE rolls back a partial multi-element failure without recording or clearing redo', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const first = editor.activeCollection.line(0, 0, 2, 0).attr({ id: 'scale-first' })
    const second = editor.activeCollection.line(0, 2, 2, 2).attr({ id: 'scale-second' })
    const failure = new Error('synthetic scale failure')
    vi.spyOn(second, 'scale').mockImplementation(() => { throw failure })
    editor.selected = [first, second]
    seedRedo(editor)

    try {
      scaleCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      expect(() => editor.signals.inputValue.dispatch('2')).toThrow(failure)
      vi.runOnlyPendingTimers()

      expectPointsClose(points(first), [[0, 0], [2, 0]])
      expectPointsClose(points(second), [[0, 2], [2, 2]])
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.history.redos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(0)
      expect(editor.isInteracting).toBe(false)
      expect(editor.suppressHandlers).toBe(false)
      expectIndexInvalidations(editor, 1)
    } finally {
      fixture.dispose()
    }
  })

  test('COPY commits a transient group clone with remapped IDs as one history entry', async () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const group = editor.activeCollection.group().attr({ id: 'copy-group', name: 'Fixture' })
    group.line(0, 0, 4, 0).attr({ id: 'copy-child', name: 'Rail' })
    editor.selected = [group]
    seedRedo(editor)

    try {
      copyCommand(editor)
      keydown('Enter', 'Enter')
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.pointCaptured.dispatch({ x: 10, y: 5 })
      await Promise.resolve()
      keydown('Enter', 'Enter')
      vi.runOnlyPendingTimers()

      const command = editor.history.undos[0]
      const clone = command.allCopiedElements[0]
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(clone.node.parentNode).toBe(editor.activeCollection.node)
      expect(clone.attr('data-nanquim-transient')).toBeUndefined()
      expect(clone.attr('id')).not.toBe(group.attr('id'))
      expect(clone.findOne('line').attr('id')).not.toBe('copy-child')
      expect(clone.attr('name')).toBe('Fixture')
      expect(editor.activeCollection.node.querySelectorAll('[data-nanquim-transient="true"]')).toHaveLength(0)
      expectIndexInvalidations(editor, 1)

      editor.history.undo()
      expect(clone.node.isConnected).toBe(false)
      expect(group.node.parentNode).toBe(editor.activeCollection.node)
      expectIndexInvalidations(editor, 2)

      editor.history.redo()
      expect(clone.node.parentNode).toBe(editor.activeCollection.node)
      expect(clone.findOne('line').attr('name')).toBe('Rail')
      expectIndexInvalidations(editor, 3)
    } finally {
      fixture.dispose()
    }
  })

  test('MIRROR atomically swaps source and reflected copy with stable parents', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const sourceParent = editor.activeCollection.group().attr({ id: 'mirror-parent' })
    const source = sourceParent.line(1, 1, 3, 1)
      .attr({ id: 'mirror-source', name: 'Mirrored rail' })
    editor.selected = [source]
    seedRedo(editor)

    try {
      mirrorCommand(editor)
      keydown('Enter', 'Enter')
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.pointCaptured.dispatch({ x: 0, y: 5 })
      editor.signals.inputValue.dispatch('y')
      vi.runOnlyPendingTimers()

      const command = editor.history.undos[0]
      const mirrored = command.copiedElements[0]
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(source.node.isConnected).toBe(false)
      expect(mirrored.node.parentNode).toBe(sourceParent.node)
      expect(mirrored.attr('data-nanquim-transient')).toBeUndefined()
      expect(mirrored.attr('id')).not.toBe('mirror-source')
      expect(mirrored.attr('name')).toBe('Mirrored rail')
      expectPointsClose(points(mirrored), [[-1, 1], [-3, 1]])
      expectIndexInvalidations(editor, 1)

      editor.history.undo()
      expect(source.node.parentNode).toBe(sourceParent.node)
      expect(mirrored.node.isConnected).toBe(false)
      expectPointsClose(points(source), [[1, 1], [3, 1]])
      expectIndexInvalidations(editor, 2)

      editor.history.redo()
      expect(source.node.isConnected).toBe(false)
      expect(mirrored.node.parentNode).toBe(sourceParent.node)
      expectPointsClose(points(mirrored), [[-1, 1], [-3, 1]])
      expectIndexInvalidations(editor, 3)
    } finally {
      fixture.dispose()
    }
  })

  test('MIRROR rolls back a failed source swap including IDs, order, selection, and redo', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const parent = editor.activeCollection.group().attr({ id: 'mirror-failure-parent' })
    parent.line(-2, 0, -1, 0).attr({ id: 'before' })
    const first = parent.line(1, 1, 2, 1).attr({ id: 'mirror-first' })
    const second = parent.line(3, 1, 4, 1).attr({ id: 'mirror-second' })
    parent.line(5, 0, 6, 0).attr({ id: 'after' })
    const originalOrder = childIds(parent)
    const originalSelection = [first, second]
    editor.selected = originalSelection.slice()
    seedRedo(editor)
    const initialElementIndex = editor.elementIndex
    const command = new MirrorCommand(editor)
    const failure = new Error('synthetic source removal failure')

    try {
      command.execute()
      keydown('Enter', 'Enter')
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.pointCaptured.dispatch({ x: 0, y: 5 })
      vi.spyOn(second, 'remove').mockImplementationOnce(() => { throw failure })
      expect(() => editor.signals.inputValue.dispatch('y')).toThrow(failure)
      vi.runOnlyPendingTimers()

      expect(first.node.parentNode).toBe(parent.node)
      expect(second.node.parentNode).toBe(parent.node)
      expectPointsClose(points(first), [[1, 1], [2, 1]])
      expectPointsClose(points(second), [[3, 1], [4, 1]])
      expect(childIds(parent)).toEqual(originalOrder)
      expect(editor.selected).toEqual(originalSelection)
      expect(editor.elementIndex).toBe(initialElementIndex)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.history.redos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(0)
      expect(editor.isInteracting).toBe(false)
      expect(editor.suppressHandlers).toBe(false)
      command.copiedElements.forEach((element) => {
        expect(element.node.isConnected).toBe(false)
        expect(element.attr('data-nanquim-transient')).toBe('true')
      })
    } finally {
      fixture.dispose()
    }
  })

  test('OFFSET hands a detached clone to History and round-trips its intended parent', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const sourceParent = editor.activeCollection.group().attr({ id: 'offset-parent' })
    const source = sourceParent.line(0, 0, 10, 0)
      .attr({ id: 'offset-source', name: 'Offset rail' })
    const execute = editor.execute
    editor.execute = vi.fn((command) => {
      expect(command.element.node.isConnected).toBe(false)
      return execute(command)
    })
    seedRedo(editor)

    try {
      offsetCommand(editor)
      editor.signals.inputValue.dispatch('2')
      editor.signals.toogledSelect.dispatch(source)
      editor.signals.pointCaptured.dispatch({ x: 5, y: 5 })

      const command = editor.history.undos[0]
      const offset = command.element
      const offsetId = offset.attr('id')
      expect(editor.execute).toHaveBeenCalledOnce()
      expect(editor.history.undos).toHaveLength(1)
      expect(editor.history.redos).toHaveLength(0)
      expect(offset.node.parentNode).toBe(sourceParent.node)
      expect(offset.attr('data-nanquim-transient')).toBeUndefined()
      expect(offsetId).toBe(1)
      expect(offset.attr('name')).toBe('Offset rail')
      expectPointsClose(points(offset), [[0, 2], [10, 2]])
      expectIndexInvalidations(editor, 1)

      editor.history.undo()
      expect(offset.node.isConnected).toBe(false)
      expectIndexInvalidations(editor, 2)

      editor.history.redo()
      expect(offset.node.parentNode).toBe(sourceParent.node)
      expect(offset.attr('id')).toBe(offsetId)
      expectPointsClose(points(offset), [[0, 2], [10, 2]])
      expectIndexInvalidations(editor, 3)
    } finally {
      fixture.dispose()
    }
  })

  test('AddElementCommand assigns one stable ID across preattached Undo/Redo', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const rectangle = editor.activeCollection.rect(4, 2).attr({ name: 'New panel' })
    const initialElementIndex = editor.elementIndex
    const command = new AddElementCommand(editor, rectangle)

    try {
      editor.execute(command)
      const assignedId = rectangle.attr('id')
      expect(assignedId).toBe(initialElementIndex)
      expect(editor.elementIndex).toBe(initialElementIndex + 1)
      expect(editor.history.undos).toEqual([command])

      editor.history.undo()
      expect(rectangle.node.isConnected).toBe(false)
      expect(rectangle.attr('id')).toBe(assignedId)
      expect(editor.elementIndex).toBe(initialElementIndex + 1)

      editor.history.redo()
      expect(rectangle.node.parentNode).toBe(editor.activeCollection.node)
      expect(rectangle.attr('id')).toBe(assignedId)
      expect(editor.elementIndex).toBe(initialElementIndex + 1)
    } finally {
      fixture.dispose()
    }
  })

  test('AddElementCommand restores a detached first apply after ID allocation fails', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor } = fixture
    const rectangle = editor.activeCollection.rect(4, 2).attr({ name: 'Failed panel' })
    const parent = editor.activeCollection
    rectangle.remove()
    const initialElementIndex = editor.elementIndex
    const failure = new Error('synthetic add failure')
    const addElement = editor.addElement
    editor.addElement = vi.fn((...args) => {
      addElement(...args)
      throw failure
    })
    seedRedo(editor)
    const command = new AddElementCommand(editor, rectangle, parent)

    try {
      expect(() => editor.execute(command)).toThrow(failure)
      expect(rectangle.node.isConnected).toBe(false)
      expect(rectangle.attr('id')).toBeUndefined()
      expect(rectangle.attr('data-nanquim-transient')).toBe('true')
      expect(editor.elementIndex).toBe(initialElementIndex)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.history.redos).toHaveLength(1)
      expect(editor.documentState.revision).toBe(0)
    } finally {
      fixture.dispose()
    }
  })

  test('OFFSET cancellation after ghosting leaves no mutation or interaction residue', () => {
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    const source = editor.activeCollection.line(0, 0, 10, 0)
      .attr({ id: 'offset-cancel-source' })
      .addClass('elementHover')
      .addClass('elementSelected')

    try {
      offsetCommand(editor)
      editor.signals.inputValue.dispatch('2')
      editor.signals.toogledSelect.dispatch(source)
      editor.signals.commandCancelled.dispatch()
      vi.runOnlyPendingTimers()

      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
      expect(editor.activeCollection.children()).toHaveLength(1)
      expect(source.hasClass('elementHover')).toBe(false)
      expect(source.hasClass('elementSelected')).toBe(false)
      expect(editor.isInteracting).toBe(false)
      expect(editor.selectSingleElement).toBe(false)
      expect(signalHarness.snapshot()).toEqual({})
      expect(editor.signals.offsetGhostingStopped.dispatch).toHaveBeenCalled()
    } finally {
      fixture.dispose()
    }
  })

  test.each([
    ['MOVE', (editor, source) => {
      editor.selected = [source]
      moveCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    }],
    ['ROTATE', (editor, source) => {
      editor.selected = [source]
      rotateCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
      editor.signals.pointCaptured.dispatch({ x: 1, y: 0 })
    }],
    ['SCALE', (editor, source) => {
      editor.selected = [source]
      scaleCommand(editor)
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    }],
    ['COPY', (editor, source) => {
      editor.selected = [source]
      copyCommand(editor)
      keydown('Enter', 'Enter')
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    }],
    ['MIRROR', (editor, source) => {
      editor.selected = [source]
      mirrorCommand(editor)
      keydown('Enter', 'Enter')
      editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    }],
  ])('%s cancellation after preview creation returns to the exact baseline', (_name, enterPreview) => {
    const listenerTracker = installDomListenerTracker()
    const fixture = createDeterministicEditorFixture()
    const { editor, signalHarness } = fixture
    const source = editor.activeCollection.line(1, 1, 4, 1).attr({ id: 'cancel-source' })
    const harnesses = { listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, harnesses)
    const baselineElementIndex = editor.elementIndex

    try {
      enterPreview(editor, source)
      editor.signals.commandCancelled.dispatch()
      vi.runOnlyPendingTimers()

      expectNoInteractionLeaks(editor, baseline, harnesses)
      expect(editor.suppressHandlers).toBe(false)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
      expect(editor.elementIndex).toBe(baselineElementIndex)
      expect(points(source)).toEqual([[1, 1], [4, 1]])
      expect(editor.svg.node.querySelector('[data-nanquim-transient="true"]')).toBeNull()
      expect(editor.svg.node.querySelector('.mirror-axis-helper')).toBeNull()
    } finally {
      fixture.dispose()
      listenerTracker.dispose()
    }
  })
})
