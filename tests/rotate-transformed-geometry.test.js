// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { moveCommand } from '../src/js/commands/MoveCommand.js'
import { rotateCommand } from '../src/js/commands/RotateCommand.js'
import { DocumentState } from '../src/js/document/DocumentState.js'
import {
  captureTransformPreviewState,
  restoreTransformPreviewState,
} from '../src/js/Viewport.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const TRANSFORMED_ROTATE_DIAGNOSTIC = 'ROTATE could not resolve the selected geometry transform.'
const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const fixtures = []

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function matrixValues(matrix) {
  const { a, b, c, d, e, f } = matrix
  return { a, b, c, d, e, f }
}

function multiplyMatrices(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function elementMatrixToDrawing(element, drawing) {
  const chain = []
  let current = element

  while (current && current !== drawing) {
    chain.push(matrixValues(current.matrixify()))
    current = current.parent()
  }

  if (current !== drawing) throw new Error('Element is not inside the drawing root')
  return chain.reverse().reduce(multiplyMatrices, IDENTITY_MATRIX)
}

function localPoints(element) {
  if (element.type === 'rect') {
    const x = Number(element.x())
    const y = Number(element.y())
    const width = Number(element.width())
    const height = Number(element.height())
    return [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ]
  }

  return element.array().map(([x, y]) => [Number(x), Number(y)])
}

function applyMatrix(point, matrix) {
  return [
    matrix.a * point[0] + matrix.c * point[1] + matrix.e,
    matrix.b * point[0] + matrix.d * point[1] + matrix.f,
  ]
}

function drawingPoints(element, drawing) {
  const matrix = elementMatrixToDrawing(element, drawing)
  return localPoints(element).map(point => applyMatrix(point, matrix))
}

function rotatePoints(points, center, angle) {
  const radians = angle * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return points.map(([x, y]) => {
    const dx = x - center.x
    const dy = y - center.y
    return [
      center.x + dx * cos - dy * sin,
      center.y + dx * sin + dy * cos,
    ]
  })
}

function expectPointsClose(actual, expected) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach(([x, y], index) => {
    expect(x).toBeCloseTo(expected[index][0], 8)
    expect(y).toBeCloseTo(expected[index][1], 8)
  })
}

function terminalMessages(editor) {
  return editor.signals.terminalLogged.dispatch.mock.calls
    .map(([entry]) => String(entry?.msg || ''))
}

function childIds(parent) {
  return parent.children().map(element => element.attr('id'))
}

function installProductionSelectionCleanup(editor) {
  editor.signals.clearSelection.add(() => {
    editor.selected.forEach((element) => {
      element.removeClass('elementHover')
      element.removeClass('elementSelected')
      element.attr('selected', false)
    })
  })
}

function commitRotation(editor, element, { angle, center }) {
  editor.selected = [element]
  rotateCommand(editor)
  editor.signals.pointCaptured.dispatch(center)
  editor.distance = angle
  editor.signals.inputValue.dispatch(String(angle))
  vi.runOnlyPendingTimers()
}

function expectCommittedRotation(editor) {
  expect(terminalMessages(editor)).not.toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
  expect(editor.history.undos).toHaveLength(1)
  expect(editor.history.redos).toHaveLength(0)
  expect(editor.documentState.revision).toBe(1)
  expect(editor.spatialIndex.markDirty).toHaveBeenCalledOnce()
  expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledOnce()
  expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
  expect(editor.signals.inputValue.getNumListeners()).toBe(0)
  expect(editor.signals.commandCancelled.getNumListeners()).toBe(0)
  expect(editor.isInteracting).toBe(false)
  expect(editor.suppressHandlers).toBe(false)
  expect(editor.selectSingleElement).toBe(false)
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

describe('ROTATE transformed geometry', () => {
  test('ghost transform snapshots restore exact transform presence and syntax', () => {
    const { activeCollection } = createFixture()
    const rectangle = activeCollection.rect(4, 2).move(11, 6)

    const absentSnapshot = captureTransformPreviewState(rectangle)
    rectangle.transform(absentSnapshot.matrix).translate(3, 4)
    expect(rectangle.node.hasAttribute('transform')).toBe(true)
    restoreTransformPreviewState(rectangle, absentSnapshot)
    expect(rectangle.node.hasAttribute('transform')).toBe(false)

    const originalTransform = 'translate(7 4) rotate(12 1 2)'
    rectangle.attr('transform', originalTransform)
    const authoredSnapshot = captureTransformPreviewState(rectangle)
    rectangle.rotate(30, 0, 0)
    restoreTransformPreviewState(rectangle, authoredSnapshot)
    expect(rectangle.attr('transform')).toBe(originalTransform)
  })

  test('rotates a moved rectangle carrying an explicit identity transform and round-trips it', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.line(-2, 0, -1, 0).attr('id', 'identity-before')
    const rectangle = activeCollection.rect(4, 2).move(11, 6).attr({
      id: 'identity-rectangle',
      name: 'Moved room',
      'data-zone': 'A',
    })
    activeCollection.line(20, 0, 21, 0).attr('id', 'identity-after')

    // Older Viewport move-ghost cleanup serialized an absent transform as an
    // identity matrix, so existing sessions can still contain this harmless form.
    rectangle.transform(rectangle.transform())
    expect(rectangle.node.hasAttribute('transform')).toBe(true)
    expect(matrixValues(rectangle.matrixify())).toEqual(IDENTITY_MATRIX)

    const center = { x: 0, y: 0 }
    const angle = 90
    const originalNode = rectangle.node
    const originalMarkup = rectangle.node.outerHTML
    const originalLocalPoints = localPoints(rectangle)
    const originalDrawingPoints = drawingPoints(rectangle, editor.drawing)
    const expectedDrawingPoints = rotatePoints(originalDrawingPoints, center, angle)
    const originalOrder = childIds(activeCollection)

    commitRotation(editor, rectangle, { angle, center })

    const rotated = activeCollection.findOne('[id="identity-rectangle"]')
    expectCommittedRotation(editor)
    expect(rotated.type).toBe('rect')
    expect(rotated.node).toBe(originalNode)
    expect(localPoints(rotated)).toEqual(originalLocalPoints)
    expectPointsClose(drawingPoints(rotated, editor.drawing), expectedDrawingPoints)
    expect(rotated.attr()).toMatchObject({ name: 'Moved room', 'data-zone': 'A' })
    expect(childIds(activeCollection)).toEqual(originalOrder)
    const rotatedMarkup = rotated.node.outerHTML

    editor.history.undo()
    const restored = activeCollection.findOne('[id="identity-rectangle"]')
    expect(restored.type).toBe('rect')
    expect(restored.node).toBe(originalNode)
    expect(restored.node.outerHTML).toBe(originalMarkup)
    expect(localPoints(restored)).toEqual(originalLocalPoints)
    expectPointsClose(drawingPoints(restored, editor.drawing), originalDrawingPoints)
    expect(childIds(activeCollection)).toEqual(originalOrder)
    expect(editor.documentState.revision).toBe(2)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)

    editor.history.redo()
    const redone = activeCollection.findOne('[id="identity-rectangle"]')
    expect(redone.type).toBe('rect')
    expect(redone.node).toBe(originalNode)
    expect(redone.node.outerHTML).toBe(rotatedMarkup)
    expect(localPoints(redone)).toEqual(originalLocalPoints)
    expectPointsClose(drawingPoints(redone, editor.drawing), expectedDrawingPoints)
    expect(childIds(activeCollection)).toEqual(originalOrder)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('moves then rotates a rectangle through the command and ghost-cleanup signal path', () => {
    const { activeCollection, editor } = createFixture()
    const rectangle = activeCollection.rect(4, 2).move(1, 1).attr('id', 'move-rotate')
    installProductionSelectionCleanup(editor)
    const previewSnapshots = new Map()
    editor.signals.moveGhostingStarted.add((elements) => {
      elements.forEach((element) => {
        const snapshot = captureTransformPreviewState(element)
        previewSnapshots.set(element, snapshot)
        element.transform(snapshot.matrix).translate(2, 3)
      })
    })
    editor.signals.moveGhostingStopped.add(() => {
      previewSnapshots.forEach((snapshot, element) => {
        restoreTransformPreviewState(element, snapshot)
      })
      previewSnapshots.clear()
    })

    editor.selected = [rectangle]
    moveCommand(editor)
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    editor.signals.pointCaptured.dispatch({ x: 10, y: 5 })

    expect({ x: Number(rectangle.x()), y: Number(rectangle.y()) }).toEqual({ x: 11, y: 6 })
    expect(rectangle.node.hasAttribute('transform')).toBe(false)
    expect(editor.history.undos).toHaveLength(1)

    const movedDrawingPoints = drawingPoints(rectangle, editor.drawing)
    const expectedDrawingPoints = rotatePoints(movedDrawingPoints, { x: 0, y: 0 }, 90)
    rectangle.addClass('elementHover elementSelected').attr('selected', true)
    editor.selected = [rectangle]
    rotateCommand(editor)
    editor.signals.pointCaptured.dispatch({ x: 0, y: 0 })
    editor.signals.inputValue.dispatch('90')
    vi.runOnlyPendingTimers()

    const rotated = activeCollection.findOne('[id="move-rotate"]')
    expect(rotated.type).toBe('polygon')
    expect(rotated.hasClass('elementHover')).toBe(false)
    expect(rotated.hasClass('elementSelected')).toBe(false)
    expect(rotated.node.hasAttribute('selected')).toBe(false)
    expectPointsClose(drawingPoints(rotated, editor.drawing), expectedDrawingPoints)
    expect(editor.history.undos).toHaveLength(2)
    expect(editor.documentState.revision).toBe(2)

    editor.history.undo()
    const restored = activeCollection.findOne('[id="move-rotate"]')
    expect(restored.type).toBe('rect')
    expect(restored.node).toBe(rectangle.node)
    expect(restored.node.hasAttribute('transform')).toBe(false)
    expect(restored.hasClass('elementHover')).toBe(false)
    expect(restored.hasClass('elementSelected')).toBe(false)
    expect(restored.node.hasAttribute('selected')).toBe(false)
    expect({ x: Number(restored.x()), y: Number(restored.y()) }).toEqual({ x: 11, y: 6 })

    editor.history.undo()
    expect({ x: Number(rectangle.x()), y: Number(rectangle.y()) }).toEqual({ x: 1, y: 1 })
  })

  test('keeps the angle prompt armed after blank input and accepts a typed retry', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(1, 0, 3, 0)
    editor.selected = [line]

    rotateCommand(editor)
    editor.inputCoord = { x: 0, y: 0 }
    editor.inputCoordMode = 'absolute'
    editor.signals.coordinateInput.dispatch()
    editor.signals.inputValue.dispatch('')

    expect(editor.history.undos).toHaveLength(0)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(1)
    expect(editor.signals.inputValue.getNumListeners()).toBe(1)
    expect(terminalMessages(editor)).toContain('Enter a valid rotation angle.')

    editor.signals.inputValue.dispatch('90')
    vi.runOnlyPendingTimers()

    expectPointsClose(localPoints(line), [[0, 1], [0, 3]])
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.inputValue.getNumListeners()).toBe(0)
    expect(editor.signals.coordinateInput.getNumListeners()).toBe(0)
  })

  test('composes rotation onto a transformed primitive without rewriting local geometry or metadata', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(1, 2, 5, -1).attr({
      id: 'transformed-line',
      name: 'Survey axis',
      transform: 'matrix(1.2 0.3 -0.2 0.8 7 -4)',
      'data-role': 'datum',
    })
    const metadata = {
      arcData: {
        p1: { x: 1, y: 2 },
        p2: { x: 3, y: 0.5 },
        p3: { x: 5, y: -1 },
      },
      circleTrimData: {
        ccw: true,
        cx: 3,
        cy: 0.5,
        endPt: { x: 5, y: -1 },
        r: 2.5,
        startPt: { x: 1, y: 2 },
      },
      splineData: {
        degree: 2,
        points: [{ x: 1, y: 2 }, { x: 3, y: 0.5 }, { x: 5, y: -1 }],
      },
    }
    Object.entries(metadata).forEach(([key, value]) => line.data(key, value))

    const center = { x: 3, y: -2 }
    const angle = -37
    const originalNode = line.node
    const originalMarkup = line.node.outerHTML
    const originalTransform = line.attr('transform')
    const originalLocalPoints = localPoints(line)
    const originalDrawingPoints = drawingPoints(line, editor.drawing)
    const expectedDrawingPoints = rotatePoints(originalDrawingPoints, center, angle)

    commitRotation(editor, line, { angle, center })

    expectCommittedRotation(editor)
    expect(line.node).toBe(originalNode)
    expect(line.attr('transform')).not.toBe(originalTransform)
    expect(localPoints(line)).toEqual(originalLocalPoints)
    expectPointsClose(drawingPoints(line, editor.drawing), expectedDrawingPoints)
    Object.entries(metadata).forEach(([key, value]) => {
      expect(line.data(key)).toEqual(value)
    })
    expect(line.attr()).toMatchObject({ name: 'Survey axis', 'data-role': 'datum' })
    const rotatedMarkup = line.node.outerHTML

    editor.history.undo()
    expect(line.node.outerHTML).toBe(originalMarkup)
    expect(localPoints(line)).toEqual(originalLocalPoints)
    Object.entries(metadata).forEach(([key, value]) => {
      expect(line.data(key)).toEqual(value)
    })

    editor.history.redo()
    expect(line.node.outerHTML).toBe(rotatedMarkup)
    expect(localPoints(line)).toEqual(originalLocalPoints)
    expectPointsClose(drawingPoints(line, editor.drawing), expectedDrawingPoints)
    Object.entries(metadata).forEach(([key, value]) => {
      expect(line.data(key)).toEqual(value)
    })
  })

  test('rotates child endpoints in drawing space through a non-uniform transformed ancestor', () => {
    const { activeCollection, editor } = createFixture()
    const parent = activeCollection.group().attr({
      id: 'nonuniform-parent',
      name: 'Survey frame',
      transform: 'matrix(2 0.5 0.25 0.75 20 -10)',
      'data-group': 'true',
    })
    parent.line(-2, 0, -1, 0).attr('id', 'ancestor-before')
    const line = parent.line(1, 2, 5, -1).attr({
      id: 'ancestor-line',
      name: 'Local member',
      'data-member': 'M1',
    })
    parent.line(8, 0, 9, 0).attr('id', 'ancestor-after')
    const arcData = {
      p1: { x: 1, y: 2 },
      p2: { x: 3, y: 0.5 },
      p3: { x: 5, y: -1 },
    }
    line.data('arcData', arcData)

    const center = { x: 4, y: 6 }
    const angle = 73
    const parentNode = parent.node
    const parentTransform = parent.attr('transform')
    const originalLineNode = line.node
    const originalLineMarkup = line.node.outerHTML
    const originalLocalPoints = localPoints(line)
    const originalDrawingPoints = drawingPoints(line, editor.drawing)
    const expectedDrawingPoints = rotatePoints(originalDrawingPoints, center, angle)
    const originalOrder = childIds(parent)
    const redoSentinel = { execute: vi.fn(), undo: vi.fn() }
    editor.history.redos.push(redoSentinel)

    commitRotation(editor, line, { angle, center })

    expectCommittedRotation(editor)
    expect(line.node).toBe(originalLineNode)
    expect(line.parent()).toBe(parent)
    expect(parent.node).toBe(parentNode)
    expect(parent.attr('transform')).toBe(parentTransform)
    expect(childIds(parent)).toEqual(originalOrder)
    expect(localPoints(line)).toEqual(originalLocalPoints)
    expect(line.data('arcData')).toEqual(arcData)
    expect(line.attr()).toMatchObject({ name: 'Local member', 'data-member': 'M1' })
    expectPointsClose(drawingPoints(line, editor.drawing), expectedDrawingPoints)
    const rotationCommand = editor.history.undos[0]
    const rotatedLineMarkup = line.node.outerHTML

    editor.history.undo()
    expect(line.node).toBe(originalLineNode)
    expect(line.node.outerHTML).toBe(originalLineMarkup)
    expect(parent.attr('transform')).toBe(parentTransform)
    expect(childIds(parent)).toEqual(originalOrder)
    expect(localPoints(line)).toEqual(originalLocalPoints)
    expect(line.data('arcData')).toEqual(arcData)
    expectPointsClose(drawingPoints(line, editor.drawing), originalDrawingPoints)
    expect(editor.history.redos).toEqual([rotationCommand])
    expect(editor.history.redos).not.toContain(redoSentinel)
    expect(editor.documentState.revision).toBe(2)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)

    editor.history.redo()
    expect(line.node).toBe(originalLineNode)
    expect(line.node.outerHTML).toBe(rotatedLineMarkup)
    expect(parent.attr('transform')).toBe(parentTransform)
    expect(childIds(parent)).toEqual(originalOrder)
    expect(localPoints(line)).toEqual(originalLocalPoints)
    expect(line.data('arcData')).toEqual(arcData)
    expectPointsClose(drawingPoints(line, editor.drawing), expectedDrawingPoints)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(3)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(3)
  })

  test('rotates only the outermost root when a group and its child are both selected', () => {
    const { activeCollection, editor } = createFixture()
    installProductionSelectionCleanup(editor)
    const group = activeCollection.group().attr({
      id: 'selected-group',
      transform: 'translate(10 5)',
    })
    const line = group.line(1, 2, 5, 2).attr({
      id: 'selected-child',
      name: 'Nested member',
    })
    const center = { x: 3, y: 4 }
    const angle = 41
    const originalDrawingPoints = drawingPoints(line, editor.drawing)
    const expectedDrawingPoints = rotatePoints(originalDrawingPoints, center, angle)
    const originalChildMarkup = line.node.outerHTML
    group.addClass('elementHover elementSelected').attr('selected', true)
    line.addClass('elementHover elementSelected').attr('selected', true)

    editor.selected = [line, group]
    rotateCommand(editor)
    editor.signals.pointCaptured.dispatch(center)
    editor.distance = angle
    editor.signals.inputValue.dispatch(String(angle))
    vi.runOnlyPendingTimers()

    expectCommittedRotation(editor)
    expect(line.node.outerHTML).toBe(originalChildMarkup)
    expectPointsClose(drawingPoints(line, editor.drawing), expectedDrawingPoints)
    expect(group.hasClass('elementHover')).toBe(false)
    expect(group.hasClass('elementSelected')).toBe(false)
    expect(group.node.hasAttribute('selected')).toBe(false)
    expect(line.hasClass('elementHover')).toBe(false)
    expect(line.hasClass('elementSelected')).toBe(false)
    expect(line.node.hasAttribute('selected')).toBe(false)

    editor.history.undo()
    expect(line.node.outerHTML).toBe(originalChildMarkup)
    expectPointsClose(drawingPoints(line, editor.drawing), originalDrawingPoints)

    editor.history.redo()
    expect(line.node.outerHTML).toBe(originalChildMarkup)
    expectPointsClose(drawingPoints(line, editor.drawing), expectedDrawingPoints)
  })

  test('rejects non-invertible transformed ancestry before point capture or History', () => {
    const { activeCollection, editor } = createFixture()
    const parent = activeCollection.group().attr('transform', 'matrix(0 0 0 1 10 5)')
    const line = parent.line(1, 2, 5, 2)
    const originalMarkup = editor.drawing.node.outerHTML
    editor.selected = [line]

    rotateCommand(editor)
    vi.runOnlyPendingTimers()

    expect(terminalMessages(editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(editor.drawing.node.outerHTML).toBe(originalMarkup)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.inputValue.getNumListeners()).toBe(0)
    expect(editor.signals.commandCancelled.getNumListeners()).toBe(0)
    expect(editor.isInteracting).toBe(false)
    expect(editor.suppressHandlers).toBe(false)
  })

  test('rejects a selected CSS transform even when an identity SVG transform is present', () => {
    const { activeCollection, editor } = createFixture()
    const style = document.createElement('style')
    style.textContent = '.css-transformed-rotate { transform: translate(5px, 3px) }'
    document.head.appendChild(style)
    const line = activeCollection.line(1, 2, 5, 2)
      .attr('transform', 'matrix(1 0 0 1 0 0)')
      .addClass('css-transformed-rotate')
    const originalMarkup = editor.drawing.node.outerHTML
    editor.selected = [line]

    rotateCommand(editor)
    vi.runOnlyPendingTimers()

    expect(terminalMessages(editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(editor.drawing.node.outerHTML).toBe(originalMarkup)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    style.remove()
  })

  test('accepts browser-rounded computed matrices for an authored SVG rotation', () => {
    const { activeCollection, editor } = createFixture()
    const line = activeCollection.line(1, 2, 5, 2).attr('transform', 'rotate(37)')
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
      if (node !== line.node) return originalGetComputedStyle(node)
      return {
        getPropertyValue: property => property === 'transform'
          ? 'matrix(0.798636, 0.601815, -0.601815, 0.798636, 0, 0)'
          : '',
        transform: 'matrix(0.798636, 0.601815, -0.601815, 0.798636, 0, 0)',
      }
    })

    commitRotation(editor, line, { angle: 15, center: { x: 0, y: 0 } })

    expectCommittedRotation(editor)
    expect(terminalMessages(editor)).not.toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
  })

  test('rejects inline CSS and non-2D computed transforms without mutating geometry', () => {
    const first = createFixture()
    const inline = first.activeCollection.line(1, 2, 5, 2)
      .attr('transform', 'matrix(1 0 0 1 0 0)')
      .css('transform', 'none')
    const inlineMarkup = first.editor.drawing.node.outerHTML
    first.editor.selected = [inline]

    rotateCommand(first.editor)
    vi.runOnlyPendingTimers()

    expect(terminalMessages(first.editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(first.editor.drawing.node.outerHTML).toBe(inlineMarkup)
    expect(first.editor.history.undos).toHaveLength(0)

    const second = createFixture()
    const non2d = second.activeCollection.line(1, 2, 5, 2)
      .attr('transform', 'rotate(37)')
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
      if (node !== non2d.node) return originalGetComputedStyle(node)
      const transform = 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 3, 0, 1)'
      return { getPropertyValue: () => transform, transform }
    })
    const non2dMarkup = second.editor.drawing.node.outerHTML
    second.editor.selected = [non2d]

    rotateCommand(second.editor)
    vi.runOnlyPendingTimers()

    expect(terminalMessages(second.editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(second.editor.drawing.node.outerHTML).toBe(non2dMarkup)
    expect(second.editor.history.undos).toHaveLength(0)

    const third = createFixture()
    const malformed = third.activeCollection.line(1, 2, 5, 2)
      .attr('transform', 'rotate(37)')
    vi.mocked(window.getComputedStyle).mockImplementation((node) => {
      if (node !== malformed.node) return originalGetComputedStyle(node)
      const transform = 'matrix(1, 0)'
      return { getPropertyValue: () => transform, transform }
    })
    third.editor.selected = [malformed]

    rotateCommand(third.editor)
    vi.runOnlyPendingTimers()

    expect(terminalMessages(third.editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(third.editor.history.undos).toHaveLength(0)
  })

  test.each([
    { active: false, rejected: false },
    { active: true, rejected: true },
    { active: null, rejected: true },
  ])('respects an $active media query around an authored CSS transform', ({ active, rejected }) => {
    const { activeCollection, editor } = createFixture()
    const originalMatchMedia = window.matchMedia
    window.matchMedia = active === null ? undefined : vi.fn(() => ({ matches: active }))
    const style = document.createElement('style')
    style.textContent = '@media (min-width: 999999px) { .media-css-rotate { transform: none } }'
    document.head.appendChild(style)
    const group = activeCollection.group().addClass('media-css-rotate')
    group.line(1, 2, 5, 2)
    editor.selected = [group]

    commitRotation(editor, group, { angle: 20, center: { x: 0, y: 0 } })
    const messages = terminalMessages(editor)
    window.matchMedia = originalMatchMedia
    style.remove()

    if (rejected) {
      expect(messages).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
      expect(editor.history.undos).toHaveLength(0)
      expect(editor.documentState.revision).toBe(0)
    } else {
      expectCommittedRotation(editor)
      expect(messages).not.toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    }
  })

  test('rejects a selected transform-driven group under an active CSS transform:none rule', () => {
    const { activeCollection, editor } = createFixture()
    const style = document.createElement('style')
    style.textContent = '.css-none-rotate { transform: none }'
    document.head.appendChild(style)
    const group = activeCollection.group().addClass('css-none-rotate')
    group.line(1, 2, 5, 2)
    const originalMarkup = editor.drawing.node.outerHTML
    editor.selected = [group]

    rotateCommand(editor)
    vi.runOnlyPendingTimers()

    expect(terminalMessages(editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(editor.drawing.node.outerHTML).toBe(originalMarkup)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    style.remove()
  })

  test('keeps real observed document state clean during transformed preflight and rejection', () => {
    const { activeCollection, editor } = createFixture()
    const transformed = activeCollection.line(1, 2, 5, 2).attr('transform', 'rotate(37)')
    const style = document.createElement('style')
    style.textContent = '.observed-css-rotate { transform: translate(5px, 3px) }'
    document.head.appendChild(style)
    const cssTransformed = activeCollection.line(2, 3, 6, 3)
      .attr('transform', 'matrix(1 0 0 1 0 0)')
      .addClass('observed-css-rotate')
    const state = new DocumentState(editor)
    editor.documentState = state

    editor.selected = [transformed]
    rotateCommand(editor)
    expect(state.flushObservedMutations()).toBe(false)
    expect(state.revision).toBe(0)
    editor.signals.commandCancelled.dispatch()
    vi.runOnlyPendingTimers()
    expect(state.flushObservedMutations()).toBe(false)
    expect(state.revision).toBe(0)

    editor.selected = [cssTransformed]
    rotateCommand(editor)
    vi.runOnlyPendingTimers()
    expect(terminalMessages(editor)).toContain(TRANSFORMED_ROTATE_DIAGNOSTIC)
    expect(state.flushObservedMutations()).toBe(false)
    expect(state.revision).toBe(0)

    state.disconnect()
    style.remove()
  })
})
