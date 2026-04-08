import { Command } from '../Command'
import { createBlockDefinition, insertBlockInstance } from '../BlockManager'

class BlockCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'BlockCommand'
    this.name = 'Block'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.interactiveExecutionDone = false

    // Stored for undo/redo
    this.originalElements = []
    this.originalParents = []
    this.blockName = null
    this.instance = null
    this.defGroup = null

    // Modal DOM refs
    this._overlay = null
  }

  execute() {
    if (this.interactiveExecutionDone) return

    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'BLOCK ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: 'Select elements to define as a block and press Enter to confirm.',
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
    const selected = this.editor.selected
    if (selected.length === 0) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected. Command cancelled.' })
      this.cleanup()
      return
    }

    this.originalElements = selected.slice()
    this.originalParents = selected.map(el => el.parent())

    this._showModal()
  }

  // ── Modal UI ──────────────────────────────────────────────────────────────

  _buildPreviewSVG() {
    // Compute bounding box of all selected elements
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    this.originalElements.forEach(el => {
      try {
        const box = el.bbox()
        if (box.x < minX) minX = box.x
        if (box.y < minY) minY = box.y
        if (box.x + box.width > maxX) maxX = box.x + box.width
        if (box.y + box.height > maxY) maxY = box.y + box.height
      } catch (e) { /* skip elements without bbox */ }
    })

    if (!isFinite(minX)) return ''

    const padding = Math.max(maxX - minX, maxY - minY) * 0.1
    const vbX = minX - padding
    const vbY = minY - padding
    const vbW = (maxX - minX) + padding * 2
    const vbH = (maxY - minY) + padding * 2

    // Clone selected elements into an SVG preview string
    let inner = ''
    this.originalElements.forEach(el => {
      const clone = el.node.cloneNode(true)
      clone.classList.remove('elementHover', 'elementSelected')
      // Force white stroke for dark preview background
      inner += new XMLSerializer().serializeToString(clone)
    })

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="width:100%;height:100%;">${inner}</svg>`
  }

  _showModal() {
    // Overlay
    const overlay = document.createElement('div')
    overlay.className = 'block-modal-overlay'
    this._overlay = overlay

    // Dialog
    const dialog = document.createElement('div')
    dialog.className = 'block-modal-dialog'

    // Title
    const title = document.createElement('h3')
    title.className = 'prefs-title'
    title.textContent = 'Create Block'
    dialog.appendChild(title)

    // Preview
    const previewContainer = document.createElement('div')
    previewContainer.className = 'block-modal-preview'
    previewContainer.innerHTML = this._buildPreviewSVG()
    dialog.appendChild(previewContainer)

    // Name row
    const nameRow = document.createElement('div')
    nameRow.className = 'prefs-row'
    const nameLabel = document.createElement('label')
    nameLabel.className = 'prefs-label'
    nameLabel.textContent = 'Block Name'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.className = 'prefs-input block-modal-name-input'
    nameInput.placeholder = 'Enter name…'
    nameInput.spellcheck = false
    nameRow.appendChild(nameLabel)
    nameRow.appendChild(nameInput)
    dialog.appendChild(nameRow)

    // Error message area
    const errorMsg = document.createElement('div')
    errorMsg.className = 'block-modal-error'
    dialog.appendChild(errorMsg)

    // Base point row
    const bpRow = document.createElement('div')
    bpRow.className = 'prefs-row'
    const bpLabel = document.createElement('label')
    bpLabel.className = 'prefs-label'
    bpLabel.textContent = 'Base Point'
    const bpValue = document.createElement('span')
    bpValue.className = 'block-modal-bp-value'
    bpValue.textContent = 'Not set'
    const bpBtn = document.createElement('button')
    bpBtn.className = 'prefs-btn prefs-btn-save'
    bpBtn.textContent = 'Pick'
    bpRow.appendChild(bpLabel)
    bpRow.appendChild(bpValue)
    bpRow.appendChild(bpBtn)
    dialog.appendChild(bpRow)

    // Buttons
    const btnRow = document.createElement('div')
    btnRow.className = 'prefs-buttons'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'prefs-btn prefs-btn-cancel'
    cancelBtn.textContent = 'Cancel'
    const createBtn = document.createElement('button')
    createBtn.className = 'prefs-btn prefs-btn-save'
    createBtn.textContent = 'Create'
    createBtn.disabled = true
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(createBtn)
    dialog.appendChild(btnRow)

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    // Focus name input
    nameInput.focus()

    // ── State ──
    let basePoint = null

    const validate = () => {
      const name = nameInput.value.trim()
      let err = ''
      if (!name) err = ''
      else if (this.editor.blockDefinitions.has(name)) err = `Block "${name}" already exists.`
      errorMsg.textContent = err
      createBtn.disabled = !name || !!err || !basePoint
    }

    nameInput.addEventListener('input', validate)

    // Pick base point
    bpBtn.addEventListener('click', () => {
      overlay.style.display = 'none'
      this.editor.signals.terminalLogged.dispatch({ msg: 'Click to set block base point…' })

      this.editor.signals.pointCaptured.addOnce((point) => {
        basePoint = point
        bpValue.textContent = `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`
        overlay.style.display = 'flex'
        validate()
      }, this)
    })

    // Cancel
    cancelBtn.addEventListener('click', () => {
      this._closeModal()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
      this.cleanup()
    })

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this._closeModal()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        this.cleanup()
      }
    })

    // Close on Escape while modal is open
    this._modalEscHandler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        this._closeModal()
        this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        this.cleanup()
      }
    }
    document.addEventListener('keydown', this._modalEscHandler, true)

    // Create
    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim()
      this._closeModal()
      this.blockName = name
      this._finalize(basePoint)
    })

    // Allow Enter in name input to submit if valid
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !createBtn.disabled) {
        e.preventDefault()
        const name = nameInput.value.trim()
        this._closeModal()
        this.blockName = name
        this._finalize(basePoint)
      }
    })
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

  // ── Block creation logic ──────────────────────────────────────────────────

  _finalize(point) {
    const editor = this.editor

    // Create the block definition from the selected elements
    this.defGroup = createBlockDefinition(editor, this.blockName, this.originalElements, point)

    // Remove original elements from the drawing
    this.originalElements.forEach(el => el.remove())

    // Insert a block instance at the same position (where the base point was)
    const parent = this.originalParents[0] || editor.activeCollection
    this.instance = insertBlockInstance(editor, this.blockName, point, parent)

    // Commit to history
    this.interactiveExecutionDone = true
    editor.execute(this)

    editor.signals.clearSelection.dispatch()
    editor.selected = [this.instance]
    editor.signals.updatedSelection.dispatch()
    editor.signals.updatedOutliner.dispatch()
    editor.signals.terminalLogged.dispatch({
      msg: `Block "${this.blockName}" created with ${this.originalElements.length} elements.`,
    })

    this.cleanup()
  }

  cleanup() {
    if (this._cleanedUp) return
    this._cleanedUp = true

    this._closeModal()
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)

    this.editor.isInteracting = false
    this.editor.isTypingText = false
    this.editor.suppressHandlers = false
  }

  undo() {
    // Remove the instance
    if (this.instance) this.instance.remove()

    // Remove the definition from <defs>
    if (this.defGroup) this.defGroup.remove()

    // Remove from block definitions map
    this.editor.blockDefinitions.delete(this.blockName)

    // Re-insert original elements
    this.originalElements.forEach((el, i) => {
      const parent = this.originalParents[i] || this.editor.activeCollection
      parent.add(el)
    })

    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = this.originalElements.slice()
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ msg: `Undo: Block "${this.blockName}" removed.` })
  }

  redo() {
    // Remove original elements
    this.originalElements.forEach(el => el.remove())

    // Re-add the definition to <defs>
    this.editor.svg.defs().add(this.defGroup)

    // Re-add to block definitions map
    this.editor.blockDefinitions.set(this.blockName, {
      defId: 'block-' + this.blockName,
      basePoint: JSON.parse(this.defGroup.attr('data-base-point')),
      elementCount: this.originalElements.length,
    })

    // Re-add the instance
    const parent = this.originalParents[0] || this.editor.activeCollection
    parent.add(this.instance)

    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.editor.signals.clearSelection.dispatch()
    this.editor.selected = [this.instance]
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.terminalLogged.dispatch({ msg: `Redo: Block "${this.blockName}" restored.` })
  }
}

function blockCommand(editor) {
  const cmd = new BlockCommand(editor)
  cmd.execute()
}

export { blockCommand, BlockCommand }
