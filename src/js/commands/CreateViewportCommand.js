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

  // ── Step 1: First corner ──────────────────────────────────────────────────
  signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Specify first corner of viewport:' })

  let p1 = null
  try {
    p1 = await _capturePointOnPaper(editor)
  } catch {
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Cancelled.' })
    return
  }

  // ── Step 2: Opposite corner ───────────────────────────────────────────────
  signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Specify opposite corner:' })

  let p2 = null
  let ghostRect = null
  let ghostUpdater = null

  try {
    // Draw a ghost rectangle following the mouse
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

    p2 = await _capturePointOnPaper(editor)
  } catch {
    if (ghostRect) ghostRect.remove()
    if (ghostUpdater) editor.paperSvg.node.removeEventListener('mousemove', ghostUpdater)
    signals.terminalLogged.dispatch({ type: 'span', msg: 'VP: Cancelled.' })
    return
  }

  if (ghostRect) ghostRect.remove()
  if (ghostUpdater) editor.paperSvg.node.removeEventListener('mousemove', ghostUpdater)

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
    // Default scale if cancelled or empty
  }

  // ── Create the viewport ───────────────────────────────────────────────────
  const vp = editor.paperEditor.createViewport(x, y, w, h, scale)
  signals.terminalLogged.dispatch({
    type: 'span',
    msg: `VP: Created viewport ${vp.id} (${w.toFixed(2)}×${h.toFixed(2)} cm) at 1:${scale}`
  })
  signals.updatedOutliner.dispatch()
}

/**
 * Capture a single click on the paper SVG canvas, returning SVG coordinates.
 */
function _capturePointOnPaper(editor) {
  return new Promise((resolve, reject) => {
    const paperSvgNode = editor.paperSvg.node

    const onCancel = () => {
      paperSvgNode.removeEventListener('click', onClick)
      editor.signals.commandCancelled.remove(onCancel)
      reject(new Error('cancelled'))
    }

    const onClick = (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const pt = _screenToPaperSVG(editor, e.clientX, e.clientY)
      paperSvgNode.removeEventListener('click', onClick)
      editor.signals.commandCancelled.remove(onCancel)
      resolve(pt)
    }

    paperSvgNode.addEventListener('click', onClick)
    editor.signals.commandCancelled.add(onCancel)
  })
}

/**
 * Capture a text input from the terminal for the scale value.
 */
function _captureScaleInput(editor) {
  return new Promise((resolve, reject) => {
    editor.isInteracting = true

    const cleanup = () => {
      editor.isInteracting = false
      editor.signals.inputValue.remove(onInput)
      editor.signals.commandCancelled.remove(onCancel)
    }

    const onInput = (val) => {
      cleanup()
      resolve(val)
    }

    const onCancel = () => {
      cleanup()
      reject(new Error('cancelled'))
    }

    editor.signals.inputValue.add(onInput)
    editor.signals.commandCancelled.add(onCancel)
  })
}

/**
 * Convert screen (client) coordinates to paper SVG coordinates.
 */
function _screenToPaperSVG(editor, clientX, clientY) {
  const svgNode = editor.paperSvg.node
  const pt = svgNode.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const svgPt = pt.matrixTransform(svgNode.getScreenCTM().inverse())
  return { x: svgPt.x, y: svgPt.y }
}

export { createViewportCommand }
