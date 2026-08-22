// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ExtendCommand } from '../src/js/commands/ExtendCommand.js'
import { FilletCommand } from '../src/js/commands/FilletCommand.js'
import { MirrorCommand } from '../src/js/commands/MirrorCommand.js'
import { ScaleCommand } from '../src/js/commands/ScaleCommand.js'
import { TrimCircleCommand } from '../src/js/commands/TrimCircleCommand.js'
import { TrimCommand } from '../src/js/commands/TrimCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function messages(editor) {
  return editor.signals.terminalLogged.dispatch.mock.calls
    .map(([entry]) => String(entry?.msg || ''))
}

function clearMutationSpies(editor) {
  editor.spatialIndex.markDirty.mockClear()
  editor.fullSpatialIndex.markDirty.mockClear()
  editor.signals.updatedOutliner.dispatch.mockClear()
}

function expectNoMutation(editor, elementIndex) {
  expect(editor.history.undos).toHaveLength(0)
  expect(editor.history.redos).toHaveLength(0)
  expect(editor.documentState.isDirty).toBe(false)
  expect(editor.documentState.revision).toBe(0)
  expect(editor.elementIndex).toBe(elementIndex)
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

describe('transformed intersection command guards', () => {
  test('TRIM rejects transformed targets and nested transformed boundaries before calculation', () => {
    const { activeCollection, editor } = createFixture()
    const transformedParent = activeCollection.group().translate(20, 10)
    const transformedTarget = transformedParent.line(0, 0, 10, 0)
    const transformedBoundary = activeCollection.line(5, -5, 5, 5).rotate(30, 5, 0)
    const safeBoundary = activeCollection.line(8, -5, 8, 5)
    const trim = new TrimCommand(editor)
    const calculateTrim = vi.spyOn(trim, 'calculateTrim')
    editor.lastClick = { x: 5, y: 0 }
    editor.elementIndex = 200
    clearMutationSpies(editor)

    trim.onElementSelected(transformedBoundary)
    expect(trim.boundaryElements).toEqual([])

    trim.boundaryElements = [safeBoundary]
    trim.onLineClicked(transformedTarget)

    expect(calculateTrim).not.toHaveBeenCalled()
    expect(messages(editor).filter((message) => (
      message === 'TRIM does not support transformed targets or boundaries.'
    ))).toHaveLength(2)
    expectNoMutation(editor, 200)

    trim.autoTrimMode = true
    const candidates = trim.getCandidateBoundaries(safeBoundary)
    expect(candidates).not.toContain(transformedTarget)
    expect(candidates).not.toContain(transformedBoundary)
  })

  test('EXTEND rejects transformed selections/targets and ignores transformed auto boundaries', () => {
    const { activeCollection, editor } = createFixture()
    editor.collections.get(activeCollection.attr('id')).visible = true
    const target = activeCollection.line(0, 0, 5, 0).attr('id', 'target')
    const transformedBoundary = activeCollection.line(10, -5, 10, 5)
      .attr('id', 'transformed-boundary')
      .translate(100, 0)
    activeCollection.line(20, -5, 20, 5).attr('id', 'safe-boundary')
    const transformedParent = activeCollection.group().rotate(20, 0, 0)
    const transformedTarget = transformedParent.line(0, 0, 5, 0)
    const extend = new ExtendCommand(editor)
    const calculateExtension = vi.spyOn(extend, 'calculateExtension')
    editor.lastClick = { x: 5, y: 0 }
    editor.elementIndex = 210
    clearMutationSpies(editor)

    extend.onElementSelected(transformedBoundary)
    expect(extend.boundaryElements).toEqual([])

    extend.onLineClicked(transformedTarget)
    expect(calculateExtension).not.toHaveBeenCalled()
    expect(messages(editor).filter((message) => (
      message === 'EXTEND does not support transformed targets or boundaries.'
    ))).toHaveLength(2)
    expectNoMutation(editor, 210)

    calculateExtension.mockRestore()
    extend.autoExtendMode = true
    const extension = extend.calculateLineExtension(target, { x: 5, y: 0 })
    expect(extension.newPosition).toEqual({ x: 20, y: 0 })
  })

  test('FILLET re-arms selection after a transformed line without entering History', () => {
    const { activeCollection, editor } = createFixture()
    const safeLine = activeCollection.line(0, 0, 10, 0)
    const transformedParent = activeCollection.group().translate(10, 5)
    const transformedLine = transformedParent.line(0, 0, 0, 10)
    const command = new FilletCommand(editor)
    editor.elementIndex = 220
    clearMutationSpies(editor)

    command.execute()
    editor.lastClick = { x: 0, y: 5 }
    editor.signals.toogledSelect.dispatch(transformedLine)
    expect(command.selectedElements).toEqual([])

    editor.lastClick = { x: 5, y: 0 }
    editor.signals.toogledSelect.dispatch(safeLine)
    expect(command.selectedElements).toHaveLength(1)

    editor.lastClick = { x: 0, y: 5 }
    editor.signals.toogledSelect.dispatch(transformedLine)
    expect(command.selectedElements).toHaveLength(1)
    expect(messages(editor).filter((message) => (
      message === 'FILLET does not support transformed lines.'
    ))).toHaveLength(2)
    expectNoMutation(editor, 220)

    editor.signals.commandCancelled.dispatch()
  })

  test.each([
    ['TRIM', (editor) => new TrimCommand(editor)],
    ['EXTEND', (editor) => new ExtendCommand(editor)],
  ])('%s filters a transformed preselected boundary instead of bypassing the guard', (
    name,
    createCommand,
  ) => {
    const { activeCollection, editor } = createFixture()
    const transformed = activeCollection.line(0, 0, 10, 0).scale(2)
    editor.selected = [transformed]
    editor.elementIndex = 230
    clearMutationSpies(editor)
    const command = createCommand(editor)

    command.execute()

    expect(command.boundaryElements).toEqual([])
    expect(messages(editor)).toContain(
      `${name} does not support transformed targets or boundaries.`,
    )
    expectNoMutation(editor, 230)

    editor.signals.commandCancelled.dispatch()
    vi.runAllTimers()
  })

  test('SCALE rejects geometry in a transformed parent before point capture', () => {
    const { activeCollection, editor } = createFixture()
    const parent = activeCollection.group().translate(20, 10)
    const line = parent.line(0, 0, 10, 0)
    editor.selected = [line]
    editor.elementIndex = 240
    clearMutationSpies(editor)

    const command = new ScaleCommand(editor)
    command.execute()

    expect(messages(editor)).toContain(
      'SCALE does not support transformed primitive geometry or geometry inside transformed groups.',
    )
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expectNoMutation(editor, 240)
  })

  test('MIRROR rejects geometry in a transformed parent before creating previews', () => {
    const { activeCollection, editor } = createFixture()
    const parent = activeCollection.group().rotate(20, 0, 0)
    const line = parent.line(0, 0, 10, 0)
    editor.selected = [line]
    editor.elementIndex = 250
    clearMutationSpies(editor)
    const command = new MirrorCommand(editor)

    command.execute()
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }))

    expect(messages(editor)).toContain(
      'MIRROR does not support transformed geometry or geometry inside transformed groups.',
    )
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(command.copiedElements).toEqual([])
    expectNoMutation(editor, 250)
  })

  test('SCALE rejects a transformed primitive in the drawing root', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(0, 0, 10, 0).translate(20, 0)
    editor.selected = [line]
    editor.elementIndex = 260
    clearMutationSpies(editor)

    new ScaleCommand(editor).execute()

    expect(messages(editor)).toContain(
      'SCALE does not support transformed primitive geometry or geometry inside transformed groups.',
    )
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expectNoMutation(editor, 260)
  })

  test('MIRROR rejects a transformed primitive before creating a clone', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(0, 0, 10, 0).scale(2)
    editor.selected = [line]
    editor.elementIndex = 270
    clearMutationSpies(editor)
    const command = new MirrorCommand(editor)

    command.execute()
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }))

    expect(messages(editor)).toContain(
      'MIRROR does not support transformed geometry or geometry inside transformed groups.',
    )
    expect(command.copiedElements).toEqual([])
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expectNoMutation(editor, 270)
  })

  test('TRIM accepts circle intersections inside an arc boundary span', () => {
    const { activeCollection, editor } = createFixture()
    const target = activeCollection.circle(10).center(0, 0).attr({
      id: 'target-circle',
      name: 'Target circle',
    })
    const boundary = activeCollection.path('M 5 5 A 5 5 0 0 1 5 -5').attr({
      id: 'boundary-arc',
      fill: 'none',
    })
    boundary.data('circleTrimData', {
      ccw: true,
      cx: 5,
      cy: 0,
      endPt: { x: 5, y: -5 },
      r: 5,
      startPt: { x: 5, y: 5 },
      theta1: 3 * Math.PI / 2,
      theta2: Math.PI / 2,
    })
    const trim = new TrimCommand(editor)
    trim.boundaryElements = [boundary]
    editor.lastClick = { x: 5, y: 0 }

    const result = trim.calculateCircleTrim(target, editor.lastClick)
    expect(result?.action?.type).toBe('arcs')
    expect(result.action.arcs).toHaveLength(1)

    trim.onLineClicked(target)

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.undos[0]).toBeInstanceOf(TrimCircleCommand)
    expect(editor.documentState.revision).toBe(1)
  })
})
