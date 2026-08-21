import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'
import { resolveInputCoordinate } from '../utils/coordinateInput'

function getRectangleOrigin(startPoint, width, height, directionPoint = startPoint) {
  return {
    x: directionPoint.x >= startPoint.x ? startPoint.x : startPoint.x - width,
    y: directionPoint.y >= startPoint.y ? startPoint.y : startPoint.y - height,
  }
}

class DrawRectangleCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawRectangleCommand'
    this.name = 'Rectangle'
    this.draw = this.draw.bind(this)
    this.drawing = this.editor.activeCollection
    this.boundOnDimensionKey = this.onDimensionKey.bind(this)
    this._rect = null
    this._startPoint = null
    this._dimensionModeActive = false
    this._dimensionInputHandler = null
    this._dimensionCancelHandler = this._cancelDimensionMode.bind(this)
    this._dimensionPreview = null
    this._previewPositionHandler = null
    this._pointPlacementHandler = null
    this._coordinatePlacementHandler = null
    this._pointerCancelHandler = this._cancelPointerMode.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
    })
    this.editor.setIsDrawing(true)
    this.editor.signals.commandCancelled.addOnce(this._pointerCancelHandler, this)
    this.draw()
  }

  draw() {
    const rect = this.drawing
      .rect(0, 0)
      .fill('none')
      .attr({
        'data-nanquim-transient': 'true',
      })
    applyCollectionStyleToElement(this.editor, rect)
    this._rect = rect

    rect.draw()
      .on('drawstart', () => {
        const handler = rect.remember('_paintHandler')
        const sp = handler ? handler.startPoint : null
        this._startPoint = sp ? { x: sp.x, y: sp.y } : null

        this.editor.signals.terminalLogged.dispatch({
          type: 'span',
          msg: 'Specify second point or press D for dimensions.',
        })
        document.addEventListener('keydown', this.boundOnDimensionKey)
      })
      .on('drawstop', () => {
        document.removeEventListener('keydown', this.boundOnDimensionKey)
        if (!this._dimensionModeActive) {
          rect.attr('name', 'Rectangle')
          this.editor.execute(new AddElementCommand(this.editor, rect))
          this.updatedOutliner()
          this.editor.setIsDrawing(false)
          this.editor.signals.commandCancelled.remove(this._pointerCancelHandler, this)
          this._rect = null
        }
      })
  }

  onDimensionKey(e) {
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault()
      document.removeEventListener('keydown', this.boundOnDimensionKey)
      this.editor.signals.commandCancelled.remove(this._pointerCancelHandler, this)
      this._enterDimensionMode()
    }
  }

  _cancelPointerMode() {
    document.removeEventListener('keydown', this.boundOnDimensionKey)
    this.editor.signals.commandCancelled.remove(this._pointerCancelHandler, this)
    if (this._rect) {
      try { this._rect.draw('cancel') } catch (_) { this._rect.remove() }
      this._rect = null
    }
    this.editor.setIsDrawing(false)
  }

  _enterDimensionMode() {
    const startPoint = this._startPoint
    if (!startPoint) return

    this._dimensionModeActive = true

    // Cancel the interactive draw plugin — removes the preview rect from the DOM
    if (this._rect) {
      try { this._rect.draw('cancel') } catch (_) {}
      this._rect = null
    }

    this.editor.setIsDrawing(false)
    this.editor.isInteracting = true
    this.editor.signals.commandCancelled.addOnce(this._dimensionCancelHandler, this)

    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: 'Width: ',
      recordInput: true,
    })

    this._dimensionInputHandler = (wVal) => {
      this._dimensionInputHandler = null
      const w = parseFloat(wVal)
      if (isNaN(w) || w <= 0) {
        this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid width. Command cancelled.' })
        this._finishDimensionMode()
        return
      }

      this.editor.signals.terminalLogged.dispatch({
        type: 'span',
        msg: 'Height: ',
        recordInput: true,
      })

      Promise.resolve().then(() => {
        if (!this._dimensionModeActive) return

        this._dimensionInputHandler = (hVal) => {
          this._dimensionInputHandler = null
          const h = parseFloat(hVal)
          if (isNaN(h) || h <= 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid height. Command cancelled.' })
            this._finishDimensionMode()
            return
          }

          this._waitForPlacement(startPoint, w, h)
        }
        this.editor.signals.inputValue.addOnce(this._dimensionInputHandler, this)
      })
    }
    this.editor.signals.inputValue.addOnce(this._dimensionInputHandler, this)
  }

  _waitForPlacement(startPoint, w, h) {
    const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg

    // The first point stays fixed as one of the rectangle's corners. The
    // cursor selects which of the four quadrants contains the rectangle.
    const getOrigin = (directionPoint) => getRectangleOrigin(startPoint, w, h, directionPoint)

    // Build the preview in the active collection so it receives exactly the
    // same style as the rectangle that will be committed, then move it to the
    // SVG root so selection, snapping, and hover systems ignore it.
    const ghost = this.drawing.rect(w, h)
      .fill('none')
      .attr({
        'data-rectangle-preview': 'true',
        'pointer-events': 'none',
      })
    applyCollectionStyleToElement(this.editor, ghost)
    ghost.addTo(activeSvg)

    this._dimensionPreview = ghost

    this._previewPositionHandler = (directionPoint) => {
      const cursor = directionPoint || this.editor.snapPoint || this.editor.coordinates || startPoint
      const { x, y } = getOrigin(cursor)
      ghost.move(x, y)
    }

    // `updatedCoordinates` is dispatched after grid/object snapping is applied.
    // Position once immediately as well, so confirming Height updates the
    // canvas without waiting for another mousemove.
    this.editor.signals.updatedCoordinates.add(this._previewPositionHandler, this)
    this._previewPositionHandler(this.editor.snapPoint || this.editor.coordinates || startPoint)

    const commit = (directionPoint, deferSelectionReset) => {
      const { x, y } = getOrigin(directionPoint)
      this._finishDimensionMode(deferSelectionReset)

      const newRect = this.drawing
        .rect(w, h)
        .move(x, y)
        .fill('none')
        .attr({
          name: 'Rectangle',
        })
      applyCollectionStyleToElement(this.editor, newRect)

      this.editor.execute(new AddElementCommand(this.editor, newRect))
      this.editor.signals.terminalLogged.dispatch({ msg: `Rectangle ${w} × ${h} placed.` })
      this.updatedOutliner()
    }

    this._pointPlacementHandler = (point) => commit(point, true)
    this._coordinatePlacementHandler = () => {
      commit(resolveInputCoordinate(this.editor, startPoint), false)
    }

    this.editor.selectSingleElement = true
    this.editor.signals.pointCaptured.addOnce(this._pointPlacementHandler, this)
    this.editor.signals.coordinateInput.addOnce(this._coordinatePlacementHandler, this)

    this.editor.signals.terminalLogged.dispatch({
      msg: 'Move the cursor to choose the side of the start point, then click to place or type @x,y / #x,y.',
    })
  }

  _cancelDimensionMode() {
    this._finishDimensionMode()
  }

  _finishDimensionMode(deferSelectionReset = false) {
    document.removeEventListener('keydown', this.boundOnDimensionKey)

    if (this._dimensionInputHandler) {
      this.editor.signals.inputValue.remove(this._dimensionInputHandler, this)
      this._dimensionInputHandler = null
    }
    if (this._previewPositionHandler) {
      this.editor.signals.updatedCoordinates.remove(this._previewPositionHandler, this)
      this._previewPositionHandler = null
    }
    if (this._pointPlacementHandler) {
      this.editor.signals.pointCaptured.remove(this._pointPlacementHandler, this)
      this._pointPlacementHandler = null
    }
    if (this._coordinatePlacementHandler) {
      this.editor.signals.coordinateInput.remove(this._coordinatePlacementHandler, this)
      this._coordinatePlacementHandler = null
    }

    this.editor.signals.commandCancelled.remove(this._dimensionCancelHandler, this)

    if (this._dimensionPreview) {
      this._dimensionPreview.remove()
      this._dimensionPreview = null
    }

    this._dimensionModeActive = false
    this.editor.isInteracting = false
    this.editor.setIsDrawing(false)

    const resetSelectionMode = () => { this.editor.selectSingleElement = false }
    if (deferSelectionReset) this.deferSessionTask(resetSelectionMode, 0)
    else resetSelectionMode()
  }
}

function drawRectangleCommand(editor) {
  const rectangleCommand = new DrawRectangleCommand(editor)
  rectangleCommand.execute()
}

export { DrawRectangleCommand, drawRectangleCommand, getRectangleOrigin }
