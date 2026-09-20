// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ExtendCommand } from '../src/js/commands/ExtendCommand.js'
import { getArcGeometry } from '../src/js/utils/arcUtils.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixture.editor.collections.get(fixture.activeCollection.attr('id')).visible = true
  fixtures.push(fixture)
  return fixture
}

function createArc(parent, points, id) {
  const geometry = getArcGeometry(points.p1, points.p2, points.p3)
  return parent.path(
    `M ${points.p1.x} ${points.p1.y} A ${geometry.radius} ${geometry.radius} 0 ${geometry.largeArcFlag} ${geometry.sweepFlag} ${points.p3.x} ${points.p3.y}`,
  ).attr('id', id).data('arcData', points)
}

function expectPointClose(actual, expected) {
  expect(actual.x).toBeCloseTo(expected.x, 7)
  expect(actual.y).toBeCloseTo(expected.y, 7)
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('EXTEND automatic arc support', () => {
  test('uses the nearest intersection that lies on another semantic arc', () => {
    const { activeCollection, editor } = createFixture()
    const targetPoints = {
      p1: { x: 10, y: 0 },
      p2: { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 },
      p3: { x: 0, y: 10 },
    }
    const boundaryPoints = {
      p1: { x: 0, y: 0 },
      p2: { x: -10 + Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 },
      p3: { x: -10, y: 10 },
    }
    const target = createArc(activeCollection, targetPoints, 'target-arc')
    createArc(activeCollection, boundaryPoints, 'boundary-arc')
    const command = new ExtendCommand(editor)
    command.autoExtendMode = true

    const extension = command.calculateArcExtension(target, targetPoints.p3)

    expect(extension).toMatchObject({ extendStart: false, type: 'arc' })
    expectPointClose(extension.newPosition, { x: -5, y: Math.sqrt(75) })
  })

  test('keeps an automatically extended arc on its original circle through Undo/Redo', () => {
    const { activeCollection, editor } = createFixture()
    const original = {
      p1: { x: 10, y: 0 },
      p2: { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 },
      p3: { x: 0, y: 10 },
    }
    const target = createArc(activeCollection, original, 'target-arc')
    activeCollection.line(-5, 0, -5, 10).attr('id', 'boundary-line')
    const command = new ExtendCommand(editor)
    command.autoExtendMode = true
    editor.lastClick = { ...original.p3 }

    command.onLineClicked(target)

    expect(editor.history.undos).toHaveLength(1)
    const extended = target.data('arcData')
    expectPointClose(extended.p3, { x: -5, y: Math.sqrt(75) })
    const extendedGeometry = getArcGeometry(extended.p1, extended.p2, extended.p3)
    expect(extendedGeometry.cx).toBeCloseTo(0, 7)
    expect(extendedGeometry.cy).toBeCloseTo(0, 7)
    expect(extendedGeometry.radius).toBeCloseTo(10, 7)
    expect(extendedGeometry.ccw).toBe(true)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()

    editor.history.undo()
    expect(target.data('arcData')).toEqual(original)

    editor.history.redo()
    const redone = target.data('arcData')
    expectPointClose(redone.p3, extended.p3)
    expectPointClose(redone.p2, extended.p2)
    expect(target.attr('d')).toContain(`A ${extendedGeometry.radius}`)
  })
})
