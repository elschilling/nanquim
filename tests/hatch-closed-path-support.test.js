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

describe('HATCH closed path support', () => {
  test('copies an exact closed curve boundary and round-trips through History', () => {
    const { activeCollection, editor } = createFixture()
    const boundary = activeCollection.path(
      'M 2 8 C 2 2 8 2 8 8 L 12 8 A 4 3 0 0 1 8 11 Q 5 14 2 8 Z',
    ).attr({ id: 'closed-curve', 'fill-rule': 'evenodd' })
    editor.selected = [boundary]
    editor.elementIndex = 600
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(command.hatchElement.array().map(segment => [...segment]))
      .toEqual(boundary.array().map(segment => [...segment]))
    expect(command.hatchElement.attr('fill-rule')).toBe('evenodd')
    expect(command.patternType).toBe('ANSI31')
    expect(command.hatchElement.attr('fill')).toMatch(/^url\(#hatch-ansi31-/)
    expect(command.hatchElement.data('hatchData')).toMatchObject({
      hatchScale: 10,
      opacity: 1,
      patternType: 'ANSI31',
    })
    expect(command.hatchElement.attr('id')).toBe(600)
    expect(boundary.node.isConnected).toBe(true)
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)

    const hatchNode = command.hatchElement.node
    editor.history.undo()
    expect(hatchNode.isConnected).toBe(false)
    expect(boundary.node.isConnected).toBe(true)
    editor.history.redo()
    expect(command.hatchElement.node).toBe(hatchNode)
    expect(hatchNode.isConnected).toBe(true)
    expect(editor.documentState.revision).toBe(3)
  })

  test('uses the visible line-pattern default for click-inside hatching', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(20, 12).move(0, 0)
    editor.selected = []
    const command = new HatchCommand(editor)

    command.execute()
    editor.signals.pointCaptured.dispatch({ x: 10, y: 6 })

    expect(editor.history.undos).toEqual([command])
    expect(command.patternType).toBe('ANSI31')
    expect(command.hatchElement.attr('fill')).toMatch(/^url\(#hatch-ansi31-/)
    expect(command.patternElement.node.isConnected).toBe(true)
    expect(command.hatchElement.data('hatchData')).toMatchObject({
      hatchScale: 10,
      opacity: 1,
      patternType: 'ANSI31',
    })
  })

  test('detects a closed curved path when clicking inside it', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.path(
      'M 5 0 H 15 A 5 5 0 0 1 20 5 V 15 Q 20 20 15 20 H 5 C 2 20 0 18 0 15 V 5 A 5 5 0 0 1 5 0 Z',
    )
    editor.selected = []
    const command = new HatchCommand(editor)

    command.execute()
    editor.signals.pointCaptured.dispatch({ x: 10, y: 10 })

    expect(editor.history.undos).toEqual([command])
    expect(command.hatchElement.node.isConnected).toBe(true)
    expect(command.hatchElement.array().at(-1)[0]).toBe('Z')
    expect(editor.signals.terminalLogged.dispatch).not.toHaveBeenCalledWith({
      msg: 'No closed boundary found at that point.',
    })
  })

  test('does not detect an open curved path as a click-inside boundary', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.path(
      'M 5 0 H 15 A 5 5 0 0 1 20 5 V 15 Q 20 20 15 20 H 5 C 2 20 0 18 0 15 V 5',
    )
    editor.selected = []
    const command = new HatchCommand(editor)

    command.execute()
    editor.signals.pointCaptured.dispatch({ x: 10, y: 10 })

    expect(editor.history.undos).toHaveLength(0)
    expect(editor.svg.node.querySelector('.hatch-fill')).toBeNull()
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({
      msg: 'No closed boundary found at that point. Try clicking inside a closed region.',
    })
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
  })

  test('keeps nested subpaths as holes when clicking inside a compound path', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.path('M 0 0 H 20 V 20 H 0 Z M 5 5 H 15 V 15 H 5 Z')
    editor.selected = []
    const command = new HatchCommand(editor)

    command.execute()
    editor.signals.pointCaptured.dispatch({ x: 2, y: 2 })

    expect(editor.history.undos).toEqual([command])
    expect(command.hatchElement.array().filter(segment => segment[0] === 'M')).toHaveLength(2)
    expect(command.hatchElement.attr('fill-rule')).toBe('evenodd')
  })

  test('keeps an explicitly selected solid hatch translucent', () => {
    const { activeCollection, editor } = createFixture()
    const boundary = activeCollection.path('M 0 0 H 20 V 12 H 0 Z')
    editor.selected = [boundary]
    editor.lastHatchPattern = 'SOLID'
    const command = new HatchCommand(editor)

    command.execute()

    expect(command.patternType).toBe('SOLID')
    expect(command.hatchElement.attr('fill')).toBe('#ffffff')
    expect(command.hatchElement.attr('fill-opacity')).toBe(0.3)
    expect(command.hatchElement.data('hatchData')).toMatchObject({
      opacity: 0.3,
      patternType: 'SOLID',
    })
  })

  test('hatches a mixed selection of rectangles and closed paths as one compound boundary', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(10, 6).move(0, 0)
    const triangle = activeCollection.path('M 20 0 L 28 0 L 24 7 Z')
    const curved = activeCollection.path('M 35 0 Q 43 4 35 8 Q 31 4 35 0 Z')
    editor.selected = [curved, rectangle, triangle]
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.history.undos).toEqual([command])
    expect(command.pendingHatch.boundaryCount).toBe(10)
    expect(command.hatchElement.array().filter(segment => segment[0] === 'M')).toHaveLength(3)
    expect(command.hatchElement.attr('fill-rule')).toBe('nonzero')
    expect(rectangle.node.isConnected).toBe(true)
    expect(triangle.node.isConnected).toBe(true)
    expect(curved.node.isConnected).toBe(true)
  })

  test('preserves explicitly closed multiple subpaths and their even-odd holes', () => {
    const { activeCollection, editor } = createFixture()
    const boundary = activeCollection.path(
      'M 0 0 H 20 V 20 H 0 Z M 5 5 H 15 V 15 H 5 Z',
    ).attr('fill-rule', 'evenodd')
    editor.selected = [boundary]
    const command = new HatchCommand(editor)

    command.execute()

    expect(command.hatchElement.array().map(segment => [...segment]))
      .toEqual(boundary.array().map(segment => [...segment]))
    expect(command.hatchElement.attr('fill-rule')).toBe('evenodd')
    expect(command.hatchElement.array().filter(segment => segment[0] === 'Z')).toHaveLength(2)
  })

  test.each([
    {
      configure(path) { path.plot('M 0 0 C 4 0 4 4 8 4') },
      diagnostic: 'HATCH requires selected paths whose finite subpaths are explicitly closed.',
      title: 'an open path',
    },
    {
      configure(path) { path.attr('transform', 'translate(2 3)') },
      diagnostic: 'HATCH does not support transformed boundaries near the selected region.',
      title: 'a transformed closed path',
    },
  ])('rejects $title before mutation', ({ configure, diagnostic }) => {
    const { activeCollection, editor } = createFixture()
    const boundary = activeCollection.path('M 0 0 L 8 0 L 4 6 Z')
    configure(boundary)
    editor.selected = [boundary]
    const command = new HatchCommand(editor)

    command.execute()

    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({ msg: diagnostic })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.svg.node.querySelector('.hatch-fill')).toBeNull()
    expect(editor.isInteracting).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
  })
})
