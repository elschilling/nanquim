// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { commitVertexEditUpdates } from '../src/js/commands/VertexEditTransaction.js'
import {
  captureVertexPreviewState,
  restoreVertexPreviewState,
} from '../src/js/Viewport.js'
import {
  constrainVertexPointInRoot,
  elementLocalPointToRoot,
  getVertexLocalAnchor,
  rootPointToElementLocal,
} from '../src/js/utils/vertexCoordinateSpace.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []

function createFixture(options) {
  const fixture = createDeterministicEditorFixture(options)
  fixtures.push(fixture)
  return fixture
}

const rootScreenMatrix = {
  a: 2,
  b: 0,
  c: 0,
  d: 2,
  e: 100,
  f: 50,
}

// root * translate(10, 20) * rotate(90deg)
const nestedElementScreenMatrix = {
  a: 0,
  b: 2,
  c: -2,
  d: 0,
  e: 120,
  f: 90,
}

function transformedSpace(element = {}) {
  return {
    activeSvg: { screenCTM: () => rootScreenMatrix },
    element: {
      screenCTM: () => nestedElementScreenMatrix,
      ...element,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('transformed vertex grip coordinates', () => {
  test('round-trips root points through a nested transformed element', () => {
    const { activeSvg, element } = transformedSpace()
    const localPoint = { x: 3, y: 4 }

    const rootPoint = elementLocalPointToRoot(localPoint, element, activeSvg)
    expect(rootPoint).toEqual({ x: 6, y: 23 })
    expect(rootPointToElementLocal(rootPoint, element, activeSvg)).toEqual(localPoint)
  })

  test('constrains ortho in visible root space before mapping each local edit', () => {
    const { activeSvg, element } = transformedSpace({ type: 'line' })
    const vertex = {
      element,
      originalPosition: { x: 0, y: 0 },
      vertexIndex: 0,
    }

    // Local (0, 0) is root (10, 20). The cursor is predominantly vertical
    // in root space, even though that direction is horizontal in local space.
    const constrained = constrainVertexPointInRoot({ x: 14, y: 30 }, vertex, activeSvg)
    expect(constrained).toEqual({ x: 10, y: 30 })
    expect(rootPointToElementLocal(constrained, element, activeSvg)).toEqual({ x: 10, y: 0 })
  })

  test('keeps Paper viewport grips in the Paper root coordinate system', () => {
    const { activeSvg, element } = transformedSpace({
      _paperVp: {},
      type: 'rect',
    })
    const point = { x: 31, y: 42 }

    expect(rootPointToElementLocal(point, element, activeSvg)).toEqual(point)
    expect(elementLocalPointToRoot(point, element, activeSvg)).toEqual(point)

    const constrained = constrainVertexPointInRoot(point, {
      element,
      originalPosition: { x: 1, y: 2, width: 10, height: 5 },
      vertexIndex: 0,
    }, activeSvg)
    expect(constrained).toEqual({ x: 1, y: 42 })
  })

  test('derives local anchors for every supported grip family', () => {
    const dataElement = (type, values = {}) => ({
      type,
      attr: name => values[name],
      data: name => values[name],
    })
    const cases = [
      [{ element: { type: 'circle' }, originalPosition: { cx: 2, cy: 3, r: 4 }, vertexIndex: 2 }, { x: 6, y: 3 }],
      [{ element: { type: 'rect' }, originalPosition: { x: 1, y: 2, width: 8, height: 4 }, vertexIndex: 6 }, { x: 5, y: 6 }],
      [{ element: { type: 'ellipse' }, originalPosition: { cx: 7, cy: 9 }, vertexIndex: 3 }, { x: 7, y: 9 }],
      [{ element: dataElement('path', { ellipseArcData: {} }), originalPosition: { cx: 4, cy: 5 }, vertexIndex: 0 }, { x: 4, y: 5 }],
      [{ element: dataElement('path', { arcData: {} }), originalPosition: { p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 }, p3: { x: 5, y: 6 } }, vertexIndex: 1 }, { x: 3, y: 4 }],
      [{ element: dataElement('path', { splineData: {} }), originalPosition: { points: [{ x: 2, y: 8 }] }, vertexIndex: 0 }, { x: 2, y: 8 }],
      [{ element: { type: 'polyline' }, originalPosition: { points: [[11, 12]] }, vertexIndex: 0 }, { x: 11, y: 12 }],
      [{ element: { type: 'text' }, originalPosition: { x: 13, y: 14 }, vertexIndex: 0 }, { x: 13, y: 14 }],
      [{ element: dataElement('g', { 'data-element-type': 'dimension' }), originalPosition: { p1: { x: 15, y: 16 } }, vertexIndex: 0 }, { x: 15, y: 16 }],
      [{ element: dataElement('g', { 'data-element-type': 'dimension', 'data-dim-text-center': '{"x":17,"y":18}' }), originalPosition: {}, vertexIndex: 3 }, { x: 17, y: 18 }],
    ]

    cases.forEach(([vertex, expected]) => {
      expect(getVertexLocalAnchor(vertex)).toEqual(expected)
    })

    expect(getVertexLocalAnchor({ element: null, originalPosition: null, vertexIndex: 0 })).toBeNull()
    expect(getVertexLocalAnchor({
      element: dataElement('path', { ellipseArcData: {} }),
      originalPosition: { cx: 1, cy: 2 },
      vertexIndex: 2,
    })).toBeNull()
    expect(getVertexLocalAnchor({
      element: dataElement('g', {
        'data-element-type': 'dimension',
        'data-dim-text-center': 'invalid-json',
      }),
      originalPosition: {},
      vertexIndex: 3,
    })).toBeNull()
    expect(getVertexLocalAnchor({ element: { type: 'unknown' }, originalPosition: {}, vertexIndex: 0 })).toBeNull()
  })

  test('falls back safely when coordinate matrices are absent, throwing, or singular', () => {
    const point = { x: 3, y: 4 }
    const missing = { screenCTM: () => null }
    const throwing = { screenCTM: () => { throw new Error('detached') } }
    const singular = { screenCTM: () => ({ a: 0, b: 0, c: 0, d: 0, e: 9, f: 9 }) }
    const root = { screenCTM: () => rootScreenMatrix }

    expect(rootPointToElementLocal(point, missing, root)).toEqual(point)
    expect(elementLocalPointToRoot(point, throwing, root)).toEqual(point)
    expect(rootPointToElementLocal(point, singular, root)).toEqual(point)
    expect(constrainVertexPointInRoot(point, {
      element: { type: 'unknown' },
      originalPosition: {},
      vertexIndex: 0,
    }, root)).toEqual(point)
  })

  test('commits a transformed text grip as one local-space History edit', () => {
    const { activeCollection, editor } = createFixture()
    const text = activeCollection.text('Nanquim').attr({ x: 0, y: 0 })
    vi.spyOn(editor.svg, 'screenCTM').mockReturnValue(rootScreenMatrix)
    vi.spyOn(text, 'screenCTM').mockReturnValue(nestedElementScreenMatrix)

    const localPoint = rootPointToElementLocal({ x: 6, y: 23 }, text, editor.svg)
    expect(localPoint).toEqual({ x: 3, y: 4 })

    // Live preview and first History apply use the same local target.
    text.attr(localPoint)
    const command = commitVertexEditUpdates(editor, {
      textPositionUpdates: [{
        element: text,
        oldValues: { x: 0, y: 0 },
        newValues: localPoint,
      }],
    })

    expect(editor.history.undos).toEqual([command])
    expect(editor.documentState.revision).toBe(1)
    expect({ x: Number(text.attr('x')), y: Number(text.attr('y')) }).toEqual(localPoint)

    editor.history.undo()
    expect({ x: Number(text.attr('x')), y: Number(text.attr('y')) }).toEqual({ x: 0, y: 0 })
    editor.history.redo()
    expect({ x: Number(text.attr('x')), y: Number(text.attr('y')) }).toEqual(localPoint)
    expect(editor.documentState.revision).toBe(3)
  })

  test('cancellation restores exact SVG and Paper previews without History or dirty state', () => {
    const { activeCollection, editor } = createFixture({ mode: 'paper' })
    const text = activeCollection.text('Original').attr({
      'data-editor-note': 'kept',
      x: 2,
      y: 3,
    })
    const textSnapshot = captureVertexPreviewState(text)
    text.attr({ 'data-editor-note': 'preview', x: 20, y: 30 }).text('Preview')

    const viewport = {
      _editor: editor,
      h: 6,
      refreshGeometry: vi.fn(),
      w: 5,
      x: 1,
      y: 2,
    }
    const paperSnapshot = captureVertexPreviewState({ _paperVp: viewport })
    Object.assign(viewport, { h: 60, w: 50, x: 10, y: 20 })

    editor.documentState.runWithoutTracking(() => {
      restoreVertexPreviewState(textSnapshot)
      restoreVertexPreviewState(paperSnapshot)
    })

    expect(text.attr('data-editor-note')).toBe('kept')
    expect({ x: Number(text.attr('x')), y: Number(text.attr('y')) }).toEqual({ x: 2, y: 3 })
    expect(text.text()).toBe('Original')
    expect(viewport).toMatchObject({ h: 6, w: 5, x: 1, y: 2 })
    expect(viewport.refreshGeometry).toHaveBeenCalledOnce()
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.isDirty).toBe(false)
    expect(editor.documentState.revision).toBe(0)
  })

  test('rolls every local preview back when a mixed grip commit fails', () => {
    const { activeCollection, editor } = createFixture()
    const first = activeCollection.text('First').attr({ x: 0, y: 0 })
    const second = activeCollection.text('Second').attr({ x: 10, y: 10 })
    first.attr({ x: 3, y: 4 })
    second.attr({ x: 13, y: 14 })

    const originalAttr = second.attr.bind(second)
    let failFirstApply = true
    vi.spyOn(second, 'attr').mockImplementation((name, value) => {
      if (name === 'x' && Number(value) === 13 && failFirstApply) {
        failFirstApply = false
        throw new Error('injected transformed text failure')
      }
      return originalAttr(name, value)
    })

    expect(() => commitVertexEditUpdates(editor, {
      textPositionUpdates: [
        {
          element: first,
          oldValues: { x: 0, y: 0 },
          newValues: { x: 3, y: 4 },
        },
        {
          element: second,
          oldValues: { x: 10, y: 10 },
          newValues: { x: 13, y: 14 },
        },
      ],
    })).toThrow('injected transformed text failure')

    expect({ x: Number(first.attr('x')), y: Number(first.attr('y')) }).toEqual({ x: 0, y: 0 })
    expect({ x: Number(second.attr('x')), y: Number(second.attr('y')) }).toEqual({ x: 10, y: 10 })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })
})
