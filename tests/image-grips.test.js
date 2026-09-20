// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { EditImageCommand } from '../src/js/commands/EditImageCommand.js'
import { commitVertexEditUpdates } from '../src/js/commands/VertexEditTransaction.js'
import { getImageGripPoints, imageBoundsFromGrip, readImageGripBounds } from '../src/js/utils/imageGrips.js'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../src/js/utils/svgNumericBounds.js'
import {
  elementLocalPointToRoot,
  rootPointToElementLocal,
} from '../src/js/utils/vertexCoordinateSpace.js'
import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

const fixtures = []
const originalBounds = { x: 10, y: 20, width: 80, height: 40 }

function createFixture() {
  const fixture = createDeterministicEditorFixture()
  fixtures.push(fixture)
  return fixture
}

function boundsOf(element) {
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, element.attr(key)]))
}

function exposeImageLengths(element, values) {
  Object.entries(values).forEach(([name, value]) => {
    Object.defineProperty(element.node, name, {
      configurable: true,
      value: { baseVal: { value } },
    })
  })
  return element
}

function semanticAttributes(element) {
  return Object.fromEntries(Array.from(element.node.attributes)
    .filter(attribute => !['x', 'y', 'width', 'height'].includes(attribute.name))
    .map(attribute => [attribute.name, attribute.value]))
}

afterEach(() => {
  vi.restoreAllMocks()
  while (fixtures.length > 0) fixtures.pop().dispose()
  document.body.replaceChildren()
})

describe('image grip geometry', () => {
  test('reads resolved SVG lengths while preserving their exact original attributes', () => {
    const { activeCollection } = createFixture()
    const attributes = { x: '1in', y: '10%', width: '2.54cm', height: '40px' }
    const image = exposeImageLengths(activeCollection.image().attr(attributes), {
      x: 96, y: 20, width: 96, height: 40,
    })
    expect(readImageGripBounds(image)).toEqual({
      x: 96, y: 20, width: 96, height: 40, attributes,
    })
    expect(getImageGripPoints(readImageGripBounds(image))[2]).toEqual({ x: 192, y: 60, index: 2 })
  })

  test('falls back to numeric attributes when native lengths are missing, invalid, or unavailable', () => {
    const { activeCollection } = createFixture()
    const image = exposeImageLengths(activeCollection.image().attr(originalBounds), { width: NaN })
    Object.defineProperty(image.node, 'height', {
      configurable: true,
      get() { throw new Error('detached length') },
    })
    expect(readImageGripBounds(image)).toEqual({
      ...originalBounds,
      attributes: { x: '10', y: '20', width: '80', height: '40' },
    })
  })

  test('exposes four proportional corners, four crop sides, and one center translation grip', () => {
    expect(getImageGripPoints(originalBounds)).toEqual([
      { x: 10, y: 20, index: 0 },
      { x: 90, y: 20, index: 1 },
      { x: 90, y: 60, index: 2 },
      { x: 10, y: 60, index: 3 },
      { x: 50, y: 20, index: 4 },
      { x: 90, y: 40, index: 5 },
      { x: 50, y: 60, index: 6 },
      { x: 10, y: 40, index: 7 },
      { x: 50, y: 40, index: 8 },
    ])
  })

  test.each([
    [0, { x: -70, y: -20 }, { x: -70, y: -20, width: 160, height: 80 }],
    [1, { x: 170, y: -20 }, { x: 10, y: -20, width: 160, height: 80 }],
    [2, { x: 170, y: 100 }, { x: 10, y: 20, width: 160, height: 80 }],
    [3, { x: -70, y: 100 }, { x: -70, y: 20, width: 160, height: 80 }],
  ])('resizes corner %i proportionally around its opposite corner', (index, point, expected) => {
    const original = Object.freeze({ ...originalBounds })
    expect(imageBoundsFromGrip(original, index, Object.freeze(point))).toEqual(expected)
    expect(original).toEqual(originalBounds)
  })

  test('projects off-diagonal targets and supports portrait proportions', () => {
    expect(imageBoundsFromGrip(originalBounds, 2, { x: 110, y: 60 }))
      .toEqual({ x: 10, y: 20, width: 96, height: 48 })
    expect(imageBoundsFromGrip({ x: 0, y: 0, width: 20, height: 80 }, 2, { x: 40, y: 160 }))
      .toEqual({ x: 0, y: 0, width: 40, height: 160 })
  })

  test.each([0, 1, 2, 3])('clamps crossing corner %i without mirroring or losing its fixed anchor', index => {
    const opposite = (index + 2) % 4
    const anchor = getImageGripPoints(originalBounds)[opposite]
    const dragged = getImageGripPoints(originalBounds)[index]
    const next = imageBoundsFromGrip(originalBounds, index, {
      x: anchor.x * 2 - dragged.x,
      y: anchor.y * 2 - dragged.y,
    })
    expect(next.width).toBeGreaterThan(0)
    expect(next.height).toBeGreaterThan(0)
    expect(next.width).toBeLessThan(0.001)
    expect(next.width / next.height).toBeCloseTo(2)
    const nextAnchor = getImageGripPoints(next)[opposite]
    expect(nextAnchor.x).toBeCloseTo(anchor.x)
    expect(nextAnchor.y).toBeCloseTo(anchor.y)
  })

  test('moves the center without changing dimensions', () => {
    expect(imageBoundsFromGrip(originalBounds, 8, { x: -30, y: 50 }))
      .toEqual({ x: -70, y: 30, width: 80, height: 40 })
  })

  test.each([0, 1, 2, 3, 8])('bounds extremely distant targets for grip %i', index => {
    for (const direction of [-1, 1]) {
      const next = imageBoundsFromGrip(originalBounds, index, {
        x: direction * Number.MAX_VALUE,
        y: direction * Number.MAX_VALUE,
      })
      const limit = MAX_SVG_GEOMETRY_MAGNITUDE
      expect(Object.values(next).every(Number.isFinite)).toBe(true)
      expect(next.width).toBeGreaterThan(0)
      expect(next.height).toBeGreaterThan(0)
      expect(next.width).toBeLessThanOrEqual(limit)
      expect(next.height).toBeLessThanOrEqual(limit)
      expect(next.width / next.height).toBeCloseTo(2)
      expect(next.x).toBeGreaterThanOrEqual(-limit)
      expect(next.y).toBeGreaterThanOrEqual(-limit)
      expect(next.x + next.width).toBeLessThanOrEqual(limit)
      expect(next.y + next.height).toBeLessThanOrEqual(limit)
    }
  })

  test('rejects unsupported grips and invalid bounds or targets without mutation', () => {
    for (const bounds of [null, {}, { ...originalBounds, width: 0 }, { ...originalBounds, height: -1 },
      { ...originalBounds, x: NaN }, { ...originalBounds, width: Infinity },
      { ...originalBounds, x: MAX_SVG_GEOMETRY_MAGNITUDE }]) {
      expect(getImageGripPoints(bounds)).toEqual([])
      expect(imageBoundsFromGrip(bounds, 0, { x: 0, y: 0 })).toBeNull()
    }
    for (const index of [-1, 9, 0.5]) {
      expect(imageBoundsFromGrip(originalBounds, index, { x: 0, y: 0 })).toBeNull()
    }
    for (const point of [null, {}, { x: Infinity, y: 0 }, { x: 0, y: NaN }]) {
      expect(imageBoundsFromGrip(originalBounds, 0, point)).toBeNull()
    }
  })

  test('keeps already tiny images stable at their original corner', () => {
    const tiny = { x: 0, y: 0, width: 0.0000002, height: 0.0000001 }
    expect(imageBoundsFromGrip(tiny, 2, { x: tiny.width, y: tiny.height })).toEqual(tiny)
  })

  test('maps image corners and movement through nested transforms in local coordinates', () => {
    const activeSvg = { screenCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }) }
    const image = { screenCTM: () => ({ a: 0, b: 4, c: -4, d: 0, e: 120, f: 90 }) }
    const target = { x: 170, y: 100 }
    const rootTarget = elementLocalPointToRoot(target, image, activeSvg)
    expect(rootTarget).toEqual({ x: -190, y: 360 })
    const localTarget = rootPointToElementLocal(rootTarget, image, activeSvg)
    expect(imageBoundsFromGrip(originalBounds, 2, localTarget))
      .toEqual({ x: 10, y: 20, width: 160, height: 80 })

    const localCenter = rootPointToElementLocal({ x: -90, y: -40 }, image, activeSvg)
    expect(imageBoundsFromGrip(originalBounds, 8, localCenter))
      .toEqual({ x: -70, y: 30, width: 80, height: 40 })
  })
})

describe('image grip mutation', () => {
  test('restores units and absent attributes exactly on Undo and reapplies numerical bounds on Redo', () => {
    const { activeCollection, editor } = createFixture()
    const attributes = { x: null, y: '10%', width: '2.54cm', height: '40px' }
    const image = exposeImageLengths(activeCollection.image().attr({ ...attributes, href: 'original' }), {
      x: 0, y: 20, width: 96, height: 40,
    })
    const oldValues = readImageGripBounds(image)
    const newValues = { x: 10, y: 30, width: 192, height: 80, attributes: { href: 'replaced' } }
    const transaction = commitVertexEditUpdates(editor, {
      imageUpdates: [{ element: image, oldValues, newValues }],
    })
    oldValues.attributes.width = 'changed'
    expect(boundsOf(image)).toEqual({ x: 10, y: 30, width: 192, height: 80 })
    editor.history.undo()
    expect(Object.fromEntries(Object.keys(attributes).map(name => [name, image.node.getAttribute(name)])))
      .toEqual(attributes)
    expect(image.attr('href')).toBe('original')
    expect(image.node.hasAttribute('attributes')).toBe(false)
    editor.history.redo()
    expect(boundsOf(image)).toEqual({ x: 10, y: 30, width: 192, height: 80 })
    expect(image.attr('href')).toBe('original')
    expect(editor.history.undos).toEqual([transaction])
    expect(editor.documentState.revision).toBe(3)
  })

  test('restores raw SVG length attributes when a mixed edit partially fails', () => {
    const { activeCollection, editor } = createFixture()
    const attributes = { x: '1in', y: null, width: '2.54cm', height: '40px' }
    const image = exposeImageLengths(activeCollection.image().attr(attributes), {
      x: 96, y: 0, width: 96, height: 40,
    })
    const oldValues = readImageGripBounds(image)
    const newValues = { x: 10, y: 20, width: 192, height: 80 }
    const text = activeCollection.text('Reference').attr({ x: 1, y: 2 })
    image.attr(newValues)
    text.attr({ x: 10, y: 20 })
    vi.spyOn(text, 'rebuild').mockImplementationOnce(() => { throw new Error('mixed edit failed') })
    expect(() => commitVertexEditUpdates(editor, {
      imageUpdates: [{ element: image, oldValues, newValues }],
      textPositionUpdates: [{ element: text, oldValues: { x: 1, y: 2 }, newValues: { x: 10, y: 20 } }],
    })).toThrow('mixed edit failed')
    expect(Object.fromEntries(Object.keys(attributes).map(name => [name, image.node.getAttribute(name)])))
      .toEqual(attributes)
    expect({ x: text.attr('x'), y: text.attr('y') }).toEqual({ x: 1, y: 2 })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('preserves image content, ownership, transforms, and semantics through atomic Undo/Redo', () => {
    const { activeCollection, editor } = createFixture()
    activeCollection.attr('transform', 'translate(5 6)')
    const image = activeCollection.image().attr({
      ...originalBounds,
      id: 'image-reference',
      href: 'data:image/png;base64,AAAA',
      preserveAspectRatio: 'xMaxYMin slice',
      transform: 'rotate(30 10 20)',
      opacity: 0.4,
      style: 'mix-blend-mode: multiply',
      'data-image-note': 'A & B <reference>',
      'clip-path': 'url(#crop)',
    })
    const semantics = semanticAttributes(image)
    const next = imageBoundsFromGrip(originalBounds, 2, { x: 170, y: 100 })
    const transaction = commitVertexEditUpdates(editor, {
      imageUpdates: [{ element: image, oldValues: originalBounds, newValues: next }],
    })
    expect(transaction.commands[0]).toBeInstanceOf(EditImageCommand)
    expect(editor.history.undos).toEqual([transaction])
    expect(editor.documentState.revision).toBe(1)
    expect(boundsOf(image)).toEqual(next)
    expect(semanticAttributes(image)).toEqual(semantics)
    expect(image.parent()).toBe(activeCollection)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()

    editor.history.undo()
    expect(boundsOf(image)).toEqual(originalBounds)
    expect(semanticAttributes(image)).toEqual(semantics)
    editor.history.redo()
    expect(boundsOf(image)).toEqual(next)
    expect(semanticAttributes(image)).toEqual(semantics)
    expect(editor.documentState.revision).toBe(3)
    expect(editor.signals.updatedSelection.dispatch).toHaveBeenCalledTimes(3)
  })

  test('snapshots only geometry values and invalidates both indexes when executed directly', () => {
    const { activeCollection, editor } = createFixture()
    const image = activeCollection.image().attr({ ...originalBounds, href: 'original' })
    const oldValues = { ...originalBounds }
    const newValues = { x: 50, y: 60, width: 20, height: 10, href: 'replaced' }
    const command = new EditImageCommand(editor, image, oldValues, newValues)
    oldValues.x = -500
    newValues.x = 500
    command.execute()
    expect(boundsOf(image)).toEqual({ x: 50, y: 60, width: 20, height: 10 })
    expect(image.attr('href')).toBe('original')
    command.undo()
    expect(boundsOf(image)).toEqual(originalBounds)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalledTimes(2)
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalledTimes(2)
  })

  test.each(['image', 'text'])('rolls all mixed geometry previews back when the %s mutation partially fails', failingType => {
    const { activeCollection, editor } = createFixture()
    const image = activeCollection.image().attr(originalBounds)
    const rectangle = activeCollection.rect(20, 10).move(0, 0)
    const text = activeCollection.text('Reference').attr({ x: 1, y: 2 })
    const nextImage = { x: 20, y: 30, width: 160, height: 80 }
    image.attr(nextImage)
    rectangle.move(20, 30).size(40, 20)
    text.attr({ x: 30, y: 40 })
    const failingElement = failingType === 'image' ? image : text
    const originalAttr = failingElement.attr.bind(failingElement)
    let fail = true
    vi.spyOn(failingElement, 'attr').mockImplementation((name, value) => {
      const result = originalAttr(name, value)
      const matchesApply = failingType === 'image'
        ? name === 'width' && value === 160
        : name === 'x' && value === 30
      if (matchesApply && fail) {
        fail = false
        throw new Error('injected mixed edit failure')
      }
      return result
    })
    expect(() => commitVertexEditUpdates(editor, {
      imageUpdates: [{ element: image, oldValues: originalBounds, newValues: nextImage }],
      rectangleUpdates: [{
        element: rectangle,
        oldValues: { x: 0, y: 0, width: 20, height: 10 },
        newValues: { x: 20, y: 30, width: 40, height: 20 },
      }],
      textPositionUpdates: [{ element: text, oldValues: { x: 1, y: 2 }, newValues: { x: 30, y: 40 } }],
    })).toThrow('injected mixed edit failure')
    expect(boundsOf(image)).toEqual(originalBounds)
    expect(boundsOf(rectangle)).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect({ x: text.attr('x'), y: text.attr('y') }).toEqual({ x: 1, y: 2 })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.history.redos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
  })
})
