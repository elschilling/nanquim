import { Command } from '../Command'
import { applyCollectionStyleToElement } from '../Collection'

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
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Click to start drawing a ${this.name} or type (x,y) coordinates `,
    })
    this.editor.setIsDrawing(true)
    this.draw()
  }

  draw() {
    const rect = this.drawing
      .rect()
      .fill('none')
      .attr('id', this.editor.elementIndex++)
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
          this.updatedOutliner()
          this.editor.setIsDrawing(false)
        }
      })
  }

  onDimensionKey(e) {
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault()
      document.removeEventListener('keydown', this.boundOnDimensionKey)
      this._enterDimensionMode()
    }
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

    this.editor.signals.terminalLogged.dispatch({ msg: 'Width: ' })

    this.editor.signals.inputValue.addOnce((wVal) => {
      const w = parseFloat(wVal)
      if (isNaN(w) || w <= 0) {
        this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid width. Command cancelled.' })
        this.editor.isInteracting = false
        return
      }

      this.editor.signals.terminalLogged.dispatch({ msg: 'Height: ' })

      Promise.resolve().then(() => {
        this.editor.signals.inputValue.addOnce((hVal) => {
          const h = parseFloat(hVal)
          if (isNaN(h) || h <= 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid height. Command cancelled.' })
            this.editor.isInteracting = false
            return
          }

          this._waitForPlacement(startPoint, w, h)
        })
      })
    })
  }

  _waitForPlacement(startPoint, w, h) {
    const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg

    // Ghost lives directly in the SVG root so it's invisible to the selection/snap/hover systems
    const ghost = activeSvg.rect(w, h)
      .fill('none')
      .attr({
        stroke: '#8ab4f8',
        'stroke-width': 1,
        'stroke-dasharray': '4 4',
        'vector-effect': 'non-scaling-stroke',
        opacity: 0.7,
      })
      .move(startPoint.x, startPoint.y)

    // Which corner of the rect sits at startPoint depends on where the cursor is
    const getRectOrigin = (cursor) => ({
      x: cursor.x >= startPoint.x ? startPoint.x : startPoint.x - w,
      y: cursor.y >= startPoint.y ? startPoint.y : startPoint.y - h,
    })

    const onMouseMove = (e) => {
      const raw = activeSvg.point(e.pageX, e.pageY)
      const cursor = this.editor.snapPoint || raw
      const { x, y } = getRectOrigin(cursor)
      ghost.move(x, y)
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove)
      ghost.remove()
      this.editor.signals.pointCaptured.remove(onPlace, this)
      this.editor.signals.commandCancelled.remove(onCancel, this)
      this.editor.isInteracting = false
      setTimeout(() => { this.editor.selectSingleElement = false }, 10)
    }

    const onPlace = (point) => {
      const { x, y } = getRectOrigin(point)
      cleanup()

      const newRect = this.drawing
        .rect(w, h)
        .move(x, y)
        .fill('none')
        .attr('id', this.editor.elementIndex++)
      applyCollectionStyleToElement(this.editor, newRect)

      this.editor.signals.terminalLogged.dispatch({ msg: `Rectangle ${w} × ${h} placed.` })
      this.updatedOutliner()
    }

    const onCancel = () => cleanup()

    document.addEventListener('mousemove', onMouseMove)
    this.editor.selectSingleElement = true
    this.editor.signals.pointCaptured.addOnce(onPlace, this)
    this.editor.signals.commandCancelled.addOnce(onCancel, this)

    this.editor.signals.terminalLogged.dispatch({ msg: 'Click to place the rectangle.' })
  }
}

function drawRectangleCommand(editor) {
  const rectangleCommand = new DrawRectangleCommand(editor)
  rectangleCommand.execute()
}

export { drawRectangleCommand }
