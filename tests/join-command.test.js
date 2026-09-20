// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  JoinElementsCommand,
  joinCommand,
  planJoinChain,
} from '../src/js/commands/JoinCommand.js'
import { resolveRegisteredCommand } from '../src/js/commands/_commands.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function points(element) {
  return element.array().map(([x, y]) => [Number(x), Number(y)])
}

function childIds(parent) {
  return parent.children().map(element => String(element.attr('id')))
}

function press(key, code = key) {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    key,
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('JOIN command', () => {
  test('resolves the J alias', () => {
    expect(resolveRegisteredCommand('J')?.name).toBe('JOIN')
  })

  test('joins unordered and reversed lines/polylines while preserving ownership, style, and History', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.circle(1).center(-2, 0).attr('id', 'before')
    const first = activeCollection.line(0, 0, 5, 0).attr({
      id: 'first',
      name: 'First segment',
      stroke: '#12ab34',
      'stroke-width': 0.75,
      'data-member': 'wall-a',
    })
    const second = activeCollection.line(10, 0, 5, 0).attr({ id: 'second', stroke: '#ff0000' })
    const third = activeCollection.polyline([[15, 3], [12, 3], [10, 0]]).attr({ id: 'third' })
    activeCollection.circle(1).center(18, 3).attr('id', 'after')
    const originalOrder = childIds(activeCollection)
    editor.selected = [third, second, first]

    joinCommand(editor)

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.history.undos[0].type).toBe('JoinElementsCommand')
    expect(editor.documentState.revision).toBe(1)
    const joined = editor.selected[0]
    expect(joined.type).toBe('polyline')
    expect(joined.parent().node).toBe(activeCollection.node)
    expect(points(joined)).toEqual([[0, 0], [5, 0], [10, 0], [12, 3], [15, 3]])
    expect(joined.attr()).toMatchObject({
      'data-member': 'wall-a',
      fill: 'none',
      stroke: '#12ab34',
      'stroke-width': 0.75,
    })
    expect(joined.attr('name')).toMatch(/^Joined Polyline /)
    expect(first.node.isConnected).toBe(false)
    expect(second.node.isConnected).toBe(false)
    expect(third.node.isConnected).toBe(false)
    expect(childIds(activeCollection)).toEqual(['before', String(joined.attr('id')), 'after'])
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(1)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(1)

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(originalOrder)
    expect(editor.selected).toEqual([third, second, first])
    expect(joined.node.isConnected).toBe(false)
    expect(editor.documentState.revision).toBe(2)

    editor.history.redo()
    expect(editor.selected).toEqual([joined])
    expect(joined.node.isConnected).toBe(true)
    expect(points(joined)).toEqual([[0, 0], [5, 0], [10, 0], [12, 3], [15, 3]])
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('joins every open drawing curve type into one exact path', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.circle(1).center(-2, 0).attr('id', 'before')
    const line = activeCollection.line(0, 0, 10, 0).attr({
      id: 'line',
      stroke: '#12ab34',
      'data-member': 'mixed-curve',
    })
    const polyline = activeCollection.polyline([[10, 0], [15, 0], [20, 5]]).attr('id', 'polyline')
    const arc = activeCollection.path('M 20 5 A 5 5 0 0 1 25 10').attr('id', 'arc')
    arc.data('arcData', {
      p1: { x: 20, y: 5 },
      p2: { x: 23.5, y: 6.5 },
      p3: { x: 25, y: 10 },
    })
    const ellipseArc = activeCollection.path('M 25 10 A 6 3 0 0 1 31 13').attr('id', 'ellipse-arc')
    ellipseArc.data('ellipseArcData', {
      ccw: true,
      cx: 25,
      cy: 13,
      endPt: { x: 31, y: 13 },
      rx: 6,
      ry: 3,
      startPt: { x: 25, y: 10 },
      theta1: -Math.PI / 2,
      theta2: 0,
    })
    const spline = activeCollection.path('M 40 13 C 37 13 34 13 31 13').attr('id', 'spline')
    spline.data('splineData', {
      points: [{ x: 40, y: 13 }, { x: 35, y: 13 }, { x: 31, y: 13 }],
    })
    const genericPath = activeCollection.path('M 40 13 Q 45 18 50 13').attr('id', 'generic')
    activeCollection.circle(1).center(52, 13).attr('id', 'after')
    const originalOrder = childIds(activeCollection)
    const messages = []
    editor.signals.terminalLogged.add(entry => messages.push(String(entry?.msg || '')))
    editor.selected = [genericPath, spline, arc, line, ellipseArc, polyline]

    joinCommand(editor)

    expect(messages.filter(message => message.startsWith('JOIN failed:'))).toEqual([])
    expect(editor.history.undos).toHaveLength(1)
    const joined = editor.selected[0]
    expect(joined.type).toBe('path')
    expect(joined.array().map(segment => [...segment])).toEqual([
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 15, 0],
      ['L', 20, 5],
      ['A', 5, 5, 0, 0, 1, 25, 10],
      ['A', 6, 3, 0, 0, 1, 31, 13],
      ['C', 34, 13, 37, 13, 40, 13],
      ['Q', 45, 18, 50, 13],
    ])
    expect(joined.attr()).toMatchObject({
      'data-member': 'mixed-curve',
      fill: 'none',
      stroke: '#12ab34',
    })
    expect(joined.attr('name')).toMatch(/^Joined Path /)
    expect(joined.data('arcData')).toBeUndefined()
    expect(joined.data('ellipseArcData')).toBeUndefined()
    expect(joined.data('splineData')).toBeUndefined()
    expect(childIds(activeCollection)).toEqual(['before', String(joined.attr('id')), 'after'])

    editor.history.undo()
    expect(childIds(activeCollection)).toEqual(originalOrder)
    expect(editor.selected).toEqual([genericPath, spline, arc, line, ellipseArc, polyline])

    editor.history.redo()
    expect(editor.selected).toEqual([joined])
    expect(joined.node.isConnected).toBe(true)
  })

  test('expands and reverses smooth path commands without changing their curves', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const path = activeCollection.path(
      'M 30 0 C 28 0 26 2 24 2 S 20 0 18 0 Q 16 -2 14 0 T 10 0'
    )
    editor.selected = [path, line]

    joinCommand(editor)

    expect(editor.selected[0].array().map(segment => [...segment])).toEqual([
      ['M', 0, 0],
      ['L', 10, 0],
      ['Q', 12, 2, 14, 0],
      ['Q', 16, -2, 18, 0],
      ['C', 20, 0, 22, 2, 24, 2],
      ['C', 26, 2, 28, 0, 30, 0],
    ])
  })

  test('removes source-only curve metadata while retaining the leading curve style', () => {
    const { activeCollection, editor } = createFixture()
    const arc = activeCollection.path('M 0 0 A 10 10 30 1 0 10 0').attr({ stroke: '#abcdef' })
    arc.data('arcData', {
      p1: { x: 0, y: 0 },
      p2: { x: 5, y: -8 },
      p3: { x: 10, y: 0 },
    })
    const line = activeCollection.line(10, 0, 20, 10)
    editor.selected = [line, arc]

    joinCommand(editor)

    const joined = editor.selected[0]
    expect(joined.array().map(segment => [...segment])).toEqual([
      ['M', 0, 0],
      ['A', 10, 10, 30, 1, 0, 10, 0],
      ['L', 20, 10],
    ])
    expect(joined.attr('stroke')).toBe('#abcdef')
    expect(joined.data('arcData')).toBeUndefined()
  })

  test('toggles the sweep flag when an arc is reversed', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(0, 0, 10, 0)
    const arc = activeCollection.path('M 20 10 A 10 10 30 1 0 10 0')
    editor.selected = [arc, line]

    joinCommand(editor)

    expect(editor.selected[0].array().map(segment => [...segment])).toEqual([
      ['M', 0, 0],
      ['L', 10, 0],
      ['A', 10, 10, 30, 1, 1, 20, 10],
    ])
  })

  test('closes a joined curve loop with an exact path close command', () => {
    const { activeCollection, editor } = createFixture()
    const upper = activeCollection.path('M 0 0 A 5 5 0 0 1 10 0')
    const lower = activeCollection.path('M 10 0 A 5 5 0 0 1 0 0')
    editor.selected = [lower, upper]

    joinCommand(editor)

    const commands = editor.selected[0].array().map(segment => [...segment])
    expect(commands.at(-1)).toEqual(['Z'])
    expect(editor.selected[0].type).toBe('path')
  })

  test('waits for an interactive selection and joins it on Enter', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.line(0, 0, 4, 0)
    const second = activeCollection.line(4, 0, 7, 2)

    const session = joinCommand(editor)
    expect(session.sessionActive).toBe(true)
    expect(editor.isInteracting).toBe(true)
    expect(editor.suppressHandlers).toBe(true)

    editor.signals.toogledSelect.dispatch(first)
    editor.signals.toogledSelect.dispatch(second)
    expect(editor.selected).toEqual([first, second])
    press('Enter', 'Enter')

    expect(editor.history.undos).toHaveLength(1)
    expect(editor.selected[0].type).toBe('polyline')
    expect(points(editor.selected[0])).toEqual([[0, 0], [4, 0], [7, 2]])
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
    expect(session.sessionActive).toBe(false)
  })

  test('builds a closed polyline from a non-branching loop', () => {
    const { activeCollection } = createFixture()
    const bottom = activeCollection.line(0, 0, 10, 0)
    const right = activeCollection.line(10, 10, 10, 0)
    const top = activeCollection.line(0, 10, 10, 10)
    const left = activeCollection.line(0, 0, 0, 10)

    const plan = planJoinChain([top, bottom, left, right])

    expect(plan.valid).toBe(true)
    expect(plan.closed).toBe(true)
    expect(plan.points).toHaveLength(5)
    expect(plan.points.at(-1)).toEqual(plan.points[0])
  })

  test('bounds the selected chain before geometry traversal', () => {
    expect(planJoinChain(Array.from({ length: 1001 }))).toEqual({
      valid: false,
      reason: 'JOIN supports at most 1000 elements at a time.',
    })
  })

  test('bounds total curve commands before chain traversal', () => {
    const { activeCollection } = createFixture()
    const commands = [
      ['M', 0, 0],
      ...Array.from({ length: 10000 }, (_, index) => ['L', index + 1, 0]),
    ]
    const path = activeCollection.path(commands)
    const line = activeCollection.line(10000, 0, 10001, 0)

    expect(planJoinChain([path, line])).toEqual({
      valid: false,
      reason: 'JOIN supports at most 10000 curve segments at a time.',
    })
  })

  test.each([
    {
      expected: 'JOIN supports connected open lines, polylines, arcs, elliptical arcs, splines, and SVG paths.',
      prepare(parent) {
        return [parent.line(0, 0, 5, 0), parent.circle(2).center(5, 0)]
      },
      title: 'unsupported geometry',
    },
    {
      expected: 'JOIN requires finite, non-degenerate open curve geometry.',
      prepare(parent) {
        return [parent.line(0, 0, 5, 0), parent.path('M 5 0 L 10 0 Z')]
      },
      title: 'a closed source path',
    },
    {
      expected: 'JOIN requires finite, non-degenerate open curve geometry.',
      prepare(parent) {
        return [parent.line(0, 0, 5, 0), parent.path('M 5 0 L 10 0 M 10 0 L 15 0')]
      },
      title: 'a multi-subpath source',
    },
    {
      expected: 'JOIN requires one connected, non-branching chain.',
      prepare(parent) {
        return [parent.line(0, 0, 5, 0), parent.line(10, 0, 15, 0)]
      },
      title: 'a disconnected selection',
    },
    {
      expected: 'JOIN requires one connected, non-branching chain.',
      prepare(parent) {
        return [
          parent.line(-5, 0, 0, 0),
          parent.line(0, 0, 5, 0),
          parent.line(0, 0, 0, 5),
        ]
      },
      title: 'a branched selection',
    },
    {
      expected: 'JOIN does not support transformed elements or ancestors.',
      prepare(parent) {
        return [parent.line(0, 0, 5, 0), parent.line(5, 0, 10, 0).translate(1, 0)]
      },
      title: 'transformed geometry',
    },
    {
      expected: 'JOIN cannot modify locked or generated geometry.',
      prepare(parent) {
        return [parent.line(0, 0, 5, 0), parent.line(5, 0, 10, 0).attr('data-gn-derived', 'true')]
      },
      title: 'generated geometry',
    },
  ])('rejects $title without mutation', ({ expected, prepare }) => {
    const { activeCollection, editor } = createFixture()
    const messages = []
    editor.signals.terminalLogged.add(entry => messages.push(String(entry?.msg || '')))
    const elements = prepare(activeCollection)
    const originalMarkup = activeCollection.node.innerHTML
    editor.selected = elements

    joinCommand(editor)

    expect(messages).toContain(expected)
    expect(activeCollection.node.innerHTML).toBe(originalMarkup)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rejects elements with different parents', () => {
    const { activeCollection, editor } = createFixture()
    const firstParent = activeCollection.group()
    const secondParent = activeCollection.group()
    const first = firstParent.line(0, 0, 5, 0)
    const second = secondParent.line(5, 0, 10, 0)
    const command = new JoinElementsCommand(editor, [first, second])

    expect(command.isValid).toBe(false)
    expect(command.validationMessage).toBe('JOIN requires all selected elements to share the same parent.')
  })

  test('restores the exact boundary if applying the replacement fails', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.circle(1).attr('id', 'before')
    const first = activeCollection.line(0, 0, 5, 0).attr('id', 'first')
    const second = activeCollection.line(5, 0, 10, 0).attr('id', 'second')
    activeCollection.circle(1).attr('id', 'after')
    editor.selected = [first, second]
    const command = new JoinElementsCommand(editor)
    const originalNodes = [...activeCollection.node.children]
    const initialElementIndex = editor.elementIndex
    const replaceChildren = activeCollection.node.replaceChildren.bind(activeCollection.node)
    let shouldFail = true
    vi.spyOn(activeCollection.node, 'replaceChildren').mockImplementation((...nodes) => {
      if (shouldFail && nodes.some(node => node.tagName?.toLowerCase() === 'polyline')) {
        shouldFail = false
        replaceChildren(nodes[0])
        throw new Error('synthetic JOIN replacement failure')
      }
      return replaceChildren(...nodes)
    })

    expect(() => editor.execute(command)).toThrow('synthetic JOIN replacement failure')
    expect([...activeCollection.node.children]).toEqual(originalNodes)
    expect(editor.selected).toEqual([first, second])
    expect(editor.elementIndex).toBe(initialElementIndex)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })
})
