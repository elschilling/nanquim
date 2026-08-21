/**
 * CreateViewportCommand.js
 *
 * Command to create a viewport region in Paper Space.
 * Alias: 'vp'
 *
 * Workflow:
 *  1. "Specify first corner of viewport:"
 *  2. User clicks point 1
 *  3. "Specify opposite corner:"
 *  4. User clicks point 2 → creates viewport rectangle
 *  5. "Enter scale (e.g. 100 for 1:100):" → sets scale, defaults to 100
 */

import { resolveInputCoordinate } from '../utils/coordinateInput'
import { Command } from '../Command'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'

class CreateViewportCommand extends Command {
  constructor(editor, { x, y, w, h, scale = 100 }) {
    super(editor)
    this.type = 'CreateViewportCommand'
    this.name = 'Create Viewport'
    this.requestedState = { x, y, w, h, scale }
    this.viewportState = null
    this.viewport = null
    this.selectionBefore = [...editor.selected]
    this.selectionApplied = null
  }

  execute() {
    const restoring = this.viewportState !== null
    const state = this.viewportState || this.requestedState
    const options = this.viewportState
      ? {
          id: state.id,
          locked: state.locked,
          modelOriginX: state.modelOriginX,
          modelOriginY: state.modelOriginY,
          visible: state.visible,
        }
      : {}

    const previousViewport = this.viewport
    const previousState = this.viewportState
    const previousSelectionApplied = this.selectionApplied
    const selectionAtStart = [...this.editor.selected]
    try {
      this.viewport = this.editor.paperEditor.createViewport(
        state.x,
        state.y,
        state.w,
        state.h,
        state.scale,
        { ...options, notify: false, silent: true },
      )

      if (!this.viewportState) {
        this.viewportState = {
          h: this.viewport.h,
          id: this.viewport.id,
          locked: this.viewport.locked === true,
          modelOriginX: this.viewport.modelOriginX,
          modelOriginY: this.viewport.modelOriginY,
          scale: this.viewport.scale,
          visible: this.viewport.visible !== false,
          w: this.viewport.w,
          x: this.viewport.x,
          y: this.viewport.y,
        }
      }
      if (!this.selectionApplied) this.selectionApplied = [...this.editor.selected]
      else if (restoring) this.editor.selected = [...this.selectionApplied]
      invalidateSpatialIndexes(this.editor)
    } catch (error) {
      const rollbackErrors = []
      if (this.viewport) {
        try {
          this.editor.paperEditor.removeViewport(this.viewport.id, {
            notify: false,
            silent: true,
          })
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      this.viewport = previousViewport
      this.viewportState = previousState
      this.selectionApplied = previousSelectionApplied
      this.editor.selected = selectionAtStart
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `${error.message} Removing the incomplete Paper viewport also failed.`,
        )
      }
      throw error
    }
    this.dispatchSignal('paperViewportsChanged')
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedProperties')
  }

  undo() {
    if (!this.viewportState) return
    const removed = this.editor.paperEditor.removeViewport(this.viewportState.id, {
      notify: false,
      silent: true,
    })
    if (!removed) throw new Error(`Paper viewport "${this.viewportState.id}" is unavailable.`)
    this.viewport = null
    this.editor.selected = [...this.selectionBefore]
    invalidateSpatialIndexes(this.editor)
    this.dispatchSignal('paperViewportsChanged')
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedProperties')
  }

  redo() {
    this.execute()
  }
}

async function createViewportCommand(editor, args) {
  const signals = editor.signals
  const sessionRevision = editor.commandSessionRevision
  const assertCurrentSession = () => {
    if (editor.commandSessionRevision !== sessionRevision) {
      throw new Error('cancelled')
    }
  }

  // Only available in paper mode
  if (editor.mode !== 'paper') {
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP command only available in Paper Space. Switch mode first.' })
    return
  }

  if (!editor.paperEditor) {
    signals.terminalLogged.dispatch({ type: 'span', msg: 'Paper editor not initialized.' })
    return
  }

  editor.isInteracting = true // Lock the terminal for the entire command flow

  try {
    // ── Step 1: First corner ──────────────────────────────────────────────────
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Specify first corner of viewport:' })
    const p1 = await _capturePointOnPaper(editor)
    assertCurrentSession()

    // ── Step 2: Opposite corner ───────────────────────────────────────────────
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Specify opposite corner:' })

    let ghostRect = null
    let ghostUpdater = null

    ghostRect = editor.paperSvg.rect(0, 0)
      .fill('rgba(100,150,255,0.15)')
      .stroke('#5599ff')
      .attr('stroke-width', 'var(--helper-stroke-width, 0.2)')
      .attr('stroke-dasharray', '0.2 0.1')
      .attr('data-nanquim-transient', 'true')

    ghostUpdater = (e) => {
      const pt = _screenToPaperSVG(editor, e.clientX, e.clientY)
      const rx = Math.min(p1.x, pt.x)
      const ry = Math.min(p1.y, pt.y)
      const rw = Math.abs(pt.x - p1.x)
      const rh = Math.abs(pt.y - p1.y)
      ghostRect.move(rx, ry).size(rw, rh)
    }
    editor.paperSvg.node.addEventListener('mousemove', ghostUpdater)

    let p2
    try {
      p2 = await _capturePointOnPaper(editor, p1)
      assertCurrentSession()
    } finally {
      if (ghostRect) ghostRect.remove()
      if (ghostUpdater) editor.paperSvg.node.removeEventListener('mousemove', ghostUpdater)
    }

    const x = Math.min(p1.x, p2.x)
    const y = Math.min(p1.y, p2.y)
    const w = Math.abs(p2.x - p1.x)
    const h = Math.abs(p2.y - p1.y)

    if (w < 0.1 || h < 0.1) {
      signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Viewport too small. Cancelled.' })
      return
    }

    // ── Step 3: Scale input ───────────────────────────────────────────────────
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Enter scale denominator (e.g. 100 for 1:100) [100]:' })

    let scale = 100
    try {
      const input = await _captureScaleInput(editor)
      assertCurrentSession()
      const num = parseFloat(input)
      if (!isNaN(num) && num > 0) scale = num
    } catch (error) {
      if (error?.message === 'cancelled') throw error
      // Keep the documented default if the terminal input source disappears.
    }

    // ── Create the viewport ───────────────────────────────────────────────────
    assertCurrentSession()
    const command = new CreateViewportCommand(editor, { x, y, w, h, scale })
    editor.execute(command)
    const vp = command.viewport
    const configuredUnitsPerCm = Number(editor.paperConfig?.unitsPerCm)
    const unitsPerCm = Number.isFinite(configuredUnitsPerCm) && configuredUnitsPerCm > 0
      ? configuredUnitsPerCm
      : 1
    signals.terminalLogged.dispatch({
      type: 'span',
      msg: `VP: Created viewport ${vp.id} (${(w / unitsPerCm).toFixed(2)}×${(h / unitsPerCm).toFixed(2)} cm) at 1:${scale}`
    })
  } catch (err) {
    if (err.message !== 'cancelled') console.error(err)
  } finally {
    if (editor.commandSessionRevision === sessionRevision) {
      editor.isInteracting = false
      try {
        signals.updatedOutliner.dispatch()
      } catch (error) {
        try { console.error('[CreateViewportCommand] updatedOutliner listener failed:', error) } catch (_reportError) {}
      }
    }
  }
}

/**
 * Capture a single click on the paper SVG canvas, returning SVG coordinates.
 */
function _capturePointOnPaper(editor, referencePoint) {
  return new Promise((resolve, reject) => {
    const paperSvgNode = editor.paperSvg.node

    const onCancel = () => {
      cleanup()
      reject(new Error('cancelled'))
    }

    const onClick = (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const pt = _screenToPaperSVG(editor, e.clientX, e.clientY)
      cleanup()
      resolve(pt)
    }

    const onCoord = () => {
      cleanup()
      resolve(resolveInputCoordinate(editor, referencePoint))
    }

    const cleanup = () => {
      paperSvgNode.removeEventListener('click', onClick)
      editor.signals.commandCancelled.remove(onCancel)
      editor.signals.coordinateInput.remove(onCoord)
    }

    paperSvgNode.addEventListener('click', onClick)
    editor.signals.commandCancelled.addOnce(onCancel)
    editor.signals.coordinateInput.addOnce(onCoord)
    
    // Ensure terminal has focus
    const term = document.getElementById('terminalInput')
    if (term) term.focus()
  })
}

/**
 * Capture a text input from the terminal for the scale value.
 */
function _captureScaleInput(editor) {
  return new Promise((resolve, reject) => {
    const term = document.getElementById('terminalInput')
    if (term) {
      term.value = ''
      term.focus()
    }

    const onInput = (val) => {
      cleanup()
      resolve(val)
    }

    const onCancel = () => {
      cleanup()
      reject(new Error('cancelled'))
    }

    const cleanup = () => {
      editor.signals.inputValue.remove(onInput)
      editor.signals.commandCancelled.remove(onCancel)
    }

    editor.signals.inputValue.addOnce(onInput)
    editor.signals.commandCancelled.addOnce(onCancel)
  })
}

/**
 * Convert screen (client) coordinates to paper SVG coordinates.
 */
function _screenToPaperSVG(editor, clientX, clientY) {
  const svgPt = editor.paperSvg.point(clientX, clientY)
  return { x: svgPt.x, y: svgPt.y }
}

export { CreateViewportCommand, createViewportCommand }
