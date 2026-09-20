// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { catmullRomToBezierPath } from '../src/js/commands/DrawSplineCommand.js'
import { TrimCommand } from '../src/js/commands/TrimCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixture.editor.collections.get(fixture.activeCollection.attr('id')).visible = true
  fixtures.push(fixture)
  return fixture
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('TRIM spline cut boundaries', () => {
  test('a selected spline cuts a line at the visible curve intersection', () => {
    const { activeCollection, editor } = createFixture()
    const target = activeCollection.line(0, 0, 10, 0)
    const points = [
      { x: 5, y: -5 },
      { x: 5, y: -2 },
      { x: 5, y: 2 },
      { x: 5, y: 5 },
    ]
    const boundary = activeCollection.path(catmullRomToBezierPath(points))
      .data('splineData', { points })
    boundary.node.getTotalLength = vi.fn(() => 10)
    boundary.node.getPointAtLength = vi.fn(distance => ({ x: 5, y: distance - 5 }))
    const command = new TrimCommand(editor)
    command.boundaryElements = [boundary]

    const result = command.calculateLineTrim(target, { x: 8, y: 0 })

    expect(result).toMatchObject({
      action: {
        keep: 'start',
        newX: 5,
        newY: 0,
        type: 'shorten',
      },
      type: 'line',
    })
  })

  test('commits the spline-bounded line trim as one Undo/Redo mutation', () => {
    const { activeCollection, editor } = createFixture()
    const target = activeCollection.line(0, 0, 10, 0).attr('id', 'target-line')
    const points = [
      { x: 5, y: -5 },
      { x: 5, y: -2 },
      { x: 5, y: 2 },
      { x: 5, y: 5 },
    ]
    const boundary = activeCollection.path(catmullRomToBezierPath(points))
      .attr('id', 'spline-boundary')
      .data('splineData', { points })
    boundary.node.getTotalLength = vi.fn(() => 10)
    boundary.node.getPointAtLength = vi.fn(distance => ({ x: 5, y: distance - 5 }))
    const command = new TrimCommand(editor)
    command.boundaryElements = [boundary]
    editor.lastClick = { x: 8, y: 0 }

    command.onLineClicked(target)

    expect(editor.history.undos).toHaveLength(1)
    expect(target.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[0, 0], [5, 0]])
    expect(boundary.data('splineData').points).toEqual(points)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()

    editor.history.undo()
    expect(target.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[0, 0], [10, 0]])

    editor.history.redo()
    expect(target.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[0, 0], [5, 0]])
  })
})
