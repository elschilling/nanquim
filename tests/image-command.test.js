// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ImageImportSession, importImageFile } from '../src/js/commands/ImageCommand'
import { cancelCommandSession, executeRegisteredCommand } from '../src/js/commands/_commands'
import { readRasterImage } from '../src/js/utils/importRasterImage'
import { initImageDrop } from '../src/js/utils/imageDrop'
import { serializeNativeDocument } from '../src/js/document/DocumentSerializer'
import { DimensionManager } from '../src/js/DimensionManager'
import { TextStyleManager } from '../src/js/TextStyleManager'
import { createDeterministicEditorFixture } from './support/deterministic-harness'

vi.mock('../src/js/utils/importRasterImage', () => ({
  IMAGE_FILE_ACCEPT: 'image/png,image/jpeg,image/gif,image/webp',
  readRasterImage: vi.fn(),
}))

const raster = {
  href: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
  width: 200,
  height: 100,
  name: 'A & B <image> "one" \'two\'.png',
}
let fixture
let editor
let session
let unbindDrop

beforeEach(() => {
  document.body.replaceChildren()
  fixture = createDeterministicEditorFixture({ coordinates: { x: 3, y: 4 } })
  editor = fixture.editor
  editor.svg.viewbox(-10, -10, 40, 30)
  editor.documentState.sessionId = 1
  editor.paperConfig = { size: 'A4', width: 210, height: 297, orientation: 'portrait', unitsPerCm: 1, colorMap: {} }
  editor.documentState.runWithoutTracking(() => {
    editor.dimensionManager = new DimensionManager(editor)
    editor.textStyleManager = new TextStyleManager(editor)
  })
  readRasterImage.mockReset().mockResolvedValue({ ...raster })
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  session?.cleanup()
  session = null
  cancelCommandSession(editor)
  unbindDrop?.()
  unbindDrop = null
  fixture.dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function imageNodes() {
  return editor.drawing.node.querySelectorAll('image')
}

async function chooseImage() {
  session = new ImageImportSession(editor)
  await session.start({ name: raster.name })
  return session
}

describe('image import command', () => {
  test('keeps placement transient, follows coordinates, and cancels without dirtying history', async () => {
    const index = editor.elementIndex
    await chooseImage()
    expect(imageNodes()).toHaveLength(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.isDirty).toBe(false)
    expect(session.previewRoot.node.previousSibling).toBe(editor.handlers.node)
    expect(session.preview.attr('pointer-events')).toBe('none')
    editor.signals.updatedCoordinates.dispatch({ x: 10, y: 20 })
    expect(session.preview.attr('x')).toBe(10)
    expect(session.preview.attr('y')).toBe(20)
    editor.signals.commandCancelled.dispatch()
    expect(document.querySelector('[data-nanquim-transient]')).toBeNull()
    expect(editor.elementIndex).toBe(index)
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.signals.pointCaptured.getNumListeners()).toBe(0)
    expect(editor.signals.coordinateInput.getNumListeners()).toBe(0)
    expect(editor.documentState.isDirty).toBe(false)
  })

  test('commits once into the current collection, fits aspect, and supports Undo/Redo and serialization', async () => {
    await chooseImage()
    const parent = editor.drawing.group().attr({ id: 'second', 'data-collection': 'true' })
    editor.collections.set('second', { group: parent, visible: true, locked: false, style: { opacity: 0.7 } })
    editor.activeCollection = parent
    editor.signals.pointCaptured.dispatch({ x: 12, y: -8 })
    expect(imageNodes(), JSON.stringify(editor.signals.terminalLogged.dispatch.mock.calls)).toHaveLength(1)
    const element = parent.findOne('image')
    expect(element.attr()).toMatchObject({ x: 12, y: -8, width: 20, height: 10, href: raster.href, name: raster.name })
    expect(element.node.hasAttribute('transform')).toBe(false)
    expect(element.css('opacity')).toBe('0.7')
    expect(editor.history.undos).toHaveLength(1)
    expect(editor.documentState.revision).toBe(1)
    expect(editor.spatialIndex.markDirty).toHaveBeenCalled()
    expect(editor.fullSpatialIndex.markDirty).toHaveBeenCalled()
    const source = serializeNativeDocument(editor)
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    expect(parsed.querySelector('image').getAttribute('name')).toBe(raster.name)
    expect(parsed.querySelector('image').getAttribute('href')).toBe(raster.href)
    const id = element.id()
    editor.selected = [element]
    editor.history.undo()
    expect(imageNodes()).toHaveLength(0)
    expect(editor.selected).toHaveLength(0)
    editor.history.redo()
    expect(parent.findOne('image')).toBe(element)
    expect(element.id()).toBe(id)
    expect(element.attr('href')).toBe(raster.href)
    expect(serializeNativeDocument(editor)).toBe(source)
  })

  test.each(['absolute', 'relative'])('places from %s typed coordinates with recorded input', async mode => {
    await chooseImage()
    editor.inputCoord = { x: 5, y: 7 }
    editor.inputCoordMode = mode
    editor.signals.coordinateInput.dispatch()
    expect(imageNodes()).toHaveLength(1)
    const element = editor.activeCollection.findOne('image')
    expect(element.attr('x')).toBe(mode === 'relative' ? 8 : 5)
    expect(element.attr('y')).toBe(mode === 'relative' ? 11 : 7)
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith(expect.objectContaining({ recordInput: true }))
    expect(editor.inputCoord).toBeNull()
  })

  test('rejects invalid coordinates and keeps the placement available', async () => {
    await chooseImage()
    editor.signals.pointCaptured.dispatch({ x: Infinity, y: 0 })
    expect(imageNodes()).toHaveLength(0)
    expect(editor.isInteracting).toBe(true)
    editor.signals.pointCaptured.dispatch({ x: 1, y: 2 })
    expect(imageNodes()).toHaveLength(1)
  })

  test('preserves root placement and proportions inside a transformed collection', async () => {
    editor.activeCollection.attr('transform', 'translate(30 40) scale(2)')
    await importImageFile(editor, {}, { x: 12, y: 15 })
    const element = editor.activeCollection.findOne('image')
    expect(element).not.toBeNull()
    const combined = editor.activeCollection.matrixify().multiply(element.matrixify())
    expect(combined.a).toBeCloseTo(1)
    expect(combined.d).toBeCloseTo(1)
    expect(combined.e).toBeCloseTo(0)
    expect(combined.f).toBeCloseTo(0)
    expect(element.attr('x')).toBe(12)
    expect(element.attr('y')).toBe(15)
  })

  test('rejects a singular destination without changing document or history', async () => {
    editor.activeCollection.attr('transform', 'scale(0)')
    await importImageFile(editor, {}, { x: 1, y: 2 })
    expect(imageNodes()).toHaveLength(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.isDirty).toBe(false)
    expect(document.querySelector('[data-nanquim-transient]')).toBeNull()
  })

  test('rejects an invalid drop point without leaving a placement session active', async () => {
    await importImageFile(editor, {}, { x: Infinity, y: 0 })
    expect(editor.isInteracting).toBe(false)
    expect(editor.selectSingleElement).toBe(false)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.isDirty).toBe(false)
  })

  test('rejects an import that would exceed the native element index limit', async () => {
    editor.elementIndex = 1000000000
    await importImageFile(editor, {}, { x: 0, y: 0 })
    expect(imageNodes()).toHaveLength(0)
    expect(editor.elementIndex).toBe(1000000000)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.isInteracting).toBe(false)
  })

  test('rolls back a failed insertion and releases the placement session', async () => {
    await chooseImage()
    vi.spyOn(editor.activeCollection, 'add').mockImplementation(() => { throw new Error('insert failed') })
    editor.signals.pointCaptured.dispatch({ x: 1, y: 2 })
    expect(imageNodes()).toHaveLength(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.documentState.isDirty).toBe(false)
    expect(editor.elementIndex).toBe(1)
    expect(editor.isInteracting).toBe(false)
    expect(document.querySelector('[data-nanquim-transient]')).toBeNull()
  })

  test.each(['command', 'document', 'mode'])('discards pending reads after %s changes', async change => {
    let finish
    readRasterImage.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    session = new ImageImportSession(editor)
    const loading = session.start({}, { x: 1, y: 2 })
    if (change === 'command') cancelCommandSession(editor)
    if (change === 'document') {
      editor.documentState.sessionId += 1
      editor.signals.documentSessionReset.dispatch()
    }
    if (change === 'mode') {
      editor.mode = 'paper'
      editor.signals.editorModeChanged.dispatch('paper')
    }
    editor.isInteracting = true // a successor owns this flag
    finish(raster)
    await loading
    expect(imageNodes()).toHaveLength(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(readRasterImage.mock.calls[0][1].signal.aborted).toBe(true)
    expect(editor.isInteracting).toBe(true)
  })

  test('reports failed decode and cleans up without dirtying the document', async () => {
    readRasterImage.mockRejectedValue(new Error('corrupt image'))
    await importImageFile(editor, {}, { x: 1, y: 2 })
    expect(editor.signals.terminalLogged.dispatch).toHaveBeenCalledWith({ msg: 'Image import failed: corrupt image' })
    expect(imageNodes()).toHaveLength(0)
    expect(editor.history.undos).toHaveLength(0)
    expect(editor.isInteracting).toBe(false)
    expect(editor.documentState.isDirty).toBe(false)
  })

  test.each(['IMAGE', 'img', 'imageattach'])('opens one cancellable picker through %s and repeat', name => {
    executeRegisteredCommand(editor, name)
    expect(document.querySelectorAll('input[data-image-import]')).toHaveLength(1)
    const input = document.querySelector('input[data-image-import]')
    input.dispatchEvent(new Event('cancel'))
    expect(document.querySelector('input[data-image-import]')).toBeNull()
    expect(editor.isInteracting).toBe(false)
    editor.lastCommand.execute()
    expect(document.querySelectorAll('input[data-image-import]')).toHaveLength(1)
    cancelCommandSession(editor)
    expect(document.querySelector('input[data-image-import]')).toBeNull()
    expect(editor.history.undos).toHaveLength(0)
  })

  test('cleans the picker after file selection and enters placement', async () => {
    executeRegisteredCommand(editor, 'IMAGE')
    const input = document.querySelector('input[data-image-import]')
    Object.defineProperty(input, 'files', { value: [{}] })
    input.dispatchEvent(new Event('change'))
    await Promise.resolve()
    expect(document.querySelector('input[data-image-import]')).toBeNull()
    expect(document.querySelector('image[data-nanquim-transient]')).not.toBeNull()
  })

  test('does not open a picker or mutate Paper Space', () => {
    editor.mode = 'paper'
    executeRegisteredCommand(editor, 'IMAGE')
    expect(document.querySelector('input[data-image-import]')).toBeNull()
    expect(readRasterImage).not.toHaveBeenCalled()
  })
})

describe('viewport image drop', () => {
  function dispatch(type, files, types = ['Files']) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 210, clientY: 150 })
    Object.defineProperty(event, 'dataTransfer', { value: { files, types, dropEffect: 'none' } })
    editor.svg.node.dispatchEvent(event)
    return event
  }

  test('uses viewport coordinate conversion and replaces an unfinished command', async () => {
    await chooseImage()
    unbindDrop = initImageDrop(editor)
    editor.svg.point.mockReturnValue({ x: -7, y: 11 })
    const over = dispatch('dragover', [])
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('copy')
    const drop = dispatch('drop', [{}])
    await Promise.resolve()
    expect(drop.defaultPrevented).toBe(true)
    expect(editor.svg.point).toHaveBeenCalledWith(210, 150)
    const element = editor.activeCollection.findOne('image')
    expect(element).not.toBeNull()
    expect(element.attr('x')).toBe(-7)
    expect(element.attr('y')).toBe(11)
    expect(editor.history.undos).toHaveLength(1)
    expect(document.querySelector('[data-nanquim-transient]')).toBeNull()
  })

  test('ignores URL drags, rejects multiple files/Paper drops, and disposes listeners', () => {
    unbindDrop = initImageDrop(editor)
    expect(dispatch('drop', [], ['text/uri-list']).defaultPrevented).toBe(false)
    expect(dispatch('drop', [{}, {}]).defaultPrevented).toBe(true)
    editor.mode = 'paper'
    expect(dispatch('drop', [{}]).defaultPrevented).toBe(true)
    expect(readRasterImage).not.toHaveBeenCalled()
    unbindDrop()
    expect(dispatch('drop', [{}]).defaultPrevented).toBe(false)
  })
})
