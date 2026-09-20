// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  DrawSplineCommand,
  constrainSplinePoint,
} from '../src/js/commands/DrawSplineCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function click(command, x, y) {
  command.handleClick({ button: 0, pageX: x, pageY: y })
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('SPLINE Ortho mode', () => {
  test.each([
    [{ x: 30, y: 18 }, { x: 10, y: 10 }, true, { x: 30, y: 10 }],
    [{ x: 14, y: 40 }, { x: 10, y: 10 }, true, { x: 10, y: 40 }],
    [{ x: 30, y: 18 }, { x: 10, y: 10 }, false, { x: 30, y: 18 }],
    [{ x: 7, y: 8 }, null, true, { x: 7, y: 8 }],
  ])('constrains %j from %j when Ortho is %s', (point, reference, ortho, expected) => {
    expect(constrainSplinePoint(point, reference, ortho)).toEqual(expected)
  })

  test('uses each committed point as the Ortho reference and persists constrained spline data', () => {
    const { activeCollection, editor } = createFixture()
    editor.ortho = true
    const command = new DrawSplineCommand(editor)
    command.execute()

    click(command, 10, 10)
    click(command, 30, 18)
    click(command, 34, 40)

    expect(command.points).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 40 },
    ])

    command.finalizeSpline()

    const spline = activeCollection.findOne('path')
    expect(spline.data('splineData')).toEqual({ points: [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 40 },
    ] })
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.isDrawing).toBe(false)
  })

  test('constrains snapped clicks and refreshes a stationary preview when Ortho changes', () => {
    const { editor } = createFixture()
    editor.ortho = true
    const command = new DrawSplineCommand(editor)
    command.execute()
    click(command, 10, 10)

    editor.snapPoint = { x: 30, y: 18 }
    command.handleMove({ pageX: 100, pageY: 100 })
    expect(command.splinePath.attr('d')).toBe('M 10 10 L 30 10')

    click(command, 100, 100)
    expect(command.points[1]).toEqual({ x: 30, y: 10 })

    editor.snapPoint = null
    editor.coordinates = { x: 38, y: 35 }
    editor.ortho = false
    editor.svg.fire('orthoChange')
    expect(command.splinePath.attr('d')).toContain('38 35')

    editor.ortho = true
    editor.signals.updatedCoordinates.dispatch({ x: 38, y: 35 })
    expect(command.splinePath.attr('d')).toContain('30 35')

    command.cleanup()
    expect(editor.isDrawing).toBe(false)
    expect(editor.svg.findOne('[data-nanquim-transient="true"]')).toBeNull()
  })
})
