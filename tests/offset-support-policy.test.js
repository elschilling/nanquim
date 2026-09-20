// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { offsetCommand } from '../src/js/commands/OffsetCommand.js'
import {
  applyArcOffsetToElement,
  applyOffsetToElement,
  applyPolylineOffsetToElement,
  computeArcOffsetGeometry,
  computeOffsetVector,
  computePolylineOffsetGeometry,
} from '../src/js/utils/offsetCalc.js'
import { getArcGeometry } from '../src/js/utils/arcUtils.js'
import {
  createDeterministicEditorFixture,
  expectNoInteractionLeaks,
  installClockHarness,
  installDomListenerTracker,
  snapshotInteractionState,
} from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function terminalMessages(editor) {
  return editor.signals.terminalLogged.dispatch.mock.calls
    .map(([entry]) => String(entry?.msg || ''))
}

function startOffset(editor, source, distance = 2) {
  offsetCommand(editor)
  editor.signals.inputValue.dispatch(String(distance))
  editor.signals.toogledSelect.dispatch(source)
}

function cancelOffset(editor) {
  editor.signals.commandCancelled.dispatch()
  vi.runAllTimers()
}

function clearMutationSpies(editor) {
  editor.spatialIndex.markDirty.mockClear()
  editor.fullSpatialIndex.markDirty.mockClear()
  editor.signals.updatedOutliner.dispatch.mockClear()
}

function expectNoMutation(editor, initialElementIndex, redoSentinel) {
  expect(editor.history.undos).toHaveLength(0)
  expect(editor.history.redos).toEqual([redoSentinel])
  expect(editor.history.idCounter).toBe(0)
  expect(editor.documentState.isDirty).toBe(false)
  expect(editor.documentState.revision).toBe(0)
  expect(editor.elementIndex).toBe(initialElementIndex)
  expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
  expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
  expect(editor.signals.updatedOutliner.dispatch).not.toHaveBeenCalled()
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

describe('OFFSET support policy', () => {
  test.each([
    {
      assertOffset(offset) {
        expect(offset.array().map(([x, y]) => [Number(x), Number(y)]))
          .toEqual([[0, 2], [10, 2]])
      },
      createSource(parent) {
        return parent.line(0, 0, 10, 0)
      },
      label: 'line',
      point: { x: 5, y: 5 },
    },
    {
      assertOffset(offset) {
        expect(offset.array().map(([x, y]) => [Number(x), Number(y)]))
          .toEqual([[0, 2], [8, 2], [8, 10]])
      },
      createSource(parent) {
        return parent.polyline([[0, 0], [10, 0], [10, 10]])
      },
      label: 'open polyline',
      point: { x: 5, y: 5 },
    },
    {
      assertOffset(offset) {
        expect(offset.array().map(([x, y]) => [Number(x), Number(y)]))
          .toEqual([[-2, -2], [12, -2], [12, 12], [-2, 12], [-2, -2]])
      },
      createSource(parent) {
        return parent.polyline([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
      },
      label: 'closed polyline',
      point: { x: -5, y: 5 },
    },
    {
      assertOffset(offset) {
        expect(offset.cx()).toBe(5)
        expect(offset.cy()).toBe(5)
        expect(offset.radius()).toBe(7)
      },
      createSource(parent) {
        return parent.circle(10).center(5, 5)
      },
      label: 'circle',
      point: { x: 12, y: 5 },
    },
    {
      assertOffset(offset) {
        const data = offset.data('arcData')
        expect(data.p1.x).toBeCloseTo(-2)
        expect(data.p1.y).toBeCloseTo(0)
        expect(data.p2.x).toBeCloseTo(5)
        expect(data.p2.y).toBeCloseTo(-7)
        expect(data.p3.x).toBeCloseTo(12)
        expect(data.p3.y).toBeCloseTo(0)
        expect(getArcGeometry(data.p1, data.p2, data.p3).radius).toBeCloseTo(7)
      },
      createSource(parent) {
        return parent.path('M 0 0 A 5 5 0 0 1 10 0').data('arcData', {
          p1: { x: 0, y: 0 },
          p2: { x: 5, y: -5 },
          p3: { x: 10, y: 0 },
        })
      },
      label: 'circular arc',
      point: { x: 5, y: -10 },
    },
    {
      assertOffset(offset) {
        const data = offset.data('arcData')
        expect(data.p1.x).toBeCloseTo(2)
        expect(data.p2.y).toBeCloseTo(-3)
        expect(data.p3.x).toBeCloseTo(8)
        expect(getArcGeometry(data.p1, data.p2, data.p3).radius).toBeCloseTo(3)
      },
      createSource(parent) {
        return parent.path('M 0 0 A 5 5 0 0 1 10 0').data('arcData', {
          p1: { x: 0, y: 0 },
          p2: { x: 5, y: -5 },
          p3: { x: 10, y: 0 },
        })
      },
      label: 'inward circular arc',
      point: { x: 5, y: 0 },
    },
    {
      assertOffset(offset) {
        expect(offset.x()).toBe(-2)
        expect(offset.y()).toBe(-2)
        expect(offset.width()).toBe(14)
        expect(offset.height()).toBe(10)
      },
      createSource(parent) {
        return parent.rect(10, 6).move(0, 0)
      },
      label: 'square-corner rectangle',
      point: { x: 20, y: 3 },
    },
  ])('qualified $label offset is one stable History mutation with Undo/Redo', ({
    assertOffset,
    createSource,
    point,
  }) => {
    const { activeCollection, editor } = createFixture()
    const source = createSource(activeCollection).attr({
      id: 'offset-source',
      name: 'Qualified source',
      stroke: '#ffffff',
      'stroke-width': 0.25,
    })
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)
    editor.elementIndex = 80
    clearMutationSpies(editor)

    startOffset(editor, source)
    editor.signals.pointCaptured.dispatch(point)

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.elementIndex).toBe(81)
    const historyCommand = editor.history.undos[0]
    const offset = historyCommand.element
    const offsetNode = offset.node
    expect(offset.attr('id')).toBe(80)
    expect(offset.attr('name')).toBe('Qualified source')
    expect(offset.node.parentNode).toBe(activeCollection.node)
    assertOffset(offset)
    expect(editor.signals.offsetGhostingStarted.dispatch).toHaveBeenCalledOnce()
    expect(editor.signals.offsetGhostingStarted.dispatch).toHaveBeenCalledWith(
      [source],
      2,
      editor.coordinates,
    )
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(1)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(1)
    expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalledTimes(1)

    editor.history.undo()

    expect(offset.node.isConnected).toBe(false)
    expect(editor.documentState.revision).toBe(2)
    expect(editor.elementIndex).toBe(81)

    editor.history.redo()

    expect(offset.node).toBe(offsetNode)
    expect(offset.attr('id')).toBe(80)
    expect(offset.node.parentNode).toBe(activeCollection.node)
    assertOffset(offset)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.elementIndex).toBe(81)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalledTimes(3)

    cancelOffset(editor)
  })

  test.each([
    {
      createSource(parent) {
        const group = parent.group().attr('id', 'unsupported-group')
        group.line(0, 0, 10, 0)
        return group
      },
      diagnostic: 'OFFSET supports only lines, polylines, circular arcs, circles, and square-corner rectangles.',
      label: 'group',
    },
    {
      createSource(parent) {
        return parent.use('offset-definition').attr({
          id: 'unsupported-use',
          href: '#offset-definition',
        })
      },
      diagnostic: 'OFFSET supports only lines, polylines, circular arcs, circles, and square-corner rectangles.',
      label: 'use',
    },
    {
      createSource(parent) {
        return parent.path('M 0 0 L 10 0').attr('id', 'unsupported-path')
      },
      diagnostic: 'OFFSET supports only lines, polylines, circular arcs, circles, and square-corner rectangles.',
      label: 'path',
    },
    {
      createSource(parent) {
        return parent.path('M 0 0 L 10 0').data('arcData', {
          p1: { x: 0, y: 0 },
          p2: { x: 5, y: 0 },
          p3: { x: 10, y: 0 },
        })
      },
      diagnostic: 'OFFSET requires finite, non-degenerate geometry.',
      label: 'degenerate arc',
    },
    {
      createSource(parent) {
        return parent.polyline([[0, 0], [10, 10], [0, 10], [10, 0]])
      },
      diagnostic: 'OFFSET requires finite, non-degenerate geometry.',
      label: 'self-intersecting polyline',
    },
    {
      createSource(parent) {
        return parent.line(0, 0, 10, 0).rotate(30, 0, 0)
      },
      diagnostic: 'OFFSET does not support transformed geometry or geometry inside transformed groups.',
      label: 'directly transformed line',
    },
    {
      createSource(parent) {
        const transformedParent = parent.group().translate(10, 5)
        return transformedParent.line(0, 0, 10, 0)
      },
      diagnostic: 'OFFSET does not support transformed geometry or geometry inside transformed groups.',
      label: 'line below a transformed group',
    },
    {
      createSource(parent) {
        return parent.rect(10, 6).radius(2)
      },
      diagnostic: 'OFFSET does not yet support rounded rectangles.',
      label: 'rounded rectangle',
    },
  ])('$label is rejected before ghosting or mutation', ({
    createSource,
    diagnostic,
  }) => {
    const { activeCollection, editor } = createFixture()
    const source = createSource(activeCollection)
    const sourceMarkup = source.node.outerHTML
    const drawingChildren = activeCollection.children().map((element) => element.node)
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)
    editor.elementIndex = 90
    clearMutationSpies(editor)

    startOffset(editor, source)

    expect(editor.signals.offsetGhostingStarted.dispatch).not.toHaveBeenCalled()
    expect(activeCollection.children().map((element) => element.node)).toEqual(drawingChildren)
    expect(source.node.outerHTML).toBe(sourceMarkup)
    expect(terminalMessages(editor).filter((message) => message === diagnostic)).toHaveLength(1)
    expect(diagnostic.length).toBeLessThan(100)
    expectNoMutation(editor, 90, redoSentinel)

    editor.signals.pointCaptured.dispatch({ x: 5, y: 5 })
    expectNoMutation(editor, 90, redoSentinel)

    cancelOffset(editor)
    expectNoMutation(editor, 90, redoSentinel)
  })

  test.each([
    {
      createSource(parent) {
        return parent.circle(10).center(5, 5)
      },
      label: 'circle',
      point: { x: 5, y: 5 },
    },
    {
      createSource(parent) {
        return parent.path('M 0 0 A 5 5 0 0 1 10 0').data('arcData', {
          p1: { x: 0, y: 0 },
          p2: { x: 5, y: -5 },
          p3: { x: 10, y: 0 },
        })
      },
      label: 'arc',
      point: { x: 5, y: 0 },
    },
    {
      createSource(parent) {
        return parent.rect(10, 6).move(0, 0)
      },
      label: 'rectangle',
      point: { x: 5, y: 3 },
    },
    {
      createSource(parent) {
        return parent.polyline([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
      },
      label: 'closed polyline',
      point: { x: 5, y: 5 },
    },
  ])('invalid inward $label result exits without a degenerate mutation', ({
    createSource,
    point,
  }) => {
    const { activeCollection, editor } = createFixture()
    const source = createSource(activeCollection).attr('id', 'inward-source')
    const sourceMarkup = source.node.outerHTML
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)
    editor.elementIndex = 100
    clearMutationSpies(editor)

    startOffset(editor, source, 5)
    editor.signals.pointCaptured.dispatch(point)

    expect(editor.signals.offsetGhostingStarted.dispatch).toHaveBeenCalledOnce()
    expect(editor.signals.offsetGhostingStopped.dispatch).toHaveBeenCalledOnce()
    expect(source.node.outerHTML).toBe(sourceMarkup)
    expect(activeCollection.children()).toHaveLength(1)
    expect(terminalMessages(editor)).toContain(
      'OFFSET distance is too large for a valid inward result.',
    )
    expectNoMutation(editor, 100, redoSentinel)

    cancelOffset(editor)
  })

  test('cancellation after a qualified selection removes listeners and leaves counters stable', async () => {
    vi.useRealTimers()
    const listenerTracker = installDomListenerTracker()
    const clock = installClockHarness()
    const fixture = createFixture()
    const { activeCollection, editor, signalHarness } = fixture
    const source = activeCollection.line(0, 0, 10, 0)
      .attr('id', 'cancel-source')
      .addClass('elementHover')
      .addClass('elementSelected')
    editor.elementIndex = 120
    const harnesses = { clock, listenerTracker, signalHarness }
    const baseline = snapshotInteractionState(editor, {
      ...harnesses,
      includeElementIndex: true,
    })

    try {
      startOffset(editor, source)
      editor.signals.commandCancelled.dispatch()
      await clock.runAll()

      expectNoInteractionLeaks(editor, baseline, {
        ...harnesses,
        includeElementIndex: true,
      })
      expect(source.hasClass('elementHover')).toBe(false)
      expect(source.hasClass('elementSelected')).toBe(false)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
      expect(editor.elementIndex).toBe(120)
      expect(activeCollection.children()).toHaveLength(1)
    } finally {
      clock.dispose()
      listenerTracker.dispose()
    }
  })

  test('offset geometry utility rejects path fallback instead of translating it', () => {
    const { activeCollection } = createFixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const path = activeCollection.path('M 0 0 L 10 0')
    const pathMarkup = path.node.outerHTML

    const vector = computeOffsetVector(line, { x: 5, y: 4 }, 2)
    expect(vector.dx).toBeCloseTo(0)
    expect(vector.dy).toBe(2)
    applyOffsetToElement(line, vector.dx, vector.dy)
    expect(line.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[0, 2], [10, 2]])

    expect(() => computeOffsetVector(path, { x: 5, y: 4 }, 2))
      .toThrow('Offset direction is qualified only for line geometry')
    expect(() => applyOffsetToElement(path, 0, 2))
      .toThrow('Only line geometry has a qualified vector offset')
    expect(path.node.outerHTML).toBe(pathMarkup)
  })

  test('polyline geometry utility offsets either side without changing the source', () => {
    const { activeCollection } = createFixture()
    const source = activeCollection.polyline([[0, 0], [10, 0], [10, 10]])
    const sourceMarkup = source.node.outerHTML
    const left = source.clone()
    const right = source.clone()

    const leftResult = computePolylineOffsetGeometry(source, { x: 5, y: 5 }, 2)
    applyPolylineOffsetToElement(left, leftResult)
    expect(left.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[0, 2], [8, 2], [8, 10]])

    const rightResult = computePolylineOffsetGeometry(source, { x: 5, y: -5 }, 2)
    applyPolylineOffsetToElement(right, rightResult)
    expect(right.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[0, -2], [12, -2], [12, 10]])
    expect(source.node.outerHTML).toBe(sourceMarkup)
  })

  test('closed polyline geometry utility preserves closure for a valid inward offset', () => {
    const { activeCollection } = createFixture()
    const source = activeCollection.polyline([
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
    ])
    const clone = source.clone()

    const result = computePolylineOffsetGeometry(source, { x: 5, y: 5 }, 2)
    applyPolylineOffsetToElement(clone, result)

    expect(result.closed).toBe(true)
    expect(clone.array().map(([x, y]) => [Number(x), Number(y)]))
      .toEqual([[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]])

    try {
      computePolylineOffsetGeometry(source, { x: 5, y: 5 }, 6)
      throw new Error('Expected an overrun inward offset to be rejected')
    } catch (error) {
      expect(error.offsetIssue).toBe('inward-distance')
    }
  })

  test('arc geometry utility keeps trimmed-circle metadata concentric and editable', () => {
    const { activeCollection } = createFixture()
    const arc = activeCollection.path('M 0 0 A 5 5 0 0 1 10 0').data('arcData', {
      p1: { x: 0, y: 0 },
      p2: { x: 5, y: -5 },
      p3: { x: 10, y: 0 },
    }).data('circleTrimData', {
      ccw: true,
      cx: 5,
      cy: 0,
      endPt: { x: 10, y: 0 },
      midPt: { x: 5, y: -5 },
      r: 5,
      startPt: { x: 0, y: 0 },
      theta1: 0,
      theta2: Math.PI,
    })
    const clone = arc.clone()

    const result = computeArcOffsetGeometry(arc, { x: 5, y: -10 }, 2)
    applyArcOffsetToElement(clone, result)

    expect(result.radius).toBeCloseTo(7)
    expect(clone.data('circleTrimData')).toMatchObject({
      cx: 5,
      cy: 0,
      r: 7,
      startPt: result.arcData.p1,
      midPt: result.arcData.p2,
      endPt: result.arcData.p3,
      theta1: 0,
      theta2: Math.PI,
    })
    expect(getArcGeometry(
      clone.data('arcData').p1,
      clone.data('arcData').p2,
      clone.data('arcData').p3,
    ).radius).toBeCloseTo(7)
  })
})
