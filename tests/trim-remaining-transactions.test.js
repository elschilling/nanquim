// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { TrimArcCommand } from '../src/js/commands/TrimArcCommand.js'
import { TrimCircleCommand } from '../src/js/commands/TrimCircleCommand.js'
import { TrimCommand } from '../src/js/commands/TrimCommand.js'
import { TrimLineCommand } from '../src/js/commands/TrimLineCommand.js'
import { TrimRectCommand } from '../src/js/commands/TrimRectCommand.js'
import { TrimSplineCommand } from '../src/js/commands/TrimSplineCommand.js'
import { catmullRomToBezierPath } from '../src/js/commands/DrawSplineCommand.js'
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

function linePoints(line) {
  return line.array().map(([x, y]) => [Number(x), Number(y)])
}

function decorateSource(element, id = 'source') {
  element.attr({
    class: 'semantic-class elementHover elementSelected',
    id,
    name: 'Semantic source',
    opacity: 0.65,
    stroke: '#8b5a5a',
    'stroke-linecap': 'round',
    'stroke-width': 2,
    'data-part': 'A',
    'data-style-overrides': 'stroke',
  })
  element.node.style.strokeDasharray = '3 2'
  return element
}

function expectSemanticReplacement(element) {
  expect(element.attr('name')).toBe('Semantic source')
  expect(element.attr('stroke')).toBe('#8b5a5a')
  expect(element.attr('stroke-width')).toBe(2)
  expect(element.attr('data-part')).toBe('A')
  expect(element.attr('data-style-overrides')).toBe('stroke')
  expect(element.hasClass('semantic-class')).toBe(true)
  expect(element.hasClass('elementHover')).toBe(false)
  expect(element.hasClass('elementSelected')).toBe(false)
  expect(element.node.style.strokeDasharray).toBe('3 2')
  expect(element.attr('data-nanquim-transient')).toBeUndefined()
}

function clearMutationSpies(editor) {
  editor.spatialIndex.markDirty.mockClear()
  editor.fullSpatialIndex.markDirty.mockClear()
  editor.signals.updatedOutliner.dispatch.mockClear()
  editor.signals.updatedProperties.dispatch.mockClear()
  editor.signals.updatedSelection.dispatch.mockClear()
}

function expectNarrowMutation(editor, count) {
  expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(count)
  expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(count)
  expect(editor.signals.updatedOutliner.dispatch).toHaveBeenCalledTimes(count)
  expect(editor.signals.updatedProperties.dispatch).not.toHaveBeenCalled()
  expect(editor.signals.updatedSelection.dispatch).not.toHaveBeenCalled()
}

function pointOnCircle(angle, radius = 10) {
  return {
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
  }
}

function retainedArc(startAngle, endAngle, ccw = true) {
  let span = ccw ? endAngle - startAngle : startAngle - endAngle
  if (span < 0) span += 2 * Math.PI
  const midAngle = ccw ? startAngle + span / 2 : startAngle - span / 2
  return {
    ccw,
    cx: 0,
    cy: 0,
    endPt: pointOnCircle(endAngle),
    midPt: pointOnCircle(midAngle),
    r: 10,
    startPt: pointOnCircle(startAngle),
    theta1: endAngle,
    theta2: startAngle,
  }
}

function twoArcAction() {
  return {
    arcs: [
      retainedArc(0, Math.PI / 2),
      retainedArc(3 * Math.PI / 2, Math.PI, false),
    ],
    type: 'arcs',
  }
}

function rectangleTrimData(action) {
  return {
    action,
    closestLineIndex: 0,
    lines: [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 10, y2: 8 },
      { x1: 10, y1: 8, x2: 0, y2: 8 },
      { x1: 0, y1: 8, x2: 0, y2: 0 },
    ],
    type: 'rect',
  }
}

function splineAction() {
  return {
    splines: [
      [{ x: 0, y: 0 }, { x: 3, y: 4 }],
      [{ x: 9, y: 2 }, { x: 12, y: 6 }],
    ],
    type: 'splines',
  }
}

function createArcSource(parent) {
  const source = decorateSource(parent.path('M 10 0 A 10 10 0 1 1 -10 0'))
  source.attr('fill', 'none')
  source.data('arcData', {
    p1: pointOnCircle(0),
    p2: pointOnCircle(Math.PI / 2),
    p3: pointOnCircle(Math.PI),
  })
  return source
}

function createCircleSource(parent) {
  return decorateSource(parent.circle(20).center(0, 0))
}

function createSplineSource(parent) {
  const points = [
    { x: 0, y: 0 },
    { x: 4, y: 6 },
    { x: 8, y: 0 },
    { x: 12, y: 6 },
  ]
  const source = decorateSource(parent.path(catmullRomToBezierPath(points)))
  source.attr('fill', 'none')
  source.data('splineData', { points })
  return source
}

function seedRedo(editor) {
  const sentinel = { execute: vi.fn(), undo: vi.fn() }
  editor.history.redos.push(sentinel)
  return sentinel
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('remaining Trim replacement transactions', () => {
  test.each([
    {
      action: { type: 'remove' },
      afterIds: ['before', 'after'],
      expectedIndex: 20,
      expectedPoints: null,
      label: 'remove',
    },
    {
      action: { keep: 'start', newX: 4, newY: 0, type: 'shorten' },
      afterIds: ['before', 'source', 'after'],
      expectedIndex: 20,
      expectedPoints: [[0, 0], [4, 0]],
      label: 'shorten start',
    },
    {
      action: { keep: 'end', newX: 6, newY: 0, type: 'shorten' },
      afterIds: ['before', 'source', 'after'],
      expectedIndex: 20,
      expectedPoints: [[6, 0], [10, 0]],
      label: 'shorten end',
    },
    {
      action: { splitX1: 3, splitX2: 7, splitY1: 0, splitY2: 0, type: 'split' },
      afterIds: ['before', 'source', '20', 'after'],
      expectedIndex: 21,
      expectedPoints: [[0, 0], [3, 0]],
      label: 'split',
      newPoints: [[7, 0], [10, 0]],
    },
  ])('line $label is one normalized History edit', ({
    action,
    afterIds,
    expectedIndex,
    expectedPoints,
    newPoints,
  }) => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = decorateSource(activeCollection.line(0, 0, 10, 0))
    activeCollection.rect(1, 1).attr('id', 'after')
    const sourceMarkup = source.node.outerHTML
    editor.elementIndex = 20
    clearMutationSpies(editor)
    const command = new TrimLineCommand(editor, source, action)

    editor.execute(command)

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect(editor.elementIndex).toBe(expectedIndex)
    expect(childIds(activeCollection)).toEqual(afterIds)
    if (expectedPoints) expect(linePoints(source)).toEqual(expectedPoints)
    if (newPoints) {
      expect(linePoints(command.newLine)).toEqual(newPoints)
      expectSemanticReplacement(command.newLine)
    }
    const replacementNode = command.newLine?.node
    expectNarrowMutation(editor, 1)

    editor.history.undo()

    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.node.outerHTML).toBe(sourceMarkup)
    expect(linePoints(source)).toEqual([[0, 0], [10, 0]])
    expect(editor.elementIndex).toBe(expectedIndex)
    expectNarrowMutation(editor, 2)

    editor.history.redo()

    expect(childIds(activeCollection)).toEqual(afterIds)
    if (expectedPoints) expect(linePoints(source)).toEqual(expectedPoints)
    if (replacementNode) expect(command.newLine.node).toBe(replacementNode)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.elementIndex).toBe(expectedIndex)
    expectNarrowMutation(editor, 3)
  })

  test('arc replacements preserve path semantics, order, IDs, and identity', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = createArcSource(activeCollection)
    activeCollection.rect(1, 1).attr('id', 'after')
    const sourceMarkup = source.node.outerHTML
    editor.elementIndex = 30
    clearMutationSpies(editor)
    const command = new TrimArcCommand(editor, source, twoArcAction())

    editor.execute(command)

    expect(childIds(activeCollection)).toEqual(['before', '30', '31', 'after'])
    expect(editor.elementIndex).toBe(32)
    command.arcPaths.forEach((path, index) => {
      expect(path.data('arcData')).toEqual({
        p1: twoArcAction().arcs[index].startPt,
        p2: twoArcAction().arcs[index].midPt,
        p3: twoArcAction().arcs[index].endPt,
      })
      const pathTokens = path.attr('d').trim().split(/\s+/)
      expect(Number(pathTokens[8])).toBe(twoArcAction().arcs[index].ccw ? 1 : 0)
      expectSemanticReplacement(path)
    })
    const nodes = command.arcPaths.map((path) => path.node)
    expectNarrowMutation(editor, 1)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.node.outerHTML).toBe(sourceMarkup)

    editor.history.redo()
    expect(command.arcPaths.map((path) => path.node)).toEqual(nodes)
    expect(childIds(activeCollection)).toEqual(['before', '30', '31', 'after'])
    expect(editor.elementIndex).toBe(32)
    expectNarrowMutation(editor, 3)
  })

  test('circle replacements retain analytic circle and three-point arc metadata', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = createCircleSource(activeCollection)
    activeCollection.rect(1, 1).attr('id', 'after')
    const sourceMarkup = source.node.outerHTML
    const action = twoArcAction()
    editor.elementIndex = 40
    clearMutationSpies(editor)
    const command = new TrimCircleCommand(editor, source, action)

    editor.execute(command)

    expect(childIds(activeCollection)).toEqual(['before', '40', '41', 'after'])
    expect(editor.elementIndex).toBe(42)
    command.arcPaths.forEach((path, index) => {
      expect(path.data('circleTrimData')).toEqual(action.arcs[index])
      expect(path.data('arcData')).toMatchObject({
        p1: action.arcs[index].startPt,
        p3: action.arcs[index].endPt,
      })
      const pathTokens = path.attr('d').trim().split(/\s+/)
      expect(Number(pathTokens[8])).toBe(action.arcs[index].ccw ? 1 : 0)
      expect(path.attr('fill')).toBe('none')
      expectSemanticReplacement(path)
    })
    const nodes = command.arcPaths.map((path) => path.node)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.node.outerHTML).toBe(sourceMarkup)

    editor.history.redo()
    expect(command.arcPaths.map((path) => path.node)).toEqual(nodes)
    expect(childIds(activeCollection)).toEqual(['before', '40', '41', 'after'])
    expect(editor.elementIndex).toBe(42)
    expectNarrowMutation(editor, 3)
  })

  test.each([
    {
      action: { type: 'remove' },
      expectedCount: 3,
      expectedPoints: [
        [[10, 0], [10, 8]],
        [[10, 8], [0, 8]],
        [[0, 8], [0, 0]],
      ],
      label: 'remove edge',
    },
    {
      action: { keep: 'start', newX: 4, newY: 0, type: 'shorten' },
      expectedCount: 4,
      expectedPoints: [
        [[0, 0], [4, 0]],
        [[10, 0], [10, 8]],
        [[10, 8], [0, 8]],
        [[0, 8], [0, 0]],
      ],
      label: 'shorten edge',
    },
    {
      action: { splitX1: 3, splitX2: 7, splitY1: 0, splitY2: 0, type: 'split' },
      expectedCount: 5,
      expectedPoints: [
        [[0, 0], [3, 0]],
        [[7, 0], [10, 0]],
        [[10, 0], [10, 8]],
        [[10, 8], [0, 8]],
        [[0, 8], [0, 0]],
      ],
      label: 'split edge',
    },
  ])('rectangle $label creates perimeter-ordered line identities', ({
    action,
    expectedCount,
    expectedPoints,
  }) => {
    const { activeCollection, editor } = createFixture()
    activeCollection.circle(1).attr('id', 'before')
    const source = decorateSource(activeCollection.rect(10, 8).move(0, 0))
    activeCollection.circle(1).attr('id', 'after')
    const sourceMarkup = source.node.outerHTML
    editor.elementIndex = 50
    clearMutationSpies(editor)
    const command = new TrimRectCommand(editor, source, rectangleTrimData(action))

    editor.execute(command)

    expect(command.replacementLines).toHaveLength(expectedCount)
    expect(childIds(activeCollection)).toEqual([
      'before',
      ...Array.from({ length: expectedCount }, (_value, index) => String(50 + index)),
      'after',
    ])
    expect(command.replacementLines.map(linePoints)).toEqual(expectedPoints)
    command.replacementLines.forEach(expectSemanticReplacement)
    const nodes = command.replacementLines.map((line) => line.node)
    expect(editor.elementIndex).toBe(50 + expectedCount)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.node.outerHTML).toBe(sourceMarkup)

    editor.history.redo()
    expect(command.replacementLines.map((line) => line.node)).toEqual(nodes)
    expect(command.replacementLines.map(linePoints)).toEqual(expectedPoints)
    expect(editor.elementIndex).toBe(50 + expectedCount)
    expectNarrowMutation(editor, 3)
  })

  test('spline replacements deep-copy editable points and round-trip stable nodes', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = createSplineSource(activeCollection)
    activeCollection.rect(1, 1).attr('id', 'after')
    const sourceMarkup = source.node.outerHTML
    const action = splineAction()
    editor.elementIndex = 60
    clearMutationSpies(editor)
    const command = new TrimSplineCommand(editor, source, action)

    editor.execute(command)

    expect(childIds(activeCollection)).toEqual(['before', '60', '61', 'after'])
    expect(editor.elementIndex).toBe(62)
    expect(command.newSplines.map((spline) => spline.data('splineData').points))
      .toEqual(action.splines)
    command.newSplines.forEach(expectSemanticReplacement)
    const nodes = command.newSplines.map((spline) => spline.node)

    action.splines[0][0].x = 999
    expect(command.newSplines[0].data('splineData').points[0].x).toBe(0)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.node.outerHTML).toBe(sourceMarkup)

    editor.history.redo()
    expect(command.newSplines.map((spline) => spline.node)).toEqual(nodes)
    expect(childIds(activeCollection)).toEqual(['before', '60', '61', 'after'])
    expect(editor.elementIndex).toBe(62)
    expectNarrowMutation(editor, 3)
  })

  test.each([
    ['arc', (editor, source) => new TrimArcCommand(editor, source, { type: 'remove' }), createArcSource, (command) => command.arcPaths],
    ['circle', (editor, source) => new TrimCircleCommand(editor, source, { type: 'remove' }), createCircleSource, (command) => command.arcPaths],
    ['spline', (editor, source) => new TrimSplineCommand(editor, source, { type: 'remove' }), createSplineSource, (command) => command.newSplines],
  ])('%s remove action detaches and restores the exact source without allocating IDs', (
    _label,
    createCommand,
    createSource,
    replacements,
  ) => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = createSource(activeCollection)
    activeCollection.rect(1, 1).attr('id', 'after')
    const sourceMarkup = source.node.outerHTML
    editor.elementIndex = 70
    clearMutationSpies(editor)
    const command = createCommand(editor, source)

    editor.execute(command)
    expect(childIds(activeCollection)).toEqual(['before', 'after'])
    expect(replacements(command)).toEqual([])
    expect(editor.elementIndex).toBe(70)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(['before', 'source', 'after'])
    expect(source.node.outerHTML).toBe(sourceMarkup)

    editor.history.redo()
    expect(childIds(activeCollection)).toEqual(['before', 'after'])
    expect(editor.elementIndex).toBe(70)
    expectNarrowMutation(editor, 3)
  })

  test.each([
    {
      createCommand(editor, source) {
        return new TrimArcCommand(editor, source, twoArcAction())
      },
      createSource: createArcSource,
      getReplacements(command) {
        return command.arcPaths
      },
      label: 'arc',
    },
    {
      createCommand(editor, source) {
        return new TrimCircleCommand(editor, source, twoArcAction())
      },
      createSource: createCircleSource,
      getReplacements(command) {
        return command.arcPaths
      },
      label: 'circle',
    },
    {
      createCommand(editor, source) {
        return new TrimRectCommand(editor, source, rectangleTrimData({
          splitX1: 3,
          splitX2: 7,
          splitY1: 0,
          splitY2: 0,
          type: 'split',
        }))
      },
      createSource(parent) {
        return decorateSource(parent.rect(10, 8).move(0, 0))
      },
      getReplacements(command) {
        return command.replacementLines
      },
      label: 'rectangle',
    },
    {
      createCommand(editor, source) {
        return new TrimSplineCommand(editor, source, splineAction())
      },
      createSource: createSplineSource,
      getReplacements(command) {
        return command.newSplines
      },
      label: 'spline',
    },
  ])('$label second-replacement attachment failure restores DOM, IDs, and History', ({
    createCommand,
    createSource,
    getReplacements,
  }) => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = createSource(activeCollection)
    activeCollection.rect(1, 1).attr('id', 'after')
    const originalMarkup = activeCollection.node.outerHTML
    const redoSentinel = seedRedo(editor)
    editor.elementIndex = 80
    clearMutationSpies(editor)
    const command = createCommand(editor, source)
    const originalInsertBefore = activeCollection.node.insertBefore.bind(activeCollection.node)
    let replacementInsertions = 0
    const failure = new Error('injected partial Trim replacement failure')
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
    expect(editor.elementIndex).toBe(80)
    expect(getReplacements(command)).toEqual([])
    expect(command.hasExecutedBefore).toBe(false)
    expect(Object.hasOwn(command, 'id')).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toEqual([redoSentinel])
    expect(editor.history.idCounter).toBe(0)
    expect(editor.documentState.revision).toBe(0)
    expectNarrowMutation(editor, 0)
  })

  test('line split attachment failure restores original geometry, ID counter, and redo stack', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.rect(1, 1).attr('id', 'before')
    const source = decorateSource(activeCollection.line(0, 0, 10, 0))
    activeCollection.rect(1, 1).attr('id', 'after')
    const originalMarkup = activeCollection.node.outerHTML
    const redoSentinel = seedRedo(editor)
    editor.elementIndex = 90
    clearMutationSpies(editor)
    const command = new TrimLineCommand(editor, source, {
      splitX1: 3,
      splitX2: 7,
      splitY1: 0,
      splitY2: 0,
      type: 'split',
    })
    const failure = new Error('injected line split attachment failure')
    vi.spyOn(activeCollection.node, 'insertBefore').mockImplementation(() => {
      throw failure
    })

    expect(() => editor.execute(command)).toThrow(failure)

    expect(activeCollection.node.outerHTML).toBe(originalMarkup)
    expect(linePoints(source)).toEqual([[0, 0], [10, 0]])
    expect(command.newLine).toBeNull()
    expect(command.hasExecutedBefore).toBe(false)
    expect(editor.elementIndex).toBe(90)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toEqual([redoSentinel])
    expect(editor.documentState.revision).toBe(0)
    expectNarrowMutation(editor, 0)
  })

  test('Trim orchestration passes the normalized spline action into History', () => {
    const { activeCollection, editor } = createFixture()
    const source = createSplineSource(activeCollection)
    const action = splineAction()
    editor.lastClick = { x: 3, y: 4 }
    const trim = new TrimCommand(editor)
    vi.spyOn(trim, 'calculateTrim').mockReturnValue({
      action,
      preview: null,
      type: 'spline',
    })

    trim.onLineClicked(source)

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.undos[0]).toBeInstanceOf(TrimSplineCommand)
    expect(editor.history.undos[0].action).toBe(action)
    expect(editor.history.undos[0].newSplines).toHaveLength(2)
  })
})
