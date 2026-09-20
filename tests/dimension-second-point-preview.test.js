// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { alignedDimensionCommand } from '../src/js/commands/AlignedDimensionCommand.js'
import { linearDimensionCommand } from '../src/js/commands/LinearDimensionCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture({ coordinates: { x: 0, y: 0 } })
  fixture.editor.svg.zoom = vi.fn(() => 1)
  fixtures.push(fixture)
  return fixture
}

function previewState(editor) {
  const group = editor.svg.findOne('.dimension-second-point-preview')
  const line = group?.findOne('.measure-ghost')
  const text = group?.findOne('.measure-text')
  return {
    group,
    line,
    points: line?.array().map(([x, y]) => [Number(x), Number(y)]),
    text: text?.text(),
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.useFakeTimers()
})

afterEach(() => {
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('dimension second-point preview', () => {
  test.each([
    {
      execute: linearDimensionCommand,
      expectedText: '10.00',
      label: 'DIMLINEAR',
    },
    {
      execute: alignedDimensionCommand,
      expectedText: '11.18',
      label: 'DIMALIGNED',
    },
  ])('$label shows a live baseline and value outside optional overlays', ({
    execute,
    expectedText,
  }) => {
    const { editor } = createFixture()
    editor.overlays.hide()

    execute(editor)
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    editor.signals.updatedCoordinates.dispatch({ x: 10, y: 5 })

    const preview = previewState(editor)
    expect(preview.group).not.toBeNull()
    expect(preview.group.parent().node).toBe(editor.svg.node)
    expect(preview.group.parent().node).not.toBe(editor.overlays.node)
    expect(preview.group.attr('data-nanquim-transient')).toBe('true')
    expect(preview.group.attr('pointer-events')).toBe('none')
    expect(preview.points).toEqual([[0, 0], [10, 5]])
    expect(preview.text).toBe(expectedText)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.isDirty).toBe(false)

    editor.signals.commandCancelled.dispatch()
    vi.runAllTimers()

    expect(editor.svg.findOne('.dimension-second-point-preview')).toBeNull()
    expect(editor.signals.updatedCoordinates.getNumListeners()).toBe(0)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
  })

  test('DIMLINEAR removes the second-point preview when the second point is accepted', () => {
    const { editor } = createFixture()

    linearDimensionCommand(editor)
    editor.signals.pointCaptured.dispatch({ x: 2, y: 3 })
    editor.signals.updatedCoordinates.dispatch({ x: 9, y: 3 })
    expect(previewState(editor).text).toBe('7.00')

    editor.signals.pointCaptured.dispatch({ x: 9, y: 3 })

    expect(editor.svg.findOne('.dimension-second-point-preview')).toBeNull()
    expect(editor.svg.findOne('.measure-ghost')).toBeNull()
    expect(editor.signals.updatedCoordinates.getNumListeners()).toBe(0)
    expect(editor.history.undos).toHaveLength(0)

    editor.signals.commandCancelled.dispatch()
    vi.runAllTimers()
    expect(editor.svg.findOne('.measure-ghost-group')).toBeNull()
  })
})
