// @vitest-environment jsdom

import { Matrix } from '@svgdotjs/svg.js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Viewport } from '../src/js/Viewport.js'
import { Terminal } from '../src/js/Terminal.js'
import { cancelCommandSession } from '../src/js/commands/_commands.js'
import { getImageVisibleBounds, readImageGripBounds } from '../src/js/utils/imageGrips.js'
import {
  createDeterministicEditorFixture,
  installClockHarness,
  installDomListenerTracker,
} from './support/deterministic-harness.js'

let fixture, editor, image, clock, listeners, windowProperties
const bounds = { x: 2, y: 3, width: 20, height: 10 }
const href = 'data:image/png;base64,AQID'

beforeEach(() => {
  document.body.replaceChildren()
  windowProperties = new Map(Object.getOwnPropertyNames(window).map(key => [key, Object.getOwnPropertyDescriptor(window, key)]))
  clock = installClockHarness()
  listeners = installDomListenerTracker()
  fixture = createDeterministicEditorFixture()
  editor = fixture.editor
  editor.spatialIndex.ensureFresh = vi.fn()
  editor.spatialIndex.search = vi.fn(() => [])
  for (const svg of [editor.svg, editor.paperSvg]) {
    svg.panZoom = () => svg
    svg.zoom = () => 10
    vi.spyOn(svg, 'screenCTM').mockReturnValue(new Matrix())
    vi.spyOn(svg.node, 'getBoundingClientRect').mockReturnValue({ left: -5, top: -5, right: 5, bottom: 5, width: 10, height: 10 })
  }
  image = editor.activeCollection.image().attr({
    ...bounds, href, name: 'Reference', preserveAspectRatio: 'xMidYMid meet',
  })
  vi.spyOn(image, 'screenCTM').mockReturnValue(new Matrix())
  editor.selected = [image]
  new Viewport(editor)
  new Terminal(editor)
})

afterEach(() => {
  cancelCommandSession(editor)
  listeners.dispose()
  fixture.dispose()
  clock.dispose()
  vi.restoreAllMocks()
  Object.getOwnPropertyNames(window).forEach(key => {
    const previous = windowProperties.get(key)
    if (!previous) delete window[key]
    else if (previous.configurable && Object.hasOwn(previous, 'value') && previous.value !== Object.getOwnPropertyDescriptor(window, key)?.value) {
      Object.defineProperty(window, key, previous)
    }
  })
  document.body.replaceChildren()
})

function start(index) {
  editor.signals.vertexEditStarted.dispatch([{ element: image, vertexIndex: index, originalPosition: readImageGripBounds(image) }])
}

async function move(x, y) {
  editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
  await clock.advanceFrame()
}

function click(x, y) {
  editor.svg.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }))
}

function currentBounds() {
  return Object.fromEntries(Object.keys(bounds).map(key => [key, image.attr(key)]))
}

describe('image grip viewport lifecycle', () => {
  test('hover selection ignores cropped-away pixels even when the spatial query returns the image', async () => {
    editor.selected = []
    Object.defineProperty(editor.svg.node, 'clientWidth', { configurable: true, value: 1000 })
    image.attr('clip-path', 'inset(0% 50% 0% 0%) fill-box')
    editor.spatialIndex.search.mockReturnValue([{ element: image, minX: 2, minY: 3, maxX: 22, maxY: 13 }])

    await move(20, 8)
    await clock.advanceFrame()
    expect(image.hasClass('elementHover')).toBe(false)

    await move(6, 8)
    await clock.advanceFrame()
    expect(image.hasClass('elementHover')).toBe(true)
  })

  test.each([
    [4, 'inset(50% 0% 0% 0%) fill-box'],
    [5, 'inset(0% 50% 0% 0%) fill-box'],
    [6, 'inset(0% 0% 50% 0%) fill-box'],
    [7, 'inset(0% 0% 0% 50%) fill-box'],
  ])('previews and commits side %s as a reversible crop without stretching the source', async (index, clip) => {
    editor.ortho = true
    const original = image.node.outerHTML
    start(index)
    await move(12, 8)

    expect(image.attr('clip-path')).toBe(clip)
    expect(currentBounds()).toEqual(bounds)
    expect(image.attr('href')).toBe(href)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    click(12, 8)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.editingVertices).toHaveLength(0)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()

    editor.history.undo()
    expect(image.node.outerHTML).toBe(original)
    editor.history.redo()
    expect(image.attr('clip-path')).toBe(clip)
    expect(currentBounds()).toEqual(bounds)
  })

  test('Escape restores an existing crop and original SVG length attributes', async () => {
    image.attr({ x: '2.00', 'clip-path': 'inset(10% 20% 10% 20%) fill-box' })
    const original = image.node.outerHTML
    start(7)
    await move(12, 8)
    expect(image.node.outerHTML).not.toBe(original)
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }))

    expect(image.node.outerHTML).toBe(original)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.handlers.hasClass('handlers-editing')).toBe(false)
  })

  test('crops a rotated and translated image in its own coordinate space', async () => {
    const transform = 'matrix(0 2 -2 0 100 50)'
    image.attr('transform', transform)
    image.screenCTM.mockReturnValue(new Matrix(0, 2, -2, 0, 100, 50))
    start(7)
    await move(84, 74) // local (12, 8)
    click(84, 74)

    expect(image.attr('clip-path')).toBe('inset(0% 0% 0% 50%) fill-box')
    expect(image.attr('transform')).toBe(transform)
    expect(currentBounds()).toEqual(bounds)
    expect(getImageVisibleBounds(readImageGripBounds(image))).toEqual({ x: 12, y: 3, width: 10, height: 10 })
    editor.history.undo()
    expect(image.attr('clip-path')).toBeUndefined()
    expect(image.attr('transform')).toBe(transform)
  })

  test('can reveal the full source again by moving a cropped side outwards', async () => {
    image.attr('clip-path', 'inset(0% 0% 0% 50%) fill-box')
    start(7)
    await move(-50, 8)
    click(-50, 8)

    expect(image.attr('clip-path')).toBeUndefined()
    expect(currentBounds()).toEqual(bounds)
    editor.history.undo()
    expect(image.attr('clip-path')).toBe('inset(0% 0% 0% 50%) fill-box')
  })

  test('cancels a crop if a stylesheet takes ownership before commit', async () => {
    const original = image.node.outerHTML
    start(4)
    await move(12, 8)
    const style = document.createElement('style')
    style.textContent = 'image { clip-path: none }'
    document.body.appendChild(style)
    click(12, 8)

    expect(image.node.outerHTML).toBe(original)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('previews and commits a proportional resize as one reversible edit even with ortho enabled', async () => {
    editor.ortho = true
    start(2)
    await move(42, 23)
    expect(currentBounds()).toEqual({ x: 2, y: 3, width: 40, height: 20 })
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    click(42, 23)
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.editingVertices).toHaveLength(0)
    expect(currentBounds()).toEqual({ x: 2, y: 3, width: 40, height: 20 })
    editor.history.undo()
    expect(currentBounds()).toEqual(bounds)
    editor.history.redo()
    expect(currentBounds()).toEqual({ x: 2, y: 3, width: 40, height: 20 })
    expect(image.attr('href')).toBe(href)
  })

  test('translates a transformed image in local coordinates and keeps its transform', async () => {
    image.attr('transform', 'matrix(2 0 0 2 20 30)')
    image.screenCTM.mockReturnValue(new Matrix(2, 0, 0, 2, 20, 30))
    start(8)
    await move(50, 54) // local center (15, 12), delta (3, 4)
    expect(currentBounds()).toEqual({ x: 5, y: 7, width: 20, height: 10 })
    click(50, 54)
    expect(editor.history.undos).toHaveLength(1)
    expect(image.attr('transform')).toBe('matrix(2 0 0 2 20 30)')
    editor.history.undo()
    expect(currentBounds()).toEqual(bounds)
    editor.history.redo()
    expect(currentBounds()).toEqual({ x: 5, y: 7, width: 20, height: 10 })
  })

  test('uses the center anchor for ortho translation in both preview and commit', async () => {
    editor.ortho = true
    start(8)
    await move(25, 10)
    expect(currentBounds()).toEqual({ x: 15, y: 3, width: 20, height: 10 })
    click(25, 10)
    expect(currentBounds()).toEqual({ x: 15, y: 3, width: 20, height: 10 })
  })

  test('Escape restores the exact image attributes without history or dirty state', async () => {
    image.attr('x', '2.00')
    const original = image.node.outerHTML
    start(2)
    await move(42, 23)
    expect(image.node.outerHTML).not.toBe(original)
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }))
    expect(image.node.outerHTML).toBe(original)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.handlers.hasClass('handlers-editing')).toBe(false)
    expect(editor.selected).toEqual([image])
  })

  test('a replacement command cancels a pending frame and restores the original image', async () => {
    start(8)
    await move(32, 18)
    editor.svg.node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 52, clientY: 28 }))
    cancelCommandSession(editor)
    await clock.runAll()
    expect(currentBounds()).toEqual(bounds)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    expect(editor.isEditingVertex).toBe(false)
  })

  test.each([1, 2])('mouse button %s cannot finish an image grip edit', async button => {
    start(8)
    await move(32, 18)
    editor.svg.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button, clientX: 32, clientY: 18 }))
    expect(editor.isEditingVertex).toBe(true)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
    click(32, 18)
    expect(editor.history.undos).toHaveLength(1)
  })

  test('switching to Paper cancels the image preview before any Paper click can commit it', async () => {
    start(8)
    await move(32, 18)
    editor.mode = 'paper'
    editor.signals.editorModeChanged.dispatch('paper')
    expect(currentBounds()).toEqual(bounds)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })

  test('cancels safely if an image transform becomes singular during an edit', async () => {
    start(8)
    await move(32, 18)
    image.screenCTM.mockReturnValue(new Matrix(0, 0, 0, 0, 0, 0))
    click(32, 18)
    expect(currentBounds()).toEqual(bounds)
    expect(editor.isEditingVertex).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.revision).toBe(0)
  })
})
