// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { HatchCommand } from '../src/js/commands/HatchCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixture.editor.collections.get(fixture.activeCollection.attr('id')).visible = true
  fixtures.push(fixture)
  return fixture
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('HATCH rectangle support', () => {
  test('immediately hatches a preselected rectangle and round-trips through History', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6).move(2, 3).attr({
      id: 'rounded-rectangle',
      rx: 2,
      ry: 1,
    })
    editor.selected = [rectangle]
    editor.elementIndex = 500
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(command.hatchElement.array().map(segment => [...segment])).toEqual([
      ['M', 4, 3],
      ['H', 10],
      ['A', 2, 1, 0, 0, 1, 12, 4],
      ['V', 8],
      ['A', 2, 1, 0, 0, 1, 10, 9],
      ['H', 4],
      ['A', 2, 1, 0, 0, 1, 2, 8],
      ['V', 4],
      ['A', 2, 1, 0, 0, 1, 4, 3],
      ['Z'],
    ])
    expect(command.hatchElement.attr('id')).toBe(500)
    expect(command.hatchElement.parent()).toBe(activeCollection)
    expect(rectangle.node.isConnected).toBe(true)
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)

    const hatchNode = command.hatchElement.node
    editor.history.undo()
    expect(hatchNode.isConnected).toBe(false)
    expect(rectangle.node.isConnected).toBe(true)

    editor.history.redo()
    expect(command.hatchElement.node).toBe(hatchNode)
    expect(hatchNode.isConnected).toBe(true)
    expect(editor.documentState.revision).toBe(3)
  })

  test('creates a reusable pattern when the collection stroke is an RGB color', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6).move(2, 3)
    editor.collections.get(activeCollection.attr('id')).style.stroke = 'rgb(255, 255, 255)'
    editor.selected = [rectangle]
    editor.lastHatchPattern = 'ANSI31'
    editor.lastHatchScale = 5

    const first = new HatchCommand(editor)
    first.execute()
    const second = new HatchCommand(editor)
    second.execute()

    const patternId = 'hatch-ansi31-rgb-255-255-255-5'
    expect(first.hatchElement.attr('fill')).toBe(`url(#${patternId})`)
    expect(second.hatchElement.attr('fill')).toBe(`url(#${patternId})`)
    expect(editor.svg.defs().find('pattern')).toHaveLength(1)
    expect(editor.svg.node.querySelector(`pattern[id="${patternId}"]`)).not.toBeNull()
    expect(editor.history.undos).toEqual([first, second])
  })

  test('creates one nonzero hatch for multiple selected rectangles', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.rect(10, 8).move(0, 0)
    const second = activeCollection.rect(4, 3).move(20, 5)
    editor.selected = [second, first]
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.history.undos).toEqual([command])
    expect(command.pendingHatch.boundaryCount).toBe(8)
    expect(command.hatchElement.array().filter(segment => segment[0] === 'M')).toHaveLength(2)
    expect(command.hatchElement.attr('fill-rule')).toBe('nonzero')
    expect(first.node.isConnected).toBe(true)
    expect(second.node.isConnected).toBe(true)
  })

  test('rejects a preselected rectangle with invalid dimensions before mutation', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(0, 8)
    editor.selected = [rectangle]
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'HATCH requires selected rectangles with finite positive dimensions.',
    })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.svg.node.querySelector('.hatch-fill')).toBeNull()
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
  })

  test('rejects a preselected transformed rectangle before mutation', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 8).attr('transform', 'translate(5 5)')
    editor.selected = [rectangle]
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'HATCH does not support transformed boundaries near the selected region.',
    })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.svg.node.querySelector('.hatch-fill')).toBeNull()
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
  })
})
