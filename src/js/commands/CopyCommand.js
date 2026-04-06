import { Command } from '../Command'
import { calculateDeltaFromBasepoint, calculateLocalDelta } from '../utils/calculateDistance'

class CopyCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'CopyCommand'
    this.name = 'Copy'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnCopyStop = this.onCopyStop.bind(this)
    this.allCopiedElements = []  // All placed copies across all clicks (for undo)
    this.currentGhosts = []      // Ghost clones for the current (unplaced) copy
    this.interactiveExecutionDone = false
  }

  execute() {
    if (this.interactiveExecutionDone) return
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to copy and press Enter to confirm.`,
    })
    document.addEventListener('keydown', this.boundOnKeyDown)
    this.editor.suppressHandlers = true
    this.editor.handlers.clear()
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
  }

  onKeyDown(event) {
    if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
      document.removeEventListener('keydown', this.boundOnKeyDown)
      this.editor.isInteracting = true
      this.onSelectionConfirmed()
    } else if (event.key === 'Escape') {
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
    }
  }

  onSelectionConfirmed() {
    const selectedElements = this.editor.selected
    if (selectedElements.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected. Command cancelled.' })
      this.cleanup()
      return
    }

    this.originalPositions = this.editor.selected.map((element) => this.getElementPosition(element))
    this.originalSelection = this.editor.selected.slice()

    this.editor.selectSingleElement = true

    this.editor.signals.terminalLogged.dispatch({ msg: `Selected ${selectedElements.length} elements.` })
    this.editor.signals.terminalLogged.dispatch({ msg: 'Specify base point.' })
    this.editor.signals.pointCaptured.addOnce(this.onBasePoint, this)
  }

  onBasePoint(point) {
    this.basePoint = point
    this.editor.signals.terminalLogged.dispatch({
      msg: `Base point: ${this.basePoint.x.toFixed(2)}, ${this.basePoint.y.toFixed(2)}. Specify destination. Press Esc or Enter to finish.`,
    })

    this._spawnGhosts()
    this.editor.signals.pointCaptured.addOnce(this.onNextPoint, this)
    document.addEventListener('keydown', this.boundOnCopyStop)
  }

  // Spawn fresh ghost clones from the original selection at their original positions.
  _spawnGhosts() {
    this.currentGhosts = this.originalSelection.map((el) => {
      const clone = el.clone()
      const stripClasses = (element) => {
        element.removeClass('elementHover')
        element.removeClass('elementSelected')
        if (element.type === 'g' && element.children) {
          element.children().each(child => stripClasses(child))
        }
      }
      stripClasses(clone)
      const parent = el.parent() || this.editor.activeCollection
      parent.add(clone)
      return clone
    })
    this.editor.signals.moveGhostingStarted.dispatch(this.currentGhosts, this.basePoint)
  }

  onNextPoint(point) {
    this.editor.signals.moveGhostingStopped.dispatch()

    let dx = point.x - this.basePoint.x
    let dy = point.y - this.basePoint.y

    if (this.editor.distance) {
      if (this.editor.ortho) {
        if (Math.abs(dx) > Math.abs(dy)) {
          ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: point.x, y: this.basePoint.y }, this.editor.distance))
        } else {
          ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, { x: this.basePoint.x, y: point.y }, this.editor.distance))
        }
      } else {
        ;({ dx, dy } = calculateDeltaFromBasepoint(this.basePoint, point, this.editor.distance))
      }
    }
    if (this.editor.ortho) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }

    // Move current ghosts to their final position
    this.currentGhosts.forEach((clone, index) => {
      const originalPos = this.originalPositions[index]
      const localDelta = calculateLocalDelta(clone, dx, dy)
      const ldx = localDelta.dx
      const ldy = localDelta.dy

      if (originalPos.type === 'line') {
        const newPoints = originalPos.points.map((p) => [p[0] + ldx, p[1] + ldy])
        clone.plot(newPoints)
      } else if (originalPos.type === 'center') {
        clone.center(originalPos.cx + ldx, originalPos.cy + ldy)
      } else if (originalPos.type === 'text') {
        const matrix = originalPos.transform
        clone.transform(matrix).translate(ldx, ldy)
      } else {
        clone.move(originalPos.x + ldx, originalPos.y + ldy)
      }

      this.updateArcData(clone, originalPos, ldx, ldy)
    })

    // Accumulate placed copies for undo
    this.allCopiedElements.push(...this.currentGhosts)
    this.currentGhosts = []
    this.editor.distance = null

    this.editor.signals.terminalLogged.dispatch({ msg: 'Copy placed. Click for more or press Esc / Enter to finish.' })

    // Loop: spawn new ghosts for the next copy
    this._spawnGhosts()
    // Re-register via microtask: signals.js detaches the current addOnce binding
    // AFTER the listener body returns, so registering here would find and reuse
    // the not-yet-detached binding — which then gets detached, leaving no listener.
    Promise.resolve().then(() => {
      if (!this._cleanedUp) {
        this.editor.signals.pointCaptured.addOnce(this.onNextPoint, this)
      }
    })
  }

  // Keydown handler active only during the multi-copy loop.
  // Space/Enter finish the command (Escape is handled via commandCancelled).
  onCopyStop(event) {
    if (
      event.code === 'Space' ||
      event.code === 'Enter' ||
      event.code === 'NumpadEnter'
    ) {
      this.cleanup()
    }
  }

  cleanup() {
    // Guard: don't run twice
    if (this._cleanedUp) return
    this._cleanedUp = true

    document.removeEventListener('keydown', this.boundOnKeyDown)
    document.removeEventListener('keydown', this.boundOnCopyStop)
    this.editor.signals.pointCaptured.remove(this.onBasePoint, this)
    this.editor.signals.pointCaptured.remove(this.onNextPoint, this)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)

    // Stop ghosting and discard the unplaced ghost clones
    this.editor.signals.moveGhostingStopped.dispatch()
    this.currentGhosts.forEach(el => el.remove())
    this.currentGhosts = []

    // Commit all placed copies to undo history in one batch
    if (this.allCopiedElements.length > 0 && !this.interactiveExecutionDone) {
      this.interactiveExecutionDone = true
      this.editor.execute(this)
      this.editor.lastCommand = new CopyCommand(this.editor)
      this.editor.signals.terminalLogged.dispatch({ msg: `Command finished.` })
      this.editor.signals.updatedOutliner.dispatch()
    }

    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
    this.editor.distance = null
    setTimeout(() => { this.editor.selectSingleElement = false }, 10)
  }

  updateArcData(element, originalPos, dx, dy) {
    if (originalPos.arcData) {
      const ad = originalPos.arcData
      element.data('arcData', {
        p1: { x: ad.p1.x + dx, y: ad.p1.y + dy },
        p2: { x: ad.p2.x + dx, y: ad.p2.y + dy },
        p3: { x: ad.p3.x + dx, y: ad.p3.y + dy }
      })
    }
    if (originalPos.circleTrimData) {
      const ctd = originalPos.circleTrimData
      element.data('circleTrimData', {
        ...ctd,
        cx: ctd.cx + dx,
        cy: ctd.cy + dy,
        startPt: { x: ctd.startPt.x + dx, y: ctd.startPt.y + dy },
        endPt: { x: ctd.endPt.x + dx, y: ctd.endPt.y + dy }
      })
    }
    if (originalPos.splineData) {
      const sd = originalPos.splineData
      element.data('splineData', {
        points: sd.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
      })
    }
  }

  getElementPosition(element) {
    const data = {
      arcData: element.data('arcData'),
      circleTrimData: element.data('circleTrimData'),
      splineData: element.data('splineData')
    }

    if (element.type === 'line') {
      return { type: 'line', points: element.array().slice(), ...data }
    } else if (element.type === 'circle' || element.type === 'ellipse') {
      return { type: 'center', cx: element.cx(), cy: element.cy(), ...data }
    } else if (element.type === 'text') {
      return { type: 'text', transform: element.transform(), ...data }
    } else {
      return { type: 'position', x: element.x(), y: element.y(), ...data }
    }
  }

  undo() {
    this.allCopiedElements.forEach(el => el.remove())
    this.editor.selected = this.originalSelection.slice()
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ msg: 'Undo: Copies removed.' })
  }

  redo() {
    this.allCopiedElements.forEach(el => {
      const parent = el.parent() || this.editor.activeCollection
      parent.add(el)
    })
    this.editor.selected = this.allCopiedElements.slice()
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ msg: 'Redo: Elements copied again.' })
  }
}

function copyCommand(editor) {
  const copyCommand = new CopyCommand(editor)
  copyCommand.execute()
}

export { copyCommand }
