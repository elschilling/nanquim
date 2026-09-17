import { Matrix } from '@svgdotjs/svg.js'
import { Command } from '../Command'
import { applyCollectionStyleToElement } from '../Collection'
import { buildNativeDocument } from '../document/DocumentSerializer'
import { assertDocumentSourceSize } from '../document/DocumentMetadata'
import { resolveInputCoordinate } from '../utils/coordinateInput'
import { getParentToRootMatrix } from '../utils/rootSpaceTransform'
import { MAX_SVG_GEOMETRY_MAGNITUDE, sanitizeSvgDocument } from '../utils/sanitizeSvg'
import { IMAGE_FILE_ACCEPT, readRasterImage } from '../utils/importRasterImage'

function validPoint(point) {
  return point && [point.x, point.y].every(value => (
    Number.isFinite(value) && Math.abs(value) <= MAX_SVG_GEOMETRY_MAGNITUDE
  ))
}

class AddImageCommand extends Command {
  constructor(editor, element, parent) {
    super(editor)
    this.type = 'AddImageCommand'
    this.name = 'Import Image'
    this.element = element
    this.parent = parent
  }

  execute() {
    const index = this.editor.elementIndex
    try {
      this.parent.add(this.element)
      this.element.attr({ id: this.editor.elementIndex++, 'data-nanquim-transient': null })
      this.index = Array.from(this.parent.node.children).indexOf(this.element.node)
    } catch (error) {
      this.element.remove()
      this.editor.elementIndex = index
      throw error
    }
    this.notify()
  }

  undo() {
    this.element.remove()
    if (this.editor.selected.includes(this.element)) {
      this.dispatchSignal('clearSelection')
      this.editor.selected = this.editor.selected.filter(element => element !== this.element)
      this.dispatchSignal('updatedSelection')
    }
    this.notify()
  }

  redo() {
    this.parent.node.insertBefore(this.element.node, this.parent.node.children[this.index] || null)
    this.notify()
  }

  notify() {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('modelContentChanged')
  }
}

class ImageImportSession extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'ImageImportSession'
    this.sessionId = editor.documentState?.sessionId
    this.abortController = new AbortController()
    this.onCoordinate = () => this.place(resolveInputCoordinate(editor))
    this.onPoint = point => this.place(point)
    this.onMove = point => {
      if (validPoint(point) && this.preview) this.preview.attr({ x: point.x, y: point.y })
    }
    this.onCancel = () => this.cleanup()
    this.onModeChanged = () => this.cleanup()
  }

  start(file, point) {
    if (this.editor.mode !== 'model') {
      this.dispatchSignal('terminalLogged', { msg: 'Images can only be imported in Model Space.' })
      return
    }
    this.editor.isInteracting = true
    this.editor.selectSingleElement = true
    this.signals.commandCancelled.add(this.onCancel)
    this.signals.documentSessionReset.add(this.onCancel)
    this.signals.editorModeChanged.add(this.onModeChanged)
    if (file) return this.load(file, point)

    this.dispatchSignal('terminalLogged', { msg: 'IMAGE: Choose a PNG, JPEG, GIF or WebP image.' })
    const input = document.createElement('input')
    this.input = input
    input.type = 'file'
    input.accept = IMAGE_FILE_ACCEPT
    input.hidden = true
    input.dataset.imageImport = ''
    input.setAttribute('aria-label', 'Import image')
    this.onFileChange = () => {
      const selected = input.files?.[0]
      this.removePicker()
      if (selected) this.load(selected)
      else this.cleanup()
    }
    input.addEventListener('change', this.onFileChange)
    input.addEventListener('cancel', this.onCancel)
    document.body.appendChild(input)
    try {
      input.click()
    } catch (error) {
      this.fail(error)
    }
  }

  isCurrent() {
    return !this.closed && this.ownsCommandSession()
      && this.editor.mode === 'model'
      && this.editor.documentState?.sessionId === this.sessionId
  }

  async load(file, point) {
    try {
      this.dispatchSignal('terminalLogged', { msg: 'Loading image…' })
      this.image = await readRasterImage(file, { signal: this.abortController.signal })
      if (!this.isCurrent()) return this.cleanup()
      const view = this.editor.svg.viewbox()
      const scale = Math.min(1, view.width / (2 * this.image.width), view.height / (2 * this.image.height))
      this.width = this.image.width * scale
      this.height = this.image.height * scale
      if (!(this.width > 0 && this.height > 0)) throw new Error('The viewport has no usable image area.')
      if (point) {
        if (!validPoint(point)) throw new Error('The drop position is outside the drawing limits.')
        return this.place(point)
      }

      this.previewRoot = this.editor.svg.group().attr({
        'data-nanquim-transient': 'true',
        'pointer-events': 'none',
      })
      this.preview = this.makeElement(this.editor.coordinates || { x: 0, y: 0 })
      this.previewRoot.add(this.preview)
      this.preview.attr({ opacity: 0.6, 'pointer-events': 'none' })
      this.signals.updatedCoordinates.add(this.onMove)
      this.signals.pointCaptured.add(this.onPoint)
      this.signals.coordinateInput.add(this.onCoordinate)
      this.dispatchSignal('terminalLogged', {
        msg: 'Specify image upper-left corner: click or type @x,y / #x,y. Esc cancels. ',
        recordInput: true,
      })
      document.getElementById('terminalInput')?.focus({ preventScroll: true })
    } catch (error) {
      this.fail(error)
    }
  }

  makeElement(point) {
    return this.editor.overlays.image().attr({
      href: this.image.href,
      width: this.width,
      height: this.height,
      x: point.x,
      y: point.y,
      name: this.image.name,
      preserveAspectRatio: 'xMidYMid meet',
      'data-nanquim-transient': 'true',
    })
  }

  place(point) {
    if (!this.isCurrent()) return this.cleanup()
    if (!validPoint(point)) {
      this.dispatchSignal('terminalLogged', { msg: 'Enter finite image coordinates within the drawing limits.' })
      return
    }
    let element
    try {
      const parent = this.drawing
      if (!this.editor.drawing.node.contains(parent.node)) throw new Error('Choose a Model Space collection.')
      element = this.makeElement(point).remove()
      this.prepareElement(element, parent)
      this.validateCandidate(element, parent)
      this.editor.execute(new AddImageCommand(this.editor, element, parent))
      this.dispatchSignal('terminalLogged', { msg: 'Image imported. Use SCALE to resize it.' })
      this.cleanup()
    } catch (error) {
      element?.remove()
      this.fail(error)
    }
  }

  prepareElement(element, parent) {
    const matrix = new Matrix(getParentToRootMatrix({ parent: () => parent }, this.editor.svg)).inverse()
    // Keep ordinary images free of transform attributes so geometry commands
    // can resize them. Cancel a transformed collection's matrix when needed.
    if (!matrix.equals(new Matrix())) element.matrix(matrix)
    const stagingParent = new parent.constructor(parent.node.cloneNode(false))
    stagingParent.add(element)
    try {
      applyCollectionStyleToElement(this.editor, element)
      element.attr({ id: this.editor.elementIndex, 'data-nanquim-transient': null })
    } finally {
      element.remove()
    }
  }

  validateCandidate(element, parent) {
    // Build and validate the complete detached document, including the proposed
    // image, before changing persistent geometry or History. Only this session's
    // placement flag is bypassed; the canonical serializer handles everything else.
    const candidate = buildNativeDocument({
      ...this.editor,
      isInteracting: false,
      elementIndex: this.editor.elementIndex + 1,
    })
    const target = parent.node === this.editor.drawing.node
      ? candidate.documentElement
      : candidate.getElementById(parent.id())
    if (!target) throw new Error('The image destination is no longer available.')
    target.appendChild(candidate.importNode(element.node, true))
    const report = {}
    sanitizeSvgDocument(candidate, { deferStyleScoping: true, report })
    if (report.changed) throw new Error('The image exceeds supported SVG limits.')
    assertDocumentSourceSize(`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(candidate.documentElement)}\n`)
  }

  fail(error) {
    if (this.isCurrent() && error?.name !== 'AbortError') {
      this.dispatchSignal('terminalLogged', { msg: `Image import failed: ${error.message}` })
    }
    this.cleanup()
  }

  removePicker() {
    if (!this.input) return
    this.input.removeEventListener('change', this.onFileChange)
    this.input.removeEventListener('cancel', this.onCancel)
    this.input.remove()
    this.input = null
  }

  cleanup() {
    if (this.closed) return
    this.closed = true
    this.abortController.abort()
    this.removePicker()
    this.preview?.remove()
    this.previewRoot?.remove()
    this.preview = null
    this.previewRoot = null
    this.signals.commandCancelled.remove(this.onCancel)
    this.signals.documentSessionReset.remove(this.onCancel)
    this.signals.editorModeChanged.remove(this.onModeChanged)
    this.signals.updatedCoordinates.remove(this.onMove)
    this.signals.pointCaptured.remove(this.onPoint)
    this.signals.coordinateInput.remove(this.onCoordinate)
    if (this.ownsCommandSession()) {
      this.editor.isInteracting = false
      this.editor.selectSingleElement = false
      this.editor.inputCoord = null
      this.editor.inputCoordMode = 'absolute'
    }
  }
}

function imageCommand(editor) {
  new ImageImportSession(editor).start()
}

function importImageFile(editor, file, point) {
  return new ImageImportSession(editor).start(file, point)
}

export { AddImageCommand, ImageImportSession, imageCommand, importImageFile }
