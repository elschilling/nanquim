// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { TrimEllipseCommand } from '../src/js/commands/TrimEllipseCommand.js'
import { TrimPolylineCommand } from '../src/js/commands/TrimPolylineCommand.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function childIds(parent) {
  return Array.from(parent.node.children, (node) => node.getAttribute('id'))
}

function clearMutationSignals(editor) {
  editor.spatialIndex.markDirty.mockClear()
  editor.fullSpatialIndex.markDirty.mockClear()
  editor.signals.updatedOutliner.dispatch.mockClear()
  editor.signals.updatedProperties.dispatch.mockClear()
  editor.signals.updatedSelection.dispatch.mockClear()
}

function expectNarrowMutationSignals(editor, count) {
  expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(count)
  expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(count)
  expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalledTimes(count)
  expect(editor.signals.updatedProperties.dispatch).not.toHaveBeenCalled()
  expect(editor.signals.updatedSelection.dispatch).not.toHaveBeenCalled()
}

function ellipseArcs() {
  return [
    {
      ccw: true,
      cx: 5,
      cy: 5,
      endPt: { x: 5, y: 9 },
      rx: 6,
      ry: 4,
      startPt: { x: 11, y: 5 },
      theta1: 0,
      theta2: Math.PI / 2,
    },
    {
      ccw: true,
      cx: 5,
      cy: 5,
      endPt: { x: -1, y: 5 },
      rx: 6,
      ry: 4,
      startPt: { x: 5, y: 9 },
      theta1: Math.PI / 2,
      theta2: Math.PI,
    },
  ]
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('trim replacement transactions', () => {
  test('ellipse replacement executes once and restores exact order and identities on Undo/Redo', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = activeCollection.ellipse(12, 8).center(5, 5).attr({
      id: 'ellipse-source',
      name: 'Ellipse source',
      opacity: 0.7,
      stroke: '#8b5a5a',
      'stroke-linecap': 'round',
      'stroke-width': 2,
      'data-style-overrides': 'stroke',
    })
    activeCollection.rect(1, 1).attr('id', 'after')
    editor.elementIndex = 20
    clearMutationSignals(editor)
    const arcs = ellipseArcs()
    const command = new TrimEllipseCommand(editor, source, {
      arcs,
      type: 'replace',
    })

    editor.execute(command)

    expect(editor.history.undos).toEqual([command])
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.elementIndex).toBe(22)
    expect(childIds(activeCollection)).toEqual(['before', '20', '21', 'after'])
    expect(source.node.isConnected).toBe(false)
    expect(command.arcPaths.map((path) => path.data('ellipseArcData'))).toEqual(arcs)
    expect(command.arcPaths.map((path) => path.attr('name'))).toEqual([
      'EllipseArc',
      'EllipseArc',
    ])
    expect(command.arcPaths.map((path) => path.attr('stroke'))).toEqual([
      '#8b5a5a',
      '#8b5a5a',
    ])
    const replacementNodes = command.arcPaths.map((path) => path.node)
    expectNarrowMutationSignals(editor, 1)

    editor.history.undo()

    expect(childIds(activeCollection)).toEqual(['before', 'ellipse-source', 'after'])
    expect(source.parent()).toBe(activeCollection)
    expect(command.arcPaths.every((path) => !path.node.isConnected)).toBe(true)
    expect(editor.documentState.revision).toBe(2)
    expect(editor.elementIndex).toBe(22)
    expectNarrowMutationSignals(editor, 2)

    editor.history.redo()

    expect(childIds(activeCollection)).toEqual(['before', '20', '21', 'after'])
    expect(command.arcPaths.map((path) => path.node)).toEqual(replacementNodes)
    expect(source.node.isConnected).toBe(false)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.elementIndex).toBe(22)
    expectNarrowMutationSignals(editor, 3)
  })

  test('polyline replacement preserves forward order at the end and reuses nodes on Redo', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = activeCollection.polyline([[0, 0], [5, 0], [5, 5]]).attr({
      id: 'polyline-source',
      name: 'Polyline source',
      opacity: 0.8,
      stroke: '#4e6c78',
      'stroke-linecap': 'square',
      'stroke-width': 1.5,
    })
    editor.elementIndex = 30
    clearMutationSignals(editor)
    const resultPolylines = [
      [[0, 0], [2, 0]],
      [[3, 0], [5, 0], [5, 5]],
    ]
    const command = new TrimPolylineCommand(editor, source, {
      resultPolylines,
      type: 'replace',
    })

    editor.execute(command)

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(editor.elementIndex).toBe(32)
    expect(childIds(activeCollection)).toEqual(['before', '30', '31'])
    expect(command.newPolylines.map((polyline) => (
      polyline.array().map(([x, y]) => [Number(x), Number(y)])
    ))).toEqual(resultPolylines)
    expect(command.newPolylines.map((polyline) => polyline.attr('stroke'))).toEqual([
      '#4e6c78',
      '#4e6c78',
    ])
    const replacementNodes = command.newPolylines.map((polyline) => polyline.node)
    expectNarrowMutationSignals(editor, 1)

    editor.history.undo()

    expect(childIds(activeCollection)).toEqual(['before', 'polyline-source'])
    expect(source.parent()).toBe(activeCollection)
    expect(command.newPolylines.every((polyline) => !polyline.node.isConnected)).toBe(true)
    expect(editor.documentState.revision).toBe(2)
    expect(editor.elementIndex).toBe(32)
    expectNarrowMutationSignals(editor, 2)

    editor.history.redo()

    expect(childIds(activeCollection)).toEqual(['before', '30', '31'])
    expect(command.newPolylines.map((polyline) => polyline.node)).toEqual(replacementNodes)
    expect(source.node.isConnected).toBe(false)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.elementIndex).toBe(32)
    expectNarrowMutationSignals(editor, 3)
  })

  test.each([
    {
      createCommand(editor, source) {
        return new TrimEllipseCommand(editor, source, {
          arcs: ellipseArcs(),
          type: 'replace',
        })
      },
      createSource(parent) {
        return parent.ellipse(12, 8).center(5, 5).attr('id', 'source')
      },
      getReplacements(command) {
        return command.arcPaths
      },
      label: 'ellipse',
    },
    {
      createCommand(editor, source) {
        return new TrimPolylineCommand(editor, source, {
          resultPolylines: [
            [[0, 0], [2, 0]],
            [[3, 0], [5, 0]],
          ],
          type: 'replace',
        })
      },
      createSource(parent) {
        return parent.polyline([[0, 0], [5, 0]]).attr('id', 'source')
      },
      getReplacements(command) {
        return command.newPolylines
      },
      label: 'polyline',
    },
  ])('$label first-apply attachment failure restores DOM, index, and History', ({
    createCommand,
    createSource,
    getReplacements,
  }) => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = createSource(activeCollection)
    activeCollection.rect(1, 1).attr('id', 'after')
    const originalMarkup = activeCollection.node.outerHTML
    editor.elementIndex = 50
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)
    clearMutationSignals(editor)
    const command = createCommand(editor, source)
    const originalInsertBefore = activeCollection.node.insertBefore.bind(activeCollection.node)
    let replacementInsertions = 0
    const failure = new Error('injected second replacement attachment failure')
    vi.spyOn(activeCollection.node, 'insertBefore').mockImplementation((node, reference) => {
      if (node !== source.node) {
        replacementInsertions += 1
        if (replacementInsertions === 2) throw failure
      }
      return originalInsertBefore(node, reference)
    })

    expect(() => editor.execute(command)).toThrow(failure)

    expect(activeCollection.node.outerHTML).toBe(originalMarkup)
    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.parent()).toBe(activeCollection)
    expect(editor.elementIndex).toBe(50)
    expect(getReplacements(command)).toEqual([])
    expect(command.hasExecutedBefore).toBe(false)
    expect(Object.hasOwn(command, 'id')).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toEqual([redoSentinel])
    expect(editor.history.idCounter).toBe(0)
    expect(editor.documentState.revision).toBe(0)
    expectNarrowMutationSignals(editor, 0)
  })
})
