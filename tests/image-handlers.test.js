// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Matrix } from '@svgdotjs/svg.js'

import { createDeterministicEditorFixture } from './support/deterministic-harness.js'

let fixture
let editor
let zoom

function exposeLengths(element, names, resolved = {}) {
  names.forEach((name) => {
    Object.defineProperty(element.node, name, {
      configurable: true,
      value: { baseVal: { get value() { return resolved[name] ?? Number(element.attr(name)) } } },
    })
  })
  return element
}

function setElementMatrix(element, matrix = new Matrix()) {
  element.screenCTM = vi.fn(() => editor.svg.screenCTM().multiply(matrix))
  return element
}

function createImage(bounds = { x: 10, y: 20, width: 40, height: 20 }) {
  const image = editor.activeCollection.image().attr({
    ...bounds,
    id: 'imported-image',
    href: 'data:image/png;base64,iVBORw0KGgo=',
    preserveAspectRatio: 'xMidYMid meet',
  })
  exposeLengths(image, ['x', 'y', 'width', 'height'])
  return setElementMatrix(image)
}

function select(...elements) {
  editor.selected = elements
  editor.signals.updatedSelection.dispatch()
}

function imageGrips(image, count = 9) {
  const grips = [...editor.handlers.node.querySelectorAll('[data-image-grip]')]
    .filter(node => node.getAttribute('data-image-id') === image.id())
  expect(grips).toHaveLength(count)
  return grips
}

function center(node) {
  return [
    Number(node.getAttribute('x')) + Number(node.getAttribute('width')) / 2,
    Number(node.getAttribute('y')) + Number(node.getAttribute('height')) / 2,
  ]
}

function expectGripSizes(image, size) {
  imageGrips(image).forEach((grip) => {
    const crop = grip.classList.contains('selection-handler-image-crop')
    expect(Number(grip.getAttribute('width')) * zoom).toBe(size * (crop ? 1.5 : 1))
    expect(Number(grip.getAttribute('height')) * zoom).toBe(size * (crop ? 0.375 : 1))
  })
}

function press(node, button = 0) {
  node.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }))
}

describe('image selection handlers', () => {
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    document.body.innerHTML = '<div id="drawing-tree"></div>'
    fixture = createDeterministicEditorFixture()
    editor = fixture.editor
    zoom = 2
    editor.svg.zoom = vi.fn(() => zoom)
    editor.svg.screenCTM = vi.fn(() => new Matrix(zoom, 0, 0, zoom, 100, 50))
    const { Outliner } = await import('../src/js/Outliner.js')
    new Outliner(editor)
  })

  afterEach(() => {
    fixture?.dispose()
    vi.restoreAllMocks()
    localStorage.clear()
    document.body.replaceChildren()
  })

  test('keeps the existing eight rectangle grips and corner edit snapshot', () => {
    const rect = setElementMatrix(exposeLengths(
      editor.activeCollection.rect(40, 20).move(10, 20),
      ['x', 'y', 'width', 'height'],
    ))

    select(rect)

    const grips = [...editor.handlers.node.children]
    expect(grips).toHaveLength(8)
    expect(grips.map(center)).toEqual([
      [10, 20], [50, 20], [50, 40], [10, 40],
      [30, 20], [50, 30], [30, 40], [10, 30],
    ])
    press(grips[0])
    expect(editor.signals.vertexEditStarted.dispatch).toHaveBeenCalledWith([{
      element: rect,
      vertexIndex: 0,
      originalPosition: { x: 10, y: 20, width: 40, height: 20 },
    }])
  })

  test('shows four resize corners, four crop sides, and one move center outside the persistent drawing', () => {
    const image = createImage()
    const boundsAndSource = ['id', 'x', 'y', 'width', 'height', 'href', 'preserveAspectRatio']
      .map(name => [name, image.attr(name)])

    select(image)

    const grips = imageGrips(image)
    expect(grips.map(node => Number(node.getAttribute('data-image-grip')))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(grips.map(center)).toEqual([[10, 20], [50, 20], [50, 40], [10, 40], [30, 20], [50, 30], [30, 40], [10, 30], [30, 30]])
    grips.forEach((grip, index) => {
      expect(grip.classList.contains('selection-handler')).toBe(true)
      expect(grip.classList.contains('selection-handler-image')).toBe(true)
      expect(grip.parentNode).toBe(editor.handlers.node)
      expect(editor.drawing.node.contains(grip)).toBe(false)
      const label = index === 8 ? 'Move image' : index >= 4 ? `Crop image ${['top', 'right', 'bottom', 'left'][index - 4]}` : 'Resize image'
      expect(grip.querySelector('title')?.textContent).toBe(label)
      expect(grip.getAttribute('aria-label')).toBe(label)
    })
    boundsAndSource.forEach(([name, value]) => expect(image.attr(name)).toBe(value))
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('positions grips in root space for transformed images and keeps their screen size on zoom', () => {
    const image = createImage()
    const group = editor.activeCollection.group().attr('transform', 'translate(80 40)')
    image.putIn(group).attr('transform', 'rotate(90)')
    setElementMatrix(image, new Matrix(0, 1, -1, 0, 80, 40))

    select(image)

    const expectedCenters = [[60, 50], [60, 90], [40, 90], [40, 50], [60, 70], [50, 90], [40, 70], [50, 50], [50, 70]]
    expect(imageGrips(image).map(center)).toEqual(expectedCenters)
    expectGripSizes(image, 16)

    zoom = 4
    editor.signals.zoomChanged.dispatch()
    expect(imageGrips(image).map(center)).toEqual(expectedCenters)
    expectGripSizes(image, 16)

    localStorage.setItem('nanquim-preferences', JSON.stringify({ handlerSize: 24 }))
    editor.signals.preferencesChanged.dispatch()
    expectGripSizes(image, 24)
  })

  test('starts each resize or move edit with the original local image bounds', () => {
    const image = createImage()
    select(image)
    const viewportMouseDown = vi.fn()
    editor.svg.node.addEventListener('mousedown', viewportMouseDown)

    imageGrips(image).forEach((grip, index) => {
      editor.signals.vertexEditStarted.dispatch.mockClear()
      press(grip)
      expect(editor.signals.vertexEditStarted.dispatch).toHaveBeenCalledOnce()
      expect(editor.signals.vertexEditStarted.dispatch.mock.lastCall[0]).toMatchObject([{
        element: image,
        vertexIndex: index,
        originalPosition: { x: 10, y: 20, width: 40, height: 20 },
      }])
    })
    expect(viewportMouseDown).not.toHaveBeenCalled()
  })

  test('edits only the chosen image grip when all grips fall inside coincidence tolerance', () => {
    const image = createImage({ x: 5, y: 6, width: 0.01, height: 0.02 })
    select(image)

    imageGrips(image).forEach((grip) => {
      editor.signals.vertexEditStarted.dispatch.mockClear()
      press(grip)
      const [vertices] = editor.signals.vertexEditStarted.dispatch.mock.lastCall
      expect(vertices).toHaveLength(1)
      expect(vertices[0].element).toBe(image)
      expect(vertices[0].vertexIndex).toBe(Number(grip.getAttribute('data-image-grip')))
    })
  })

  test('includes another selected element at a coincident image corner', () => {
    const image = createImage()
    const line = setElementMatrix(exposeLengths(
      editor.activeCollection.line(10, 20, 70, 80),
      ['x1', 'y1', 'x2', 'y2'],
    ))
    select(line, image)

    press(imageGrips(image)[0])

    const [vertices] = editor.signals.vertexEditStarted.dispatch.mock.lastCall
    expect(vertices).toHaveLength(2)
    expect(vertices).toMatchObject([
      { element: image, vertexIndex: 0, originalPosition: { x: 10, y: 20, width: 40, height: 20 } },
      { element: line, vertexIndex: 0, originalPosition: { x: 10, y: 20 } },
    ])
  })

  test('uses resolved SVG lengths for imported image grips without replacing the original attributes', () => {
    const raw = { x: '10mm', y: '20px', width: '40px', height: '20px' }
    const resolved = { x: 10 * 96 / 25.4, y: 20, width: 40, height: 20 }
    const image = exposeLengths(createImage(raw), Object.keys(raw), resolved)

    select(image)

    const expectedCenters = [
      [resolved.x, 20], [resolved.x + 40, 20],
      [resolved.x + 40, 40], [resolved.x, 40],
      [resolved.x + 20, 20], [resolved.x + 40, 30],
      [resolved.x + 20, 40], [resolved.x, 30], [resolved.x + 20, 30],
    ]
    imageGrips(image).forEach((grip, index) => {
      const [x, y] = center(grip)
      expect(x).toBeCloseTo(expectedCenters[index][0], 8)
      expect(y).toBeCloseTo(expectedCenters[index][1], 8)
    })
    press(imageGrips(image)[8])
    expect(editor.signals.vertexEditStarted.dispatch.mock.lastCall[0]).toMatchObject([{
      element: image,
      vertexIndex: 8,
      originalPosition: resolved,
    }])
    Object.entries(raw).forEach(([name, value]) => expect(image.node.getAttribute(name)).toBe(value))
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })

  test('omits images with singular transforms from handlers and coincident edits', () => {
    const image = setElementMatrix(createImage(), new Matrix(0, 0, 0, 2, 10, 0))
    image.attr('transform', 'matrix(0 0 0 2 10 0)')
    select(image)
    expect(editor.handlers.children()).toHaveLength(0)

    const line = setElementMatrix(exposeLengths(
      editor.activeCollection.line(10, 40, 70, 80),
      ['x1', 'y1', 'x2', 'y2'],
    ))
    select(image, line)
    expect(editor.handlers.node.querySelectorAll('[data-image-grip]')).toHaveLength(0)
    expect(editor.handlers.children()).toHaveLength(2)

    press(editor.handlers.node.firstElementChild)
    expect(editor.signals.vertexEditStarted.dispatch.mock.lastCall[0]).toEqual([{
      element: line,
      vertexIndex: 0,
      originalPosition: { x: 10, y: 40 },
    }])
  })

  test('places every handler around the visible cropped image', () => {
    const image = createImage().attr('clip-path', 'inset(25% 10% 25% 20%) fill-box')
    select(image)

    expect(imageGrips(image).map(center)).toEqual([
      [18, 25], [46, 25], [46, 35], [18, 35],
      [32, 25], [46, 30], [32, 35], [18, 30], [32, 30],
    ])
    expect(editor.handlers.node.querySelectorAll('.selection-handler-image-crop')).toHaveLength(4)
    expect(imageGrips(image)[4].style.cursor).toBe('ns-resize')
    expect(imageGrips(image)[5].style.cursor).toBe('ew-resize')
  })

  test('crop handles edit only their image, leaving coincident selected geometry alone', () => {
    const image = createImage()
    const other = createImage().attr('id', 'other-image')
    const line = setElementMatrix(exposeLengths(
      editor.activeCollection.line(30, 20, 70, 80), ['x1', 'y1', 'x2', 'y2'],
    ))
    select(line, image, other)

    press(imageGrips(image)[4])

    expect(editor.signals.vertexEditStarted.dispatch.mock.lastCall[0]).toMatchObject([{
      element: image, vertexIndex: 4, originalPosition: { x: 10, y: 20, width: 40, height: 20 },
    }])
    expect(editor.signals.vertexEditStarted.dispatch.mock.lastCall[0]).toHaveLength(1)
  })

  test('does not expose crop handles that would replace an imported clip path', () => {
    const image = createImage().attr('clip-path', 'url(#imported-clip)')
    select(image)

    expect(imageGrips(image, 5).map(grip => Number(grip.getAttribute('data-image-grip')))).toEqual([0, 1, 2, 3, 8])
    expect(image.attr('clip-path')).toBe('url(#imported-clip)')
  })

  test('does not expose ineffective crop handles when a stylesheet owns initially empty clipping', () => {
    const style = document.createElement('style')
    style.textContent = '.css-clipped-image { clip-path: none }'
    document.body.appendChild(style)
    const image = createImage().addClass('css-clipped-image')
    select(image)

    expect(imageGrips(image, 5).map(grip => Number(grip.getAttribute('data-image-grip')))).toEqual([0, 1, 2, 3, 8])
    expect(image.attr('clip-path')).toBeUndefined()
    expect(editor.history.undos).toHaveLength(0)
  })

  test('ignores middle and right clicks and removes grips when selection clears', () => {
    const image = createImage()
    select(image)
    imageGrips(image).forEach((grip) => {
      press(grip, 1)
      press(grip, 2)
    })
    expect(editor.signals.vertexEditStarted.dispatch).not.toHaveBeenCalled()

    editor.signals.clearSelection.dispatch()
    expect(editor.handlers.children()).toHaveLength(0)
    expect(editor.selected).toEqual([])
    expect(image.parent()).toBe(editor.activeCollection)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
  })
})
