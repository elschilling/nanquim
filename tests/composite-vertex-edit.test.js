// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { CompositeCommand } from '../src/js/commands/CompositeCommand.js'
import {
  buildVertexEditCommands,
  commitVertexEditUpdates,
} from '../src/js/commands/VertexEditTransaction.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function stateCommand(state, key, value, log, { fail = false } = {}) {
  return {
    execute() {
      log.push(`${key}:execute`)
      state[key] = value
      if (fail) throw new Error(`${key} failed`)
    },
    undo() {
      log.push(`${key}:undo`)
      state[key] = 0
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('composite command', () => {
  test('is one revision and reverses child order for Undo/Redo', () => {
    const { editor } = createFixture()
    const state = { first: 0, second: 0 }
    const log = []
    const composite = new CompositeCommand(editor, [
      stateCommand(state, 'first', 1, log),
      stateCommand(state, 'second', 2, log),
    ])

    editor.execute(composite)
    expect(state).toEqual({ first: 1, second: 2 })
    expect(editor.history.undos).toEqual([composite])
    expect(editor.documentState.revision).toBe(1)

    editor.history.undo()
    expect(state).toEqual({ first: 0, second: 0 })
    expect(log.slice(-2)).toEqual(['second:undo', 'first:undo'])
    expect(editor.documentState.revision).toBe(2)

    editor.history.redo()
    expect(state).toEqual({ first: 1, second: 2 })
    expect(log.slice(-2)).toEqual(['first:execute', 'second:execute'])
    expect(editor.documentState.revision).toBe(3)
  })

  test('rolls every live-preview child back when a later child partially fails', () => {
    const { editor } = createFixture()
    const state = { first: 1, second: 1, third: 1 }
    const log = []
    const composite = new CompositeCommand(editor, [
      stateCommand(state, 'first', 1, log),
      stateCommand(state, 'second', 1, log, { fail: true }),
      stateCommand(state, 'third', 1, log),
    ], { rollbackAllOnFailure: true })

    expect(() => editor.execute(composite)).toThrow('second failed')
    expect(state).toEqual({ first: 0, second: 0, third: 0 })
    expect(log).toEqual([
      'first:execute',
      'second:execute',
      'third:undo',
      'second:undo',
      'first:undo',
    ])
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rejects empty, invalid, and asynchronous child contracts before entering History', () => {
    const { editor } = createFixture()

    expect(() => editor.execute(new CompositeCommand(editor, [])))
      .toThrow('require at least one child')
    expect(() => editor.execute(new CompositeCommand(editor, [{}])))
      .toThrow('Every composite child')

    const asyncChild = {
      execute: () => Promise.resolve(),
      undo: vi.fn(),
    }
    expect(() => editor.execute(new CompositeCommand(editor, [asyncChild])))
      .toThrow('must be synchronous')
    expect(asyncChild.undo).toHaveBeenCalledOnce()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rolls back only the failed and applied children by default', () => {
    const { editor } = createFixture()
    const state = { first: 0, second: 0, untouched: 7 }
    const log = []
    const composite = new CompositeCommand(editor, [
      stateCommand(state, 'first', 1, log),
      stateCommand(state, 'second', 2, log, { fail: true }),
      stateCommand(state, 'untouched', 9, log),
    ])

    expect(() => editor.execute(composite)).toThrow('second failed')
    expect(state).toEqual({ first: 0, second: 0, untouched: 7 })
    expect(log).toEqual([
      'first:execute',
      'second:execute',
      'second:undo',
      'first:undo',
    ])
  })

  test('restores the applied state when Undo or its completion hook fails', () => {
    const { editor } = createFixture()
    const state = { first: 0, second: 0 }
    const log = []
    const first = stateCommand(state, 'first', 1, log)
    const second = stateCommand(state, 'second', 2, log)
    const composite = new CompositeCommand(editor, [first, second])
    editor.execute(composite)

    const originalUndo = first.undo
    first.undo = () => { throw new Error('undo failed') }
    expect(() => editor.history.undo()).toThrow('undo failed')
    expect(state).toEqual({ first: 1, second: 2 })
    expect(editor.history.undos).toEqual([composite])
    expect(editor.history.redos).toHaveLength(0)

    first.undo = originalUndo
    composite.onApplied = phase => {
      if (phase === 'undo') throw new Error('hook failed')
    }
    expect(() => editor.history.undo()).toThrow('hook failed')
    expect(state).toEqual({ first: 1, second: 2 })
    expect(editor.history.undos).toEqual([composite])
  })

  test('uses explicit child redo and reports rollback failures as an aggregate', () => {
    const { editor } = createFixture()
    const child = {
      execute: vi.fn(),
      redo: vi.fn(),
      undo: vi.fn(),
    }
    const composite = new CompositeCommand(editor, [child])
    editor.execute(composite)
    editor.history.undo()
    editor.history.redo()
    expect(child.execute).toHaveBeenCalledOnce()
    expect(child.redo).toHaveBeenCalledOnce()

    const broken = new CompositeCommand(editor, [{
      execute() { throw new Error('apply failed') },
      undo() { throw new Error('rollback failed') },
    }])
    expect(() => broken.execute()).toThrow(AggregateError)
    expect(() => broken.execute()).toThrow('Composite rollback also failed')
  })
})

describe('vertex edit transaction', () => {
  test('builds every supported update type in canonical transaction order', () => {
    const { editor } = createFixture()
    const element = {}
    const values = { x: 0, y: 0 }
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    const commands = buildVertexEditCommands(editor, {
      arcUpdates: [{ element, oldValues: values, newValues: values }],
      circleUpdates: [{ element, oldValues: values, newValues: values }],
      dimensionUpdates: [{ element, oldData: values, newData: values }],
      ellipseArcUpdates: [{ element, oldData: values, newData: values }],
      ellipseUpdates: [{ element, oldValues: values, newValues: values }],
      lineUpdates: [{ element, vertexIndex: 0, oldX: 0, oldY: 0, newX: 1, newY: 1 }],
      polylineUpdates: [{ element, oldPoints: [[0, 0]], newPoints: [[1, 1]] }],
      rectangleUpdates: [{ element, oldValues: values, newValues: values }],
      splineUpdates: [{ element, oldPoints: points, newPoints: points }],
      textPositionUpdates: [{ element, oldValues: values, newValues: values }],
      viewportUpdates: [{ viewport: {}, oldValues: values, newValues: values }],
    })

    expect(commands.map(command => command.type)).toEqual([
      'MultiEditVertexCommand',
      'EditDimensionCommand',
      'EditCircleCommand',
      'EditEllipseCommand',
      'EditRectangleCommand',
      'EditEllipseArcCommand',
      'EditArcCommand',
      'EditSplineCommand',
      'EditPolylineCommand',
      'EditViewportCommand',
      'EditTextPositionCommand',
    ])
    expect(commitVertexEditUpdates(editor, {})).toBeNull()
  })

  test('commits mixed SVG element updates synchronously through one execute and selection dispatch', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(0, 0, 4, 4)
    const circle = activeCollection.circle(4).center(2, 2)
    const rectangle = activeCollection.rect(3, 2).move(1, 1)

    line.plot(5, 6, 4, 4)
    circle.center(8, 9).radius(5)
    rectangle.move(10, 11).size(6, 7)
    editor.signals.updatedSelection.dispatch.mockClear()
    editor.spatialIndex.markDirty.mockClear()
    editor.fullSpatialIndex.markDirty.mockClear()
    const execute = vi.spyOn(editor, 'execute')

    const composite = commitVertexEditUpdates(editor, {
      circleUpdates: [{
        element: circle,
        oldValues: { cx: 2, cy: 2, r: 2 },
        newValues: { cx: 8, cy: 9, r: 5 },
      }],
      lineUpdates: [{
        element: line,
        vertexIndex: 0,
        oldX: 0,
        oldY: 0,
        newX: 5,
        newY: 6,
      }],
      rectangleUpdates: [{
        element: rectangle,
        oldValues: { x: 1, y: 1, width: 3, height: 2 },
        newValues: { x: 10, y: 11, width: 6, height: 7 },
      }],
    })

    expect(composite).toBeInstanceOf(CompositeCommand)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(editor.history.undos).toEqual([composite])
    expect(editor.documentState.revision).toBe(1)
    expect(editor.signals.updatedSelection.dispatch).toHaveBeenCalledTimes(1)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()

    editor.history.undo()
    expect(line.array().map(([x, y]) => [x, y])).toEqual([[0, 0], [4, 4]])
    expect({ cx: circle.cx(), cy: circle.cy(), r: circle.radius() }).toEqual({
      cx: 2,
      cy: 2,
      r: 2,
    })
    expect({
      height: rectangle.height(),
      width: rectangle.width(),
      x: rectangle.x(),
      y: rectangle.y(),
    }).toEqual({ height: 2, width: 3, x: 1, y: 1 })
    expect(editor.documentState.revision).toBe(2)

    editor.history.redo()
    expect(line.array().map(([x, y]) => [x, y])).toEqual([[5, 6], [4, 4]])
    expect({ cx: circle.cx(), cy: circle.cy(), r: circle.radius() }).toEqual({
      cx: 8,
      cy: 9,
      r: 5,
    })
    expect({
      height: rectangle.height(),
      width: rectangle.width(),
      x: rectangle.x(),
      y: rectangle.y(),
    }).toEqual({ height: 7, width: 6, x: 10, y: 11 })
    expect(editor.documentState.revision).toBe(3)
    expect(editor.signals.updatedSelection.dispatch).toHaveBeenCalledTimes(3)
  })

  test('keeps a completed grip transaction when selection notification fails', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(0, 0, 4, 4)
    line.plot(2, 3, 4, 4)
    editor.signals.updatedSelection.dispatch.mockImplementationOnce(() => {
      throw new Error('broken selection listener')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => commitVertexEditUpdates(editor, {
      lineUpdates: [{
        element: line,
        vertexIndex: 0,
        oldX: 0,
        oldY: 0,
        newX: 2,
        newY: 3,
      }],
    })).not.toThrow()

    expect(line.array().map(([x, y]) => [x, y])).toEqual([[2, 3], [4, 4]])
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
  })

  test('keeps Paper viewport geometry in the same composite history contract', () => {
    const { editor } = createFixture()
    const viewport = {
      h: 4,
      refreshGeometry: vi.fn(),
      w: 6,
      x: 1,
      y: 2,
    }
    viewport.x = 10
    viewport.y = 20
    viewport.w = 30
    viewport.h = 40
    editor.signals.updatedSelection.dispatch.mockClear()

    const composite = commitVertexEditUpdates(editor, {
      viewportUpdates: [{
        viewport,
        oldValues: { x: 1, y: 2, width: 6, height: 4 },
        newValues: { x: 10, y: 20, width: 30, height: 40 },
      }],
    })

    expect(editor.history.undos).toEqual([composite])
    expect(viewport).toMatchObject({ x: 10, y: 20, w: 30, h: 40 })
    expect(editor.signals.paperViewportsChanged.dispatch).toHaveBeenCalledTimes(1)
    expect(editor.signals.updatedSelection.dispatch).toHaveBeenCalledTimes(1)

    editor.history.undo()
    expect(viewport).toMatchObject({ x: 1, y: 2, w: 6, h: 4 })
    editor.history.redo()
    expect(viewport).toMatchObject({ x: 10, y: 20, w: 30, h: 40 })
    expect(editor.documentState.revision).toBe(3)
  })
})
