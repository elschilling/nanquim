import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'

class OffsetCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'OffsetCommand'
    this.name = 'Offset'
    this.distance = null
    this.selectedElement = null

    // Bind handlers
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnElementSelected = this.onElementSelected.bind(this)
    this.boundOnConfirmPoint = this.onConfirmPoint.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({ type: 'span', msg: `Enter a distance to offset` })
    this.editor.isInteracting = true
    this.editor.signals.inputValue.addOnce(this.onDistanceInput, this)
    document.addEventListener('keydown', this.boundOnKeyDown)
  }

  onDistanceInput() {
    const d = parseFloat(this.editor.distance)
    if (isNaN(d) || d <= 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid distance. Command cancelled.' })
      return this.cleanup()
    }
    this.distance = d
    this.editor.signals.terminalLogged.dispatch({ msg: `Offset distance: ${this.distance}. Select one element.` })
    this.startSelection()
  }

  startSelection() {
    this.editor.signals.clearSelection.dispatch()
    this.editor.selectSingleElement = true
    this.editor.isInteracting = false
    this.editor.signals.toogledSelect.addOnce(this.boundOnElementSelected)
  }

  onElementSelected(el) {
    if (!el) return
    this.selectedElement = el

    // Start ghosting in viewport with fixed distance
    this.editor.signals.offsetGhostingStarted.dispatch([this.selectedElement], this.distance)

    // Now capture click to confirm side
    this.editor.isInteracting = true
    this.editor.signals.terminalLogged.dispatch({ msg: 'Move mouse to choose side, click to confirm.' })
    this.editor.signals.pointCaptured.addOnce(this.boundOnConfirmPoint)
  }

  onConfirmPoint(point) {
    if (!this.selectedElement) return this.cleanup()

    const clone = this.selectedElement.clone()
    clone.putIn(this.editor.drawing)

    // For circles/rects, resize instead of translate
    if (this.selectedElement.type === 'circle') {
      const cx = this.selectedElement.cx()
      const cy = this.selectedElement.cy()
      const r = this.selectedElement.radius ? this.selectedElement.radius() : this.selectedElement.attr('r')
      const dx = point.x - cx
      const dy = point.y - cy
      const dist = Math.hypot(dx, dy)
      const inward = dist < (typeof r === 'number' ? r : parseFloat(r))
      const newR = Math.max(0, (typeof r === 'number' ? r : parseFloat(r)) + (inward ? -this.distance : this.distance))
      clone.center(cx, cy)
      if (clone.radius) clone.radius(newR)
      else clone.attr('r', newR)
    } else if (this.selectedElement.type === 'rect') {
      const x = this.selectedElement.x()
      const y = this.selectedElement.y()
      const w = this.selectedElement.width()
      const h = this.selectedElement.height()
      const cx = x + w / 2
      const cy = y + h / 2
      const inside = point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
      const delta = inside ? -this.distance : this.distance
      const newW = Math.max(0, w + 2 * delta)
      const newH = Math.max(0, h + 2 * delta)
      const newX = cx - newW / 2
      const newY = cy - newH / 2
      clone.size(newW, newH)
      clone.move(newX, newY)
    } else {
      // Compute offset direction relative to the selected element and click position
      const { dx, dy } = this.computeOffsetVector(this.selectedElement, point, this.distance)
      try {
        this.applyOffsetToElement(clone, dx, dy)
      } catch (e) {
        const t = clone.transform ? clone.transform() : {}
        if (clone.transform) clone.transform(t).translate(dx, dy)
      }
    }

    // Assign id/name
    clone.attr('id', this.editor.elementIndex++)
    if (this.selectedElement.attr && this.selectedElement.attr('name')) {
      clone.attr('name', this.selectedElement.attr('name'))
    }

    // Record into history for undo/redo
    this.editor.execute(new AddElementCommand(this.editor, clone))
    this.updatedOutliner()

    // Stop ghosting for this element and allow another selection
    this.editor.signals.offsetGhostingStopped.dispatch()
    this.selectedElement = null
    this.editor.isInteracting = false
    this.editor.signals.terminalLogged.dispatch({ msg: `Created offset element.` })

    // Allow multiple offsets with same distance
    this.startSelection()
  }

  applyOffsetToElement(element, dx, dy) {
    if (!element || !element.type) return
    switch (element.type) {
      case 'line': {
        const pts = element.array().map(([x, y]) => [x + dx, y + dy])
        element.plot(pts)
        break
      }
      case 'circle':
      case 'ellipse': {
        element.center(element.cx() + dx, element.cy() + dy)
        break
      }
      case 'rect': {
        element.move(element.x() + dx, element.y() + dy)
        break
      }
      case 'polygon':
      case 'polyline': {
        const pts = element.array().map(([x, y]) => [x + dx, y + dy])
        element.plot(pts)
        break
      }
      default: {
        const t = element.transform ? element.transform() : {}
        if (element.transform) element.transform(t).translate(dx, dy)
      }
    }
  }

  computeOffsetVector(element, mouse, distance) {
    const normalize = (vx, vy) => {
      const len = Math.hypot(vx, vy) || 1
      return { x: vx / len, y: vy / len }
    }
    const signForPerp = (center, perp) => {
      const toMouseX = mouse.x - center.x
      const toMouseY = mouse.y - center.y
      const proj = toMouseX * perp.x + toMouseY * perp.y
      return proj >= 0 ? 1 : -1
    }
    try {
      if (element.type === 'line') {
        const arr = element.array()
        const [x1, y1] = arr[0]
        const [x2, y2] = arr[1]
        const dir = normalize(x2 - x1, y2 - y1)
        const perp = { x: -dir.y, y: dir.x }
        const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
        const s = signForPerp(center, perp)
        return { dx: perp.x * distance * s, dy: perp.y * distance * s }
      }
      if (element.type === 'rect') {
        const center = { x: element.x() + element.width() / 2, y: element.y() + element.height() / 2 }
        const dxm = mouse.x - center.x
        const dym = mouse.y - center.y
        if (Math.abs(dym) >= Math.abs(dxm)) {
          const s = dym >= 0 ? 1 : -1
          return { dx: 0, dy: distance * s }
        } else {
          const s = dxm >= 0 ? 1 : -1
          return { dx: distance * s, dy: 0 }
        }
      }
      if (element.type === 'circle' || element.type === 'ellipse') {
        const dir = normalize(mouse.x - element.cx(), mouse.y - element.cy())
        return { dx: dir.x * distance, dy: dir.y * distance }
      }
      // Default
      return { dx: 0, dy: distance }
    } catch (e) {
      return { dx: 0, dy: 0 }
    }
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.editor.signals.offsetGhostingStopped.dispatch()
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    this.editor.signals.pointCaptured.remove(this.boundOnConfirmPoint)
    this.editor.isInteracting = false
    this.editor.selectSingleElement = false
    this.editor.distance = null
  }

  undo() {}
  redo() {}
}

function offsetCommand(editor) {
  const offsetCmd = new OffsetCommand(editor)
  offsetCmd.execute()
}

export { offsetCommand }
