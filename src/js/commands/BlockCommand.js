import { Command } from '../Command'
import {
  createBlockDefinition,
  validateBlockDisplayName,
} from '../BlockManager'

const MAX_BLOCK_PREFLIGHT_NODES = 100000
const BLOCK_MIXED_PARENT_DIAGNOSTIC = 'BLOCK requires selected elements to share the same parent.'
const BLOCK_TRANSFORM_DIAGNOSTIC = 'BLOCK does not support transformed selections, ancestors, or descendants.'
const BLOCK_COMPLEXITY_DIAGNOSTIC = 'BLOCK selection is too complex to validate safely.'
const BLOCK_DRAWING_DIAGNOSTIC = 'BLOCK requires elements from the active drawing.'
const MATRIX_EPSILON = 1e-9

function childIndex(element) {
  const parent = element.parent()
  return parent ? Array.from(parent.node.children).indexOf(element.node) : -1
}

function sortBySiblingOrder(elements) {
  const parentNode = elements[0]?.node?.parentNode
  if (!parentNode) return elements.slice()

  const indexes = new Map(
    Array.from(parentNode.children, (node, index) => [node, index]),
  )
  return elements.slice().sort((left, right) => (
    (indexes.get(left.node) ?? Number.MAX_SAFE_INTEGER)
    - (indexes.get(right.node) ?? Number.MAX_SAFE_INTEGER)
  ))
}

function insertAt(parent, element, index) {
  const reference = index >= 0 ? parent.node.children[index] || null : null
  parent.node.insertBefore(element.node, reference)
}

function restorePlacements(placements) {
  const byParent = new Map()
  placements.forEach((placement) => {
    if (!byParent.has(placement.parent)) byParent.set(placement.parent, [])
    byParent.get(placement.parent).push(placement)
  })
  byParent.forEach((entries) => {
    entries
      .sort((left, right) => left.index - right.index)
      .forEach(({ element, index, parent }) => insertAt(parent, element, index))
  })
}

function multiplyMatrices(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function transformFunctionMatrix(name, values) {
  if (name === 'matrix' && values.length === 6) return values
  if (name === 'translate' && (values.length === 1 || values.length === 2)) {
    return [1, 0, 0, 1, values[0], values[1] || 0]
  }
  if (name === 'scale' && (values.length === 1 || values.length === 2)) {
    return [values[0], 0, 0, values[1] ?? values[0], 0, 0]
  }
  if (name === 'rotate' && (values.length === 1 || values.length === 3)) {
    const radians = values[0] * Math.PI / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const cx = values[1] || 0
    const cy = values[2] || 0
    return [
      cosine,
      sine,
      -sine,
      cosine,
      cx - cosine * cx + sine * cy,
      cy - sine * cx - cosine * cy,
    ]
  }
  if (name === 'skewx' && values.length === 1) {
    return [1, 0, Math.tan(values[0] * Math.PI / 180), 1, 0, 0]
  }
  if (name === 'skewy' && values.length === 1) {
    return [1, Math.tan(values[0] * Math.PI / 180), 0, 1, 0, 0]
  }
  return null
}

function parseTransformMatrix(value) {
  if (!value || value.trim() === '' || value.trim() === 'none') {
    return [1, 0, 0, 1, 0, 0]
  }
  if (value.length > 4096) return null

  const functionPattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let matrix = [1, 0, 0, 1, 0, 0]
  let cursor = 0
  let matched = false
  let match = functionPattern.exec(value)
  while (match) {
    if (!/^[\s,]*$/.test(value.slice(cursor, match.index))) return null
    const rawValues = match[2].trim()
    const values = rawValues === ''
      ? []
      : rawValues.split(/[\s,]+/).map(Number)
    if (values.some((number) => !Number.isFinite(number))) return null
    const transform = transformFunctionMatrix(match[1].toLowerCase(), values)
    if (!transform) return null
    matrix = multiplyMatrices(matrix, transform)
    cursor = functionPattern.lastIndex
    matched = true
    match = functionPattern.exec(value)
  }

  if (!matched || !/^[\s,]*$/.test(value.slice(cursor))) return null
  return matrix
}

function isIdentityMatrix(matrix) {
  if (!matrix) return false
  return matrix.every((value, index) => (
    Math.abs(value - [1, 0, 0, 1, 0, 0][index]) <= MATRIX_EPSILON
  ))
}

function hasNonIdentityTransform(node) {
  const attribute = node.getAttribute?.('transform')
  if (attribute && !isIdentityMatrix(parseTransformMatrix(attribute))) return true

  const inlineTransform = node.style?.transform
  if (
    inlineTransform
    && inlineTransform !== 'none'
    && !isIdentityMatrix(parseTransformMatrix(inlineTransform))
  ) return true

  const view = node.ownerDocument?.defaultView
  let computedTransform = ''
  try {
    computedTransform = view?.getComputedStyle?.(node)?.transform || ''
  } catch (_error) {
    return true
  }
  return Boolean(
    computedTransform
    && computedTransform !== 'none'
    && !isIdentityMatrix(parseTransformMatrix(computedTransform)),
  )
}

function qualifyBlockSelection(elements, drawing) {
  if (!Array.isArray(elements) || elements.length === 0) return null
  if (elements.length > MAX_BLOCK_PREFLIGHT_NODES) return BLOCK_COMPLEXITY_DIAGNOSTIC
  if (elements.some((element) => !element?.node)) return BLOCK_DRAWING_DIAGNOSTIC

  const parent = elements[0]?.parent() || null
  if (!parent || elements.some((element) => element.parent()?.node !== parent.node)) {
    return BLOCK_MIXED_PARENT_DIAGNOSTIC
  }

  const boundary = drawing?.node || null
  const inspected = new Set()
  const inspect = (node) => {
    if (inspected.has(node)) return null
    if (inspected.size >= MAX_BLOCK_PREFLIGHT_NODES) return BLOCK_COMPLEXITY_DIAGNOSTIC
    inspected.add(node)
    return hasNonIdentityTransform(node) ? BLOCK_TRANSFORM_DIAGNOSTIC : null
  }

  for (const element of elements) {
    let ancestor = element.node
    while (ancestor && ancestor !== boundary) {
      const diagnostic = inspect(ancestor)
      if (diagnostic) return diagnostic
      ancestor = ancestor.parentNode
    }
    if (ancestor !== boundary) return BLOCK_DRAWING_DIAGNOSTIC

    const descendants = []
    if (element.node.firstElementChild) descendants.push(element.node.firstElementChild)
    while (descendants.length > 0) {
      const descendant = descendants.pop()
      const diagnostic = inspect(descendant)
      if (diagnostic) return diagnostic
      if (descendant.nextElementSibling) descendants.push(descendant.nextElementSibling)
      if (descendant.firstElementChild) descendants.push(descendant.firstElementChild)
    }
  }

  return null
}

function isAtPlacement(parent, element, index) {
  return element.node.parentNode === parent.node
    && Array.from(parent.node.children).indexOf(element.node) === index
}

function ensurePlacement(parent, element, index) {
  if (!isAtPlacement(parent, element, index)) insertAt(parent, element, index)
}

function throwWithRollbackErrors(error, rollbackErrors) {
  if (rollbackErrors.length === 0) throw error
  throw new AggregateError([error, ...rollbackErrors], error.message)
}

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
    this.originalPlacements = []
    this.selectionBefore = []
    this.blockName = null
    this.basePoint = null
    this.instance = null
    this.defGroup = null
    this.blockMetadata = null
    this.defIndex = -1
    this.instanceIndex = -1
    this.instanceParent = null

    // Modal DOM refs
    this._overlay = null
  }

  execute() {
    if (this.interactiveExecutionDone) {
      this._applyInitial()
      return
    }

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

    const diagnostic = qualifyBlockSelection(selected, this.editor.drawing)
    if (diagnostic) {
      this.editor.signals.terminalLogged.dispatch({ msg: diagnostic })
      this.cleanup()
      return
    }

    this.selectionBefore = selected.slice()
    this.originalElements = sortBySiblingOrder(selected)
    this.originalParents = this.originalElements.map(el => el.parent())
    this.originalPlacements = this.originalElements.map((element) => ({
      element,
      index: childIndex(element),
      parent: element.parent(),
    }))

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
    nameInput.maxLength = 256
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
      else if (!validateBlockDisplayName(name)) err = 'Use 1-256 printable characters.'
      else if (this.editor.blockDefinitions.has(name)) err = `Block "${name}" already exists.`
      errorMsg.textContent = err
      createBtn.disabled = !name || !!err || !basePoint
    }

    nameInput.addEventListener('input', validate)

    // Pick base point
    bpBtn.addEventListener('click', () => {
      overlay.style.display = 'none'
      this.editor.signals.terminalLogged.dispatch({ msg: 'Click to set block base point…' })

      this._basePointListener = (point) => {
        basePoint = point
        bpValue.textContent = `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`
        overlay.style.display = 'flex'
        validate()
      }
      this.editor.signals.pointCaptured.addOnce(this._basePointListener, this)
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
    this.basePoint = { x: point.x, y: point.y }
    this.interactiveExecutionDone = true
    this.cleanup()
    return this.editor.execute(this)
  }

  _applyInitial() {
    const editor = this.editor
    const selectionDiagnostic = qualifyBlockSelection(this.originalElements, editor.drawing)
    if (
      this.originalElements.length === 0
      || selectionDiagnostic
      || !validateBlockDisplayName(this.blockName)
      || !Number.isFinite(this.basePoint?.x)
      || !Number.isFinite(this.basePoint?.y)
      || editor.blockDefinitions.has(this.blockName)
    ) {
      throw new TypeError(selectionDiagnostic || 'Block creation requires selected elements, a unique name, and a finite base point.')
    }

    if (this.selectionBefore.length === 0) {
      this.selectionBefore = this.originalElements.slice()
    }
    this.originalElements = sortBySiblingOrder(this.originalElements)
    this.originalParents = this.originalElements.map((element) => element.parent())
    this.originalPlacements = this.originalElements.map((element) => ({
      element,
      index: childIndex(element),
      parent: element.parent(),
    }))
    const earliestSelectedIndex = Math.min(
      ...this.originalPlacements.map(({ index }) => index),
    )

    const startingElementIndex = editor.elementIndex
    const defs = editor.svg.defs()
    const defsBefore = new Set(Array.from(defs.node.children))
    try {
      this.defGroup = createBlockDefinition(
        editor,
        this.blockName,
        this.originalElements,
        this.basePoint,
      )
      this.defIndex = childIndex(this.defGroup)
      this.blockMetadata = {
        ...editor.blockDefinitions.get(this.blockName),
        basePoint: { ...editor.blockDefinitions.get(this.blockName).basePoint },
      }

      this.originalElements.forEach((element) => element.remove())
      this.instanceParent = this.originalParents[0] || editor.activeCollection || editor.drawing
      const instanceId = editor.elementIndex++
      this.instance = this.instanceParent.use(this.defGroup)
      this.instance.attr({
        id: instanceId,
        name: this.blockName,
        'data-block-instance': 'true',
        'data-block-name': this.blockName,
      }).move(this.basePoint.x, this.basePoint.y)
      insertAt(this.instanceParent, this.instance, earliestSelectedIndex)
      this.instanceIndex = earliestSelectedIndex
    } catch (error) {
      this.instance?.remove()
      Array.from(defs.node.children).forEach((node) => {
        if (!defsBefore.has(node)) node.remove()
      })
      editor.blockDefinitions.delete(this.blockName)
      restorePlacements(this.originalPlacements)
      editor.elementIndex = startingElementIndex
      this.instance = null
      this.defGroup = null
      this.blockMetadata = null
      this.defIndex = -1
      this.instanceIndex = -1
      throw error
    }

    this._notify(
      [this.instance],
      `Block "${this.blockName}" created with ${this.originalElements.length} elements.`,
    )
  }

  cleanup() {
    if (this._cleanedUp) return
    this._cleanedUp = true

    this._closeModal()
    document.removeEventListener('keydown', this.boundOnKeyDown)
    if (this._basePointListener) {
      this.editor.signals.pointCaptured.remove(this._basePointListener, this)
      this._basePointListener = null
    }
    this.editor.signals.commandCancelled.remove(this.cleanup, this)

    this.editor.isInteracting = false
    this.editor.isTypingText = false
    this.editor.suppressHandlers = false
  }

  undo() {
    const editor = this.editor
    const definitions = editor.blockDefinitions
    const hadMetadata = definitions.has(this.blockName)
    const metadataBefore = definitions.get(this.blockName)
    const elementIndexBefore = editor.elementIndex

    try {
      this.instance.remove()
      this.defGroup.remove()
      definitions.delete(this.blockName)
      restorePlacements(this.originalPlacements)
    } catch (error) {
      const rollbackErrors = []
      const rollback = (operation) => {
        try {
          operation()
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }

      this.originalElements.forEach((element) => {
        if (element.node.parentNode) rollback(() => element.remove())
      })
      rollback(() => ensurePlacement(editor.svg.defs(), this.defGroup, this.defIndex))
      rollback(() => {
        if (hadMetadata) {
          if (definitions.get(this.blockName) !== metadataBefore) {
            definitions.set(this.blockName, metadataBefore)
          }
        } else if (definitions.has(this.blockName)) {
          definitions.delete(this.blockName)
        }
      })
      rollback(() => ensurePlacement(this.instanceParent, this.instance, this.instanceIndex))
      editor.elementIndex = elementIndexBefore
      throwWithRollbackErrors(error, rollbackErrors)
    }

    this._notify(this.selectionBefore, `Undo: Block "${this.blockName}" removed.`)
  }

  redo() {
    try {
      this.originalElements.forEach((element) => element.remove())
      insertAt(this.editor.svg.defs(), this.defGroup, this.defIndex)
      this.editor.blockDefinitions.set(this.blockName, {
        ...this.blockMetadata,
        basePoint: { ...this.blockMetadata.basePoint },
      })
      insertAt(this.instanceParent, this.instance, this.instanceIndex)
    } catch (error) {
      const rollbackErrors = []
      const rollback = (operation) => {
        try {
          operation()
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (this.instance.node.parentNode) rollback(() => this.instance.remove())
      if (this.defGroup.node.parentNode) rollback(() => this.defGroup.remove())
      rollback(() => this.editor.blockDefinitions.delete(this.blockName))
      rollback(() => restorePlacements(this.originalPlacements))
      throwWithRollbackErrors(error, rollbackErrors)
    }
    this._notify([this.instance], `Redo: Block "${this.blockName}" restored.`)
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

function blockCommand(editor) {
  const cmd = new BlockCommand(editor)
  cmd.execute()
}

export { blockCommand, BlockCommand }
