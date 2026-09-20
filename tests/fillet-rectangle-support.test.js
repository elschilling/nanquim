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

function select(command, editor, element, point = { x: 5, y: 3 }) {
  editor.lastClick = point
  editor.signals.toogledSelect.dispatch(element)
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('FILLET rectangle support', () => {
  test('rounds all rectangle corners in one reversible History mutation', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6).move(2, 3).attr({
      id: 'room',
      name: 'Room',
      'data-zone': 'A',
    })
    editor.cmdParams.filletRadius = 2
    const command = new FilletCommand(editor)

    command.execute()
    select(command, editor, rectangle)

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.undos[0].type).toBe('FilletCommand')
    expect(editor.documentState.revision).toBe(1)
    expect(rectangle.attr()).toMatchObject({
      id: 'room',
      name: 'Room',
      'data-zone': 'A',
      rx: 2,
      ry: 2,
    })
    expect(rectangle.type).toBe('rect')
    expect(editor.isInteracting).toBe(true)
    expect(editor.selectSingleElement).toBe(true)

    command.cleanup()
    editor.history.undo()
    expect(rectangle.node.hasAttribute('rx')).toBe(false)
    expect(rectangle.node.hasAttribute('ry')).toBe(false)
    expect(rectangle.node.isConnected).toBe(true)

    editor.history.redo()
    expect(rectangle.attr('rx')).toBe(2)
    expect(rectangle.attr('ry')).toBe(2)
    expect(rectangle.node.isConnected).toBe(true)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('radius zero removes rounded corners and Undo restores exact radii', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6).move(2, 3).attr({ rx: 2, ry: 1 })
    editor.cmdParams.filletRadius = 0
    const command = new FilletCommand(editor)

    command.execute()
    select(command, editor, rectangle)

    expect(rectangle.node.hasAttribute('rx')).toBe(false)
    expect(rectangle.node.hasAttribute('ry')).toBe(false)
    command.cleanup()

    editor.history.undo()
    expect(rectangle.attr('rx')).toBe(2)
    expect(rectangle.attr('ry')).toBe(1)
    editor.history.redo()
    expect(rectangle.node.hasAttribute('rx')).toBe(false)
    expect(rectangle.node.hasAttribute('ry')).toBe(false)
  })

  test('rejects a radius larger than half the shortest side and re-arms selection', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6)
    editor.cmdParams.filletRadius = 4
    const command = new FilletCommand(editor)

    command.execute()
    select(command, editor, rectangle)

    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'Fillet radius 4 is too large for this rectangle. Maximum radius is 3.',
    })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(rectangle.node.hasAttribute('rx')).toBe(false)
    expect(rectangle.node.hasAttribute('ry')).toBe(false)
    expect(editor.isInteracting).toBe(true)
    expect(editor.selectSingleElement).toBe(true)
    expect(editor.signals.toogledSelect.getNumListeners()).toBe(1)
    command.cleanup()
  })

  test('rejects transformed and invalid rectangles without entering History', () => {
    const { activeCollection, editor } = createFixture()
    const transformed = activeCollection.rect(10, 6).attr('transform', 'translate(2 3)')
    const invalid = activeCollection.rect(0, 6)
    editor.cmdParams.filletRadius = 2
    const command = new FilletCommand(editor)

    command.execute()
    select(command, editor, transformed)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'FILLET does not support transformed rectangles.',
    })

    select(command, editor, invalid)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'FILLET requires a rectangle with finite positive dimensions.',
    })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.isInteracting).toBe(true)
    expect(editor.signals.toogledSelect.getNumListeners()).toBe(1)
    command.cleanup()
  })

  test('repeats rectangle fillets as independent mutations until canceled', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(10, 6)
    const second = activeCollection.rect(8, 8).move(20, 0)
    editor.cmdParams.filletRadius = 2
    const command = new FilletCommand(editor)

    command.execute()
    select(command, editor, first)
    select(command, editor, second, { x: 24, y: 4 })

    expect(editor.history.undos).toHaveLength(2)
    expect(first.attr('rx')).toBe(2)
    expect(second.attr('rx')).toBe(2)
    command.cleanup()

    editor.history.undo()
    expect(first.attr('rx')).toBe(2)
    expect(second.node.hasAttribute('rx')).toBe(false)
    editor.history.undo()
    expect(first.node.hasAttribute('rx')).toBe(false)
  })

  test('rolls back rectangle attributes when the first History apply fails', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6).attr({
      id: 'failure-rectangle',
      name: 'Preserved',
    })
    const originalMarkup = rectangle.node.outerHTML
    const originalAttr = rectangle.attr.bind(rectangle)
    const failure = new Error('synthetic rectangle FILLET failure')
    vi.spyOn(rectangle, 'attr').mockImplementation((...args) => {
      const result = originalAttr(...args)
      if (typeof args[0] === 'object') throw failure
      return result
    })
    editor.cmdParams.filletRadius = 2
    const command = new FilletCommand(editor)

    command.execute()
    select(command, editor, rectangle)

    expect(rectangle.node.outerHTML).toBe(originalMarkup)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
  })
})
