import { dispatchSignalSafely } from '../Command'
import { ReorderTreeCommand, canReorderTreeElement, planTreeMove } from '../commands/ReorderTreeCommand'

const DROP_CLASSES = ['outliner-drop-before', 'outliner-drop-inside', 'outliner-drop-after']
const KEYBOARD_HELP = 'Drag to move. Keyboard: Enter to pick up, Up/Down to choose a row, Left/Right to choose placement, Enter to drop, Escape to cancel.'

function initOutlinerDragDrop(editor, tree) {
  const elements = new WeakMap()
  const status = document.createElement('span')
  status.className = 'outliner-move-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  tree.insertAdjacentElement('beforebegin', status)
  let session = null
  let candidate = null

  function announce(message) {
    status.textContent = message
  }

  function label(element) {
    return element.attr('name') || (element.attr('data-collection') === 'true' ? 'Collection' : element.type)
  }

  function rows() {
    return Array.from(tree.querySelectorAll('[data-outliner-id]'))
  }

  function rowFor(element) {
    return rows().find(row => elements.get(row)?.node === element.node)
  }

  function clearCandidate() {
    candidate?.row.classList.remove(...DROP_CLASSES)
    candidate = null
  }

  function cancel(restoreFocus = false) {
    const source = session?.source
    session?.rows.forEach(row => row.classList.remove('outliner-drag-source'))
    session = null
    clearCandidate()
    document.removeEventListener('keydown', onKeyDown, true)
    if (restoreFocus && source) rowFor(source)?.querySelector('.outliner-move-handle')?.focus()
  }

  function start(row, keyboard) {
    cancel()
    const source = elements.get(row)
    if (!source || !canReorderTreeElement(editor, source)) return false
    if (editor.isDrawing || editor.isInteracting || editor.isEditingVertex) {
      announce('Finish or cancel the current command before moving items.')
      return false
    }
    const collectionSource = source.attr('data-collection') === 'true'
    // Activating a collection selects it; subsequent row clicks add its contents.
    // The dragged row determines whether we move collections or their contents.
    const selected = editor.selected.includes(source)
      ? editor.selected.filter(element => (element.attr?.('data-collection') === 'true') === collectionSource)
      : [source]
    session = {
      source,
      elements: selected,
      keyboard,
      mode: editor.mode,
      revision: editor.commandSessionRevision,
      rows: selected.map(rowFor).filter(Boolean),
    }
    session.rows.forEach(item => item.classList.add('outliner-drag-source'))
    document.addEventListener('keydown', onKeyDown, true)
    announce(`Moving ${selected.length === 1 ? label(source) : `${selected.length} items`}. ${KEYBOARD_HELP}`)
    return true
  }

  function isCurrent() {
    if (!session) return false
    if (session.mode !== editor.mode || session.revision !== editor.commandSessionRevision) {
      cancel()
      return false
    }
    return true
  }

  function positions(target) {
    const collectionSource = session.source.attr('data-collection') === 'true'
    if (!collectionSource && target.attr('data-collection') === 'true') return ['inside']
    const container = target.type === 'g' && target.attr('data-geometry-nodes') !== 'true'
    return container && !collectionSource ? ['before', 'inside', 'after'] : ['before', 'after']
  }

  function preview(row, position) {
    clearCandidate()
    if (!isCurrent()) return false
    const target = elements.get(row)
    if (!target) return false
    const plan = planTreeMove(editor, session.elements, target, position)
    candidate = { row, target, position, valid: plan.valid, reason: plan.reason }
    if (plan.valid) row.classList.add(`outliner-drop-${position}`)
    if (session.keyboard) announce(plan.valid
      ? `Move ${position === 'inside' ? 'into' : position} ${label(target)}. Enter to drop; Escape to cancel.`
      : plan.reason || 'Choose another destination.')
    return plan.valid
  }

  function previewPointer(event, row) {
    const target = elements.get(row)
    if (!target || !isCurrent()) return false
    const box = row.getBoundingClientRect()
    const fraction = box.height > 0 ? (event.clientY - box.top) / box.height : 0.5
    const choices = positions(target)
    if (choices.length === 1) return preview(row, choices[0])
    const position = choices.length === 3 && fraction >= 0.25 && fraction <= 0.75
      ? 'inside' : fraction < 0.5 ? 'before' : 'after'
    return preview(row, position)
  }

  function drop() {
    if (!isCurrent() || !candidate) return
    const { target, position } = candidate
    const moving = session.elements
    const keyboard = session.keyboard
    const source = session.source
    const plan = planTreeMove(editor, moving, target, position)
    cancel()
    if (!plan.valid) {
      announce(plan.reason || 'This item cannot be moved here.')
      return
    }
    try {
      editor.execute(new ReorderTreeCommand(editor, moving, target, position))
      announce('Items moved. Undo is available.')
      if (keyboard) (rowFor(source) || rowFor(target))?.querySelector('.outliner-move-handle')?.focus()
    } catch (error) {
      const message = error.message || 'The items could not be moved.'
      announce(message)
      dispatchSignalSafely(editor.signals.terminalLogged, [{ msg: message }])
      if (keyboard) rowFor(source)?.querySelector('.outliner-move-handle')?.focus()
    }
  }

  function onKeyDown(event) {
    if (!session) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel(true)
      announce('Move cancelled.')
      return
    }
    if (!session.keyboard || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const availableRows = rows().filter(row => row.querySelector('.outliner-move-handle'))
    const focusedRow = document.activeElement?.closest('[data-outliner-id]')
    const row = focusedRow && tree.contains(focusedRow) ? focusedRow : candidate?.row || rowFor(session.source)
    if (event.key === 'Enter' || event.key === ' ') {
      if (candidate?.row !== row) preview(row, positions(elements.get(row)).includes('inside') ? 'inside' : 'after')
      drop()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const index = availableRows.indexOf(row)
      const next = availableRows[Math.max(0, Math.min(availableRows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))]
      next?.querySelector('.outliner-move-handle')?.focus()
    } else {
      const choices = positions(elements.get(row))
      const index = choices.indexOf(candidate?.row === row ? candidate.position : 'inside')
      const next = Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))
      preview(row, choices[next])
    }
  }

  function bindRow(row, element) {
    elements.set(row, element)
    row.dataset.outlinerId = element.node.id
    if (!canReorderTreeElement(editor, element)) return
    row.draggable = true
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'outliner-move-handle'
    handle.setAttribute('aria-label', `Move ${label(element)}`)
    handle.title = KEYBOARD_HELP
    const icon = document.createElement('span')
    icon.className = 'icon icon-drag'
    icon.setAttribute('aria-hidden', 'true')
    handle.appendChild(icon)
    row.prepend(handle)
    handle.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      start(row, true)
    })
    handle.addEventListener('keyup', event => {
      if (['Enter', ' ', 'Escape'].includes(event.key)) event.stopPropagation()
    })
    handle.addEventListener('click', event => {
      event.stopPropagation()
      if (session?.keyboard) {
        if (candidate?.row !== row) preview(row, positions(element).includes('inside') ? 'inside' : 'after')
        drop()
      } else start(row, true)
    })
    handle.addEventListener('focus', () => {
      if (session?.keyboard) preview(row, positions(element)[0])
    })
    row.addEventListener('dragstart', event => {
      if (event.target.closest('input, .collection-icons') || !start(row, false)) {
        event.preventDefault()
        return
      }
      event.stopPropagation()
      event.dataTransfer?.setData('text/plain', label(element))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => cancel())
  }

  tree.addEventListener('dragover', event => {
    if (!isCurrent() || session.keyboard) return
    event.preventDefault()
    const row = event.target.closest('[data-outliner-id]')
    const valid = row && tree.contains(row) && previewPointer(event, row)
    if (!row) clearCandidate()
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none'
  })
  tree.addEventListener('dragleave', event => {
    if (!tree.contains(event.relatedTarget)) clearCandidate()
  })
  tree.addEventListener('focusout', event => {
    if (session?.keyboard && !tree.contains(event.relatedTarget)) {
      cancel()
      announce('Move cancelled.')
    }
  })
  tree.addEventListener('drop', event => {
    if (!isCurrent() || session.keyboard) return
    event.preventDefault()
    event.stopPropagation()
    const row = event.target.closest('[data-outliner-id]')
    if (row && tree.contains(row)) {
      previewPointer(event, row)
      drop()
    } else cancel()
  })
  for (const name of ['documentSessionReset', 'editorModeChanged', 'activeEditorChanged', 'commandCancelled']) {
    editor.signals[name]?.add(() => cancel())
  }

  return { bindRow, cancel }
}

export { initOutlinerDragDrop }
