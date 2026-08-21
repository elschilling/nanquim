// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { HatchCommand } from '../src/js/commands/HatchCommand.js'
import {
  qualifyHatchGeometry,
  transformedGeometryContainsPoint,
  transformedGeometryIntersectsBoundary,
} from '../src/js/utils/hatchTransformQualification.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const TRANSFORM_DIAGNOSTIC = 'HATCH does not support transformed boundaries near the selected region.'
const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixture.editor.collections.get(fixture.activeCollection.attr('id')).visible = true
  fixtures.push(fixture)
  return fixture
}

function terminalMessages(editor) {
  return editor.signals.terminalLogged.dispatch.mock.calls
    .map(([entry]) => String(entry?.msg || ''))
}

function clearMutationSpies(editor) {
  editor.spatialIndex.markDirty.mockClear()
  editor.fullSpatialIndex.markDirty.mockClear()
  editor.signals.updatedOutliner.dispatch.mockClear()
}

function expectNoMutation(editor, { elementIndex, redoSentinel }) {
  expect(editor.history.undos).toHaveLength(0)
  expect(editor.history.redos).toEqual([redoSentinel])
  expect(editor.history.idCounter).toBe(0)
  expect(editor.documentState.isDirty).toBe(false)
  expect(editor.documentState.revision).toBe(0)
  expect(editor.elementIndex).toBe(elementIndex)
  expect(editor.spatialIndex.markDirty).not.toHaveBeenCalled()
  expect(editor.fullSpatialIndex.markDirty).not.toHaveBeenCalled()
  expect(editor.signals.updatedOutliner.dispatch).not.toHaveBeenCalled()
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('HATCH transformed-boundary policy', () => {
  test('qualifies transformed primitive bounds and curved detected boundaries', () => {
    const { activeCollection, editor } = createFixture()
    const translated = activeCollection.group().attr('transform', 'translate(20 10)')
    translated.polyline([[0, 0], [4, 0], [4, 3]])
    translated.polygon([[6, 0], [10, 0], [10, 3], [6, 3]])
    translated.circle(4).center(14, 2)
    translated.ellipse(4, 2).center(20, 2)
    const transformedPath = translated.path('M 24 0 L 28 0 L 28 3 Z')
    vi.spyOn(transformedPath, 'bbox').mockReturnValue({
      height: 3,
      width: 4,
      x: 24,
      y: 0,
    })

    const qualification = qualifyHatchGeometry(editor)

    expect(qualification.hasUnknownBounds).toBe(false)
    expect(qualification.transformedBounds).toEqual([
      { minX: 20, minY: 10, maxX: 48, maxY: 14 },
    ])
    expect(transformedGeometryContainsPoint(qualification, { x: 34, y: 12 })).toBe(true)
    expect(transformedGeometryContainsPoint(qualification, { x: 80, y: 80 })).toBe(false)
    expect(transformedGeometryIntersectsBoundary(
      qualification,
      [{ from: { x: 46, y: 11 }, segIdx: 0, to: { x: 47, y: 12 } }],
      [{ cx: 47, cy: 12, r: 2, type: 'arc' }],
    )).toBe(true)
    expect(transformedGeometryIntersectsBoundary(
      qualification,
      [{ from: { x: 80, y: 80 }, segIdx: 0, to: { x: 81, y: 81 } }],
      [{ type: 'line' }],
    )).toBe(false)
  })

  test('fails closed for unreadable CSS transforms and non-finite local geometry', () => {
    const { activeCollection, editor } = createFixture()
    const cssTransformed = activeCollection.line(0, 0, 5, 0)
    cssTransformed.node.style.transform = 'translate(5px, 5px)'
    const invalidRectangle = activeCollection.rect(2, 2).attr({
      transform: 'translate(20 20)',
      width: 'not-a-number',
    })

    const qualification = qualifyHatchGeometry(editor)

    expect(qualification.hasUnknownBounds).toBe(true)
    expect(qualification.transformedBounds).toEqual([])
    expect(transformedGeometryContainsPoint(qualification, { x: 1000, y: 1000 })).toBe(true)
    expect(transformedGeometryIntersectsBoundary(qualification, [], [])).toBe(false)
  })

  test.each([
    {
      click: { x: 25, y: 15 },
      createBoundary(parent) {
        const translated = parent.group().attr('transform', 'translate(20 10)')
        return translated.group().rect(10, 10)
      },
      label: 'translated nested rectangle',
    },
    {
      click: { x: 45, y: 25 },
      createBoundary(parent) {
        const translated = parent.group().attr('transform', 'translate(40 20)')
        const rotated = translated.group().attr('transform', 'rotate(45 5 5)')
        rotated.line(0, 0, 10, 0)
        rotated.line(10, 0, 10, 10)
        rotated.line(10, 10, 0, 10)
        rotated.line(0, 10, 0, 0)
        return rotated
      },
      label: 'translated and rotated nested line loop',
    },
  ])('rejects a $label without preview, History, or dirty state and re-arms once', ({
    click,
    createBoundary,
  }) => {
    const { activeCollection, editor, signalHarness } = createFixture()
    const boundary = createBoundary(activeCollection).attr('id', 'transformed-boundary')
    const boundaryMarkup = boundary.node.outerHTML
    const collectionMarkup = activeCollection.node.outerHTML
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)
    editor.elementIndex = 410
    clearMutationSpies(editor)
    const command = new HatchCommand(editor)

    command.execute()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    expect(editor.signals.commandCancelled.getNumListeners()).toBe(1)

    editor.signals.pointCaptured.dispatch(click)

    expect(terminalMessages(editor).filter(message => message === TRANSFORM_DIAGNOSTIC))
      .toHaveLength(1)
    expect(TRANSFORM_DIAGNOSTIC.length).toBeLessThan(100)
    expect(command.pendingHatch).toBeNull()
    expect(command.interactiveExecutionDone).toBe(false)
    expect(activeCollection.node.outerHTML).toBe(collectionMarkup)
    expect(boundary.node.outerHTML).toBe(boundaryMarkup)
    expect(editor.svg.node.querySelector('.hatch-fill')).toBeNull()
    expect(editor.svg.node.querySelector('[data-nanquim-transient="true"]')).toBeNull()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    expect(editor.signals.commandCancelled.getNumListeners()).toBe(1)
    expect(editor.isInteracting).toBe(true)
    expect(editor.suppressHandlers).toBe(true)
    expect(editor.selectSingleElement).toBe(true)
    expectNoMutation(editor, { elementIndex: 410, redoSentinel })

    editor.signals.commandCancelled.dispatch()

    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.commandCancelled.getNumListeners()).toBe(0)
    expect(signalHarness.snapshot()).toEqual({})
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expectNoMutation(editor, { elementIndex: 410, redoSentinel })
  })

  test('rejects a transformed divider that overlaps an otherwise safe enclosing boundary', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(10, 10).attr('id', 'safe-outer-boundary')
    const divider = activeCollection.line(0, 0, 0, 10).attr({
      id: 'transformed-divider',
      transform: 'translate(5 0)',
    })
    const drawingMarkup = activeCollection.node.outerHTML
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)
    editor.elementIndex = 415
    clearMutationSpies(editor)
    const command = new HatchCommand(editor)

    command.execute()
    editor.signals.pointCaptured.dispatch({ x: 2, y: 2 })

    expect(terminalMessages(editor)).toContain(TRANSFORM_DIAGNOSTIC)
    expect(activeCollection.node.outerHTML).toBe(drawingMarkup)
    expect(divider.node.isConnected).toBe(true)
    expect(command.pendingHatch).toBeNull()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    expectNoMutation(editor, { elementIndex: 415, redoSentinel })

    editor.signals.commandCancelled.dispatch()
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.commandCancelled.getNumListeners()).toBe(0)
    expectNoMutation(editor, { elementIndex: 415, redoSentinel })
  })

  test('keeps ordinary untransformed hatch behavior when transformed geometry is provably remote', () => {
    const { activeCollection, editor, signalHarness } = createFixture()
    const safeBoundary = activeCollection.rect(10, 10).move(0, 0)
      .attr('id', 'safe-boundary')
    const remoteGroup = activeCollection.group().attr('transform', 'translate(100 100)')
    const remoteBoundary = remoteGroup.rect(10, 10).attr('id', 'remote-boundary')
    const remoteMarkup = remoteBoundary.node.outerHTML
    editor.elementIndex = 420
    clearMutationSpies(editor)
    const command = new HatchCommand(editor)

    command.execute()
    editor.signals.pointCaptured.dispatch({ x: 5, y: 5 })

    expect(terminalMessages(editor)).not.toContain(TRANSFORM_DIAGNOSTIC)
    expect(editor.history.undos).toEqual([command])
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.history.idCounter).toBe(1)
    expect(editor.documentState.isDirty).toBe(true)
    expect(editor.documentState.revision).toBe(1)
    expect(command.hatchElement.attr('id')).toBe(420)
    expect(command.hatchElement.hasClass('hatch-fill')).toBe(true)
    expect(command.hatchElement.parent()).toBe(activeCollection)
    expect(command.hatchElement.node.isConnected).toBe(true)
    expect(safeBoundary.node.isConnected).toBe(true)
    expect(remoteBoundary.node.outerHTML).toBe(remoteMarkup)
    expect(remoteBoundary.parent()).toBe(remoteGroup)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.commandCancelled.getNumListeners()).toBe(0)
    expect(signalHarness.snapshot()).toEqual({})
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(1)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(1)
    expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalledTimes(1)

    const hatchNode = command.hatchElement.node
    editor.history.undo()
    expect(hatchNode.isConnected).toBe(false)
    editor.history.redo()
    expect(command.hatchElement.node).toBe(hatchNode)
    expect(hatchNode.isConnected).toBe(true)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })
})
