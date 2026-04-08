import { Command } from '../Command'
import { insertBlockInstance, getBlockNames } from '../BlockManager'

class InsertCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'InsertCommand'
    this.name = 'Insert'
    this.boundOnInsertStop = this.onInsertStop.bind(this)
    this.allInsertedInstances = []
    this.blockName = null
    this.interactiveExecutionDone = false
    this._overlay = null
  }

  execute() {
    if (this.interactiveExecutionDone) return

    const names = getBlockNames(this.editor)
    if (names.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No blocks defined. Use BLOCK command first.' })
      return
    }

    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'INSERT ' })
    this.editor.isInteracting = true
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)

    this._showModal(names)
  }

  // ── Modal UI ──────────────────────────────────────────────────────────────

  _buildBlockThumbnail(name) {
    const defId = 'block-' + name
    const defEl = this.editor.svg.defs().findOne('#' + CSS.escape(defId))
    if (!defEl) return ''

    // Get bounding box of the definition content
    // The def group lives inside <defs> so getBBox may not work — serialize and measure
    let inner = ''
    defEl.children().each(child => {
      inner += new XMLSerializer().serializeToString(child.node)
    })

    // Parse the content into a temporary SVG to get bbox
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    tempSvg.style.position = 'absolute'
    tempSvg.style.visibility = 'hidden'
    tempSvg.innerHTML = inner
    document.body.appendChild(tempSvg)

    let vbX = 0, vbY = 0, vbW = 100, vbH = 100
    try {
      const bbox = tempSvg.getBBox()
      if (bbox.width > 0 && bbox.height > 0) {
        const padding = Math.max(bbox.width, bbox.height) * 0.15
        vbX = bbox.x - padding
        vbY = bbox.y - padding
        vbW = bbox.width + padding * 2
        vbH = bbox.height + padding * 2
      }
    } catch (e) { /* use defaults */ }
    document.body.removeChild(tempSvg)

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="width:100%;height:100%;">${inner}</svg>`
  }

  _showModal(names) {
    // Overlay
    const overlay = document.createElement('div')
    overlay.className = 'block-modal-overlay'
    this._overlay = overlay

    // Dialog
    const dialog = document.createElement('div')
    dialog.className = 'block-modal-dialog insert-modal-dialog'

    // Title
    const title = document.createElement('h3')
    title.className = 'prefs-title'
    title.textContent = 'Insert Block'
    dialog.appendChild(title)

    // Block grid
    const grid = document.createElement('div')
    grid.className = 'insert-modal-grid'

    names.forEach(name => {
      const card = document.createElement('div')
      card.className = 'insert-modal-card'

      const thumb = document.createElement('div')
      thumb.className = 'insert-modal-thumb'
      thumb.innerHTML = this._buildBlockThumbnail(name)

      const label = document.createElement('div')
      label.className = 'insert-modal-label'
      label.textContent = name

      card.appendChild(thumb)
      card.appendChild(label)

      card.addEventListener('click', () => {
        this._closeModal()
        this._onBlockSelected(name)
      })

      grid.appendChild(card)
    })

    dialog.appendChild(grid)

    // Cancel button
    const btnRow = document.createElement('div')
    btnRow.className = 'prefs-buttons'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'prefs-btn prefs-btn-cancel'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => {
      this._closeModal()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
      this.cleanup()
    })
    btnRow.appendChild(cancelBtn)
    dialog.appendChild(btnRow)

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this._closeModal()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        this.cleanup()
      }
    })

    // Close on Escape
    this._modalEscHandler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        this._closeModal()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        this.cleanup()
      }
    }
    document.addEventListener('keydown', this._modalEscHandler, true)
  }

  _closeModal() {
    if (this._overlay) {
      this._overlay.remove()
      this._overlay = null
    }
    if (this._modalEscHandler) {
      document.removeEventListener('keydown', this._modalEscHandler, true)
      this._modalEscHandler = null
    }
  }

  _onBlockSelected(name) {
    this.blockName = name
    this.editor.signals.terminalLogged.dispatch({ msg: `Inserting block "${name}". Specify insertion point:` })
    this._spawnGhost()
    this.editor.signals.pointCaptured.addOnce(this.onInsertionPoint, this)
    document.addEventListener('keydown', this.boundOnInsertStop)
  }

  // ── Ghost preview ─────────────────────────────────────────────────────────

  _spawnGhost() {
    const defId = 'block-' + this.blockName
    const defEl = this.editor.svg.defs().findOne('#' + CSS.escape(defId))
    if (!defEl) return

    const parent = this.editor.activeCollection
    this._ghost = parent.use(defEl)
      .attr('data-block-ghost', 'true')
      .move(0, 0)
      .opacity(0.4)
      .addClass('ghostLine')

    // Ghost follows cursor from origin — basePoint = (0,0) since the def is
    // already centered on its base point
    this.editor.signals.moveGhostingStarted.dispatch([this._ghost], { x: 0, y: 0 })
  }

  _removeGhost() {
    if (this._ghost) {
      this.editor.signals.moveGhostingStopped.dispatch()
      this._ghost.remove()
      this._ghost = null
    }
  }

  // ── Insertion logic ───────────────────────────────────────────────────────

  onInsertionPoint(point) {
    // Stop ghosting and remove the preview
    this._removeGhost()

    const parent = this.editor.activeCollection
    const instance = insertBlockInstance(this.editor, this.blockName, point, parent)

    if (instance) {
      this.allInsertedInstances.push(instance)
      this.editor.signals.terminalLogged.dispatch({
        msg: `"${this.blockName}" inserted at ${point.x.toFixed(2)}, ${point.y.toFixed(2)}. Click for more or press Esc/Enter to finish.`,
      })
      this.editor.signals.updatedOutliner.dispatch()
    }

    // Spawn a new ghost for the next placement
    this._spawnGhost()

    // Loop: listen for next insertion point
    Promise.resolve().then(() => {
      if (!this._cleanedUp) {
        this.editor.signals.pointCaptured.addOnce(this.onInsertionPoint, this)
      }
    })
  }

  onInsertStop(event) {
    if (
      event.code === 'Space' ||
      event.code === 'Enter' ||
      event.code === 'NumpadEnter'
    ) {
      this.cleanup()
    }
  }

  cleanup() {
    if (this._cleanedUp) return
    this._cleanedUp = true

    this._removeGhost()
    this._closeModal()
    document.removeEventListener('keydown', this.boundOnInsertStop)
    this.editor.signals.pointCaptured.remove(this.onInsertionPoint, this)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)

    // Commit all placed instances to undo history in one batch
    if (this.allInsertedInstances.length > 0 && !this.interactiveExecutionDone) {
      this.interactiveExecutionDone = true
      this.editor.execute(this)
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
      this.editor.signals.updatedOutliner.dispatch()
    }

    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    this.editor.isInteracting = false
  }

  undo() {
    this.allInsertedInstances.forEach(el => el.remove())
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = []
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ msg: `Undo: ${this.allInsertedInstances.length} block instance(s) removed.` })
  }

  redo() {
    this.allInsertedInstances.forEach(el => {
      const parent = el.parent() || this.editor.activeCollection
      parent.add(el)
    })
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ msg: `Redo: ${this.allInsertedInstances.length} block instance(s) restored.` })
  }
}

function insertCommand(editor) {
  const cmd = new InsertCommand(editor)
  cmd.execute()
}

export { insertCommand, InsertCommand }
