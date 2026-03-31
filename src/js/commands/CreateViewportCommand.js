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

async function createViewportCommand(editor, args) {
  const signals = editor.signals

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

    // ── Step 2: Opposite corner ───────────────────────────────────────────────
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Specify opposite corner:' })

    let ghostRect = null
    let ghostUpdater = null

    ghostRect = editor.paperSvg.rect(0, 0)
      .fill('rgba(100,150,255,0.15)')
      .stroke('#5599ff')
      .attr('stroke-width', 0.04)
      .attr('stroke-dasharray', '0.2 0.1')

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
      p2 = await _capturePointOnPaper(editor)
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
      const num = parseFloat(input)
      if (!isNaN(num) && num > 0) scale = num
    } catch {
      // Default scale
    }

    // ── Create the viewport ───────────────────────────────────────────────────
    const vp = editor.paperEditor.createViewport(x, y, w, h, scale)
    signals.terminalLogged.dispatch({
      type: 'span',
      msg: `VP: Created viewport ${vp.id} (${w.toFixed(2)}×${h.toFixed(2)} cm) at 1:${scale}`
    })
  } catch (err) {
    if (err.message !== 'cancelled') console.error(err)
  } finally {
    editor.isInteracting = false
    signals.updatedOutliner.dispatch()
  }
}

/**
 * Capture a single click on the paper SVG canvas, returning SVG coordinates.
 */
function _capturePointOnPaper(editor) {
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
      resolve(editor.inputCoord)
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

export { createViewportCommand }
