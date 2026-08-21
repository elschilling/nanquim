import { Command } from '../Command'
import { getBlockDefinition, getBlockNames } from '../BlockManager'

function childIndex(element) {
  const parent = element.parent()
  return parent ? Array.from(parent.node.children).indexOf(element.node) : -1
}

function insertAt(parent, element, index) {
  const reference = index >= 0 ? parent.node.children[index] || null : null
  parent.node.insertBefore(element.node, reference)
}

function restoreRecords(records) {
  const byParent = new Map()
  records.forEach((record) => {
    if (!byParent.has(record.parent)) byParent.set(record.parent, [])
    byParent.get(record.parent).push(record)
  })
  byParent.forEach((entries) => {
    entries
      .sort((left, right) => left.index - right.index)
      .forEach((record) => {
        if (record.element.parent()?.node === record.parent.node) return
        insertAt(record.parent, record.element, record.index)
      })
  })
}

function combinedError(error, rollbackErrors, message) {
  if (rollbackErrors.length === 0) return error
  return new AggregateError([error, ...rollbackErrors], message)
}

class InsertCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'InsertCommand'
    this.name = 'Insert'
    this.boundOnInsertStop = this.onInsertStop.bind(this)
    this.allInsertedInstances = []
    this.insertionRecords = []
    this.selectionBefore = [...editor.selected]
    this.blockName = null
    this.interactiveExecutionDone = false
    this._overlay = null
    this._modalAbortController = null
  }

  execute() {
    if (this.interactiveExecutionDone) {
      this._applyInitial()
      return
    }

    const names = getBlockNames(this.editor)
    if (names.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No blocks defined. Use BLOCK command first.' })
      return
    }

    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'INSERT ' })
    this.editor.isInteracting = true
    this.editor.signals.commandCancelled.addOnce(this.cancel, this)

    this._showModal(names)
  }

  // ── Modal UI ──────────────────────────────────────────────────────────────

  _buildBlockThumbnail(name) {
    const defEl = getBlockDefinition(this.editor, name)
    if (!defEl) return ''

    // Get bounding box of the definition content
    // The def group lives inside <defs> so getBBox may not work — serialize and measure
    let inner = ''
    defEl.children().each((child) => {
      inner += new XMLSerializer().serializeToString(child.node)
    })

    // Parse the content into a temporary SVG to get bbox
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    tempSvg.style.position = 'absolute'
    tempSvg.style.visibility = 'hidden'
    tempSvg.innerHTML = inner
    document.body.appendChild(tempSvg)

    let vbX = 0,
      vbY = 0,
      vbW = 100,
      vbH = 100
    try {
      const bbox = tempSvg.getBBox()
      if (bbox.width > 0 && bbox.height > 0) {
        const padding = Math.max(bbox.width, bbox.height) * 0.15
        vbX = bbox.x - padding
        vbY = bbox.y - padding
        vbW = bbox.width + padding * 2
        vbH = bbox.height + padding * 2
      }
    } catch (e) {
      /* use defaults */
    }
    document.body.removeChild(tempSvg)

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="width:100%;height:100%;stroke:white;stroke-width:.05;fill:none;stroke-linecap:round;">${inner}</svg>`
  }

  _showModal(names) {
    this._modalAbortController?.abort()
    this._modalAbortController = new AbortController()
    const modalListenerOptions = { signal: this._modalAbortController.signal }

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

    names.forEach((name) => {
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
      }, modalListenerOptions)

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
      this.cancel()
    }, modalListenerOptions)
    btnRow.appendChild(cancelBtn)
    dialog.appendChild(btnRow)

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this._closeModal()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        this.cancel()
      }
    }, modalListenerOptions)

    // Close on Escape
    this._modalEscHandler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        this._closeModal()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        this.cancel()
      }
    }
    document.addEventListener('keydown', this._modalEscHandler, {
      capture: true,
      signal: this._modalAbortController.signal,
    })
  }

  _closeModal() {
    if (this._modalAbortController) {
      this._modalAbortController.abort()
      this._modalAbortController = null
    }
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
    if (!getBlockDefinition(this.editor, name)) {
      this.editor.signals.terminalLogged.dispatch({ msg: `Block "${name}" is no longer available.` })
      this.cancel()
      return
    }
    this.blockName = name
    this.editor.signals.terminalLogged.dispatch({ msg: `Inserting block "${name}". Specify insertion point:` })
    this._spawnGhost()
    this.editor.signals.pointCaptured.addOnce(this.onInsertionPoint, this)
    document.addEventListener('keydown', this.boundOnInsertStop)
  }

  // ── Ghost preview ─────────────────────────────────────────────────────────

  _spawnGhost() {
    const defEl = getBlockDefinition(this.editor, this.blockName)
    if (!defEl) return

    this._ghost = this.editor.overlays.use(defEl).attr({
      'data-block-ghost': 'true',
      'data-nanquim-transient': 'true',
      'pointer-events': 'none',
    }).move(0, 0).opacity(0.4).addClass('ghostLine')

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

    const parent = this.editor.activeCollection || this.editor.drawing
    const defElement = getBlockDefinition(this.editor, this.blockName)
    const instance = defElement
      ? this.editor.overlays.use(defElement).attr({
        'data-block-instance': 'true',
        'data-block-name': this.blockName,
        'data-nanquim-transient': 'true',
        'pointer-events': 'none',
      }).move(point.x, point.y).opacity(0.55)
      : null

    if (instance) {
      this.allInsertedInstances.push(instance)
      this.insertionRecords.push({ element: instance, index: -1, parent })
      this.editor.signals.terminalLogged.dispatch({
        msg: `"${this.blockName}" inserted at ${point.x.toFixed(2)}, ${point.y.toFixed(2)}. Click for more or press Esc/Enter to finish.`,
      })
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
    if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      this.finish()
    }
  }

  finish() {
    if (this._cleanedUp) return
    if (this.insertionRecords.length === 0) {
      this._teardown({ discardPreviews: true })
      this.editor.signals.terminalLogged.dispatch({ msg: 'No block instances placed. Command cancelled.' })
      return
    }

    this._removeGhost()
    this.interactiveExecutionDone = true
    this._teardown({ discardPreviews: false })
    try {
      this.editor.execute(this)
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command finished.' })
    } catch (error) {
      this.insertionRecords.forEach(({ element }) => element.remove())
      throw error
    }
  }

  cancel() {
    if (this._cleanedUp) return
    this._teardown({ discardPreviews: true })
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = [...this.selectionBefore]
    this.editor.signals.updatedSelection.dispatch()
  }

  cleanup() {
    this.cancel()
  }

  _teardown({ discardPreviews }) {
    this._cleanedUp = true

    this._removeGhost()
    if (discardPreviews) this.insertionRecords.forEach(({ element }) => element.remove())
    this._closeModal()
    document.removeEventListener('keydown', this.boundOnInsertStop)
    this.editor.signals.pointCaptured.remove(this.onInsertionPoint, this)
    this.editor.signals.commandCancelled.remove(this.cancel, this)
    this.editor.isInteracting = false
  }

  _applyInitial() {
    if (
      this.insertionRecords.length === 0
      || !this.blockName
      || !getBlockDefinition(this.editor, this.blockName)
    ) {
      throw new TypeError('Insert requires placements for an available block definition.')
    }

    const startingElementIndex = this.editor.elementIndex
    try {
      this.insertionRecords.forEach((record) => {
        const id = this.editor.elementIndex++
        record.element.attr({
          id,
          name: this.blockName,
          'data-nanquim-transient': null,
          'pointer-events': null,
        }).opacity(1)
        record.parent.add(record.element)
        record.index = childIndex(record.element)
      })
    } catch (error) {
      this.insertionRecords.forEach((record) => {
        record.element.attr({
          id: null,
          name: null,
          'data-nanquim-transient': 'true',
          'pointer-events': 'none',
        }).opacity(0.55)
        this.editor.overlays.add(record.element)
        record.index = -1
      })
      this.editor.elementIndex = startingElementIndex
      throw error
    }

    this._notify([], `${this.insertionRecords.length} block instance(s) inserted.`)
  }

  undo() {
    try {
      this.insertionRecords.forEach(({ element }) => element.remove())
    } catch (error) {
      const rollbackErrors = []
      try {
        restoreRecords(this.insertionRecords)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      throw combinedError(
        error,
        rollbackErrors,
        `${error.message} Restoring the inserted instances also failed.`,
      )
    }
    this._notify(
      this.selectionBefore,
      `Undo: ${this.allInsertedInstances.length} block instance(s) removed.`,
    )
  }

  redo() {
    const attached = []
    try {
      this.insertionRecords.forEach(({ element, index, parent }) => {
        insertAt(parent, element, index)
        attached.push(element)
      })
    } catch (error) {
      attached.forEach((element) => element.remove())
      throw error
    }
    this._notify([], `Redo: ${this.allInsertedInstances.length} block instance(s) restored.`)
  }

  _notify(selection, message) {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('clearSelection')
    this.editor.selected = [...selection]
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('terminalLogged', { msg: message })
  }
}

function insertCommand(editor) {
  const cmd = new InsertCommand(editor)
  cmd.execute()
}

export { insertCommand, InsertCommand }
