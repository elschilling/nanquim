import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'

class DrawPolylineCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'DrawPolylineCommand'
    this.name = 'Polyline'
    this.drawing = this.editor.activeCollection
    this.points = []
    this.polyline = null
    this.ghostLine = null
    this.boundHandleMove = this.handleMove.bind(this)
    this.boundHandleClick = this.handleClick.bind(this)
    this.boundHandleRightClick = this.handleRightClick.bind(this)
    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
    this.boundCancelDrawing = () => this.cleanup()
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW POLYLINE ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: 'Click to add points. Enter/Right-click to finish, Esc to cancel.',
    })
    this.editor.setIsDrawing(true)

    const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
    activeSvg.on('mousedown.polyline', this.boundHandleClick)
    document.addEventListener('mousemove', this.boundHandleMove)
    document.addEventListener('contextmenu', this.boundHandleRightClick, true)
    document.addEventListener('keydown', this.boundHandleKeyDown)
    activeSvg.on('cancelDrawing.polyline', this.boundCancelDrawing)
  }

  handleKeyDown(e) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
      this.finalizePolyline()
    } else if (e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Polyline cancelled.' })
    }
  }

  handleRightClick(e) {
    e.preventDefault()
    e.stopImmediatePropagation()
    this.finalizePolyline()
  }

  handleClick(e) {
    if (e.button !== 0) return

    const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
    const point = this.editor.snapPoint || activeSvg.point(e.pageX, e.pageY)
    this.points.push([point.x, point.y])

    if (this.points.length === 1) {
      this.polyline = this.drawing
        .polyline(this.points)
        .fill('none')
      applyCollectionStyleToElement(this.editor, this.polyline)

      this.editor.signals.terminalLogged.dispatch({
        type: 'span',
        msg: 'Point 1 set. Click to add more points.',
      })
    } else {
      this.polyline.plot(this.points)
      this.editor.signals.terminalLogged.dispatch({
        type: 'span',
        msg: `Point ${this.points.length} set.`,
      })
    }
  }

  handleMove(e) {
    if (this.points.length === 0 || !this.polyline) return

    const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
    const point = this.editor.snapPoint || activeSvg.point(e.pageX, e.pageY)

    // Show preview segment from last placed point to cursor
    const preview = [...this.points, [point.x, point.y]]
    this.polyline.plot(preview)
  }

  finalizePolyline() {
    if (this.points.length < 2) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Need at least 2 points. Polyline cancelled.' })
      this.cleanup()
      return
    }

    this.polyline.plot(this.points)
    this.polyline.attr('id', this.editor.elementIndex++)
    this.polyline.attr('name', 'Polyline')

    this.editor.history.undos.push(new AddElementCommand(this.editor, this.polyline))
    this.editor.lastCommand = this
    this.updatedOutliner()

    this.editor.signals.terminalLogged.dispatch({ msg: `Polyline created with ${this.points.length} points.` })

    this.polyline = null
    this.cleanupListeners()
    this.editor.setIsDrawing(false)
  }

  cleanupListeners() {
    const activeSvg = this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
    activeSvg.off('mousedown.polyline')
    activeSvg.off('cancelDrawing.polyline')
    document.removeEventListener('mousemove', this.boundHandleMove)
    document.removeEventListener('contextmenu', this.boundHandleRightClick, true)
    document.removeEventListener('keydown', this.boundHandleKeyDown)
  }

  cleanup() {
    this.cleanupListeners()
    this.editor.setIsDrawing(false)
    this.points = []

    if (this.polyline) {
      this.polyline.remove()
      this.polyline = null
    }
  }
}

function drawPolylineCommand(editor) {
  const cmd = new DrawPolylineCommand(editor)
  cmd.execute()
}

export { drawPolylineCommand }
