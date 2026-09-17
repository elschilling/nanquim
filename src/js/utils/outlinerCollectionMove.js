import { canReorderTreeElement, planTreeMove } from '../commands/ReorderTreeCommand'
import { MoveToCollectionCommand } from '../commands/MoveToCollectionCommand'

function node(tag, text) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  return element
}

function initOutlinerCollectionMove(editor, tree, cancelDrag) {
  const panel = tree.closest('.outliner') || tree.closest('.outliner-container') || tree
  const suppressedKeyups = new Set()
  let hovered = false
  let session = null

  function close(restoreFocus = true) {
    if (!session) return
    const { dialog, previousFocus, focusedRowId } = session
    session = null
    if (dialog.open && typeof dialog.close === 'function') dialog.close()
    dialog.remove()
    if (!restoreFocus) return
    const row = focusedRowId && [...tree.querySelectorAll('[data-outliner-id]')]
      .find(item => item.dataset.outlinerId === focusedRowId)
    const focus = previousFocus?.isConnected ? previousFocus
      : row?.querySelector('.outliner-move-handle') || document.getElementById('terminalInput')
    focus?.focus({ preventScroll: true })
  }

  function open() {
    cancelDrag?.()
    const elements = editor.selected.filter(element => element.attr?.('data-collection') !== 'true')
    const previousFocus = document.activeElement
    const dialog = node('dialog')
    dialog.className = 'outliner-move-dialog'
    dialog.setAttribute('aria-labelledby', 'outliner-move-title')
    dialog.setAttribute('aria-describedby', 'outliner-move-summary')
    const form = node('form')
    const heading = node('h2', 'Move to collection')
    heading.id = 'outliner-move-title'
    const summary = node('p', elements.length
      ? `Move ${elements.length} selected ${elements.length === 1 ? 'element' : 'elements'} to a collection.`
      : 'Select elements in the Outliner or viewport to move them.')
    summary.id = 'outliner-move-summary'
    const label = node('label', 'Destination collection')
    label.htmlFor = 'outliner-move-destination'
    const select = node('select')
    select.id = label.htmlFor
    select.name = 'collection'
    const destinations = new Map()
    for (const [id, data] of editor.collections) {
      if (data.group.parent()?.node !== editor.drawing.node || data.locked
        || data.group.attr('data-locked') === 'true') continue
      const option = node('option', data.group.attr('name') || id)
      option.value = id
      const plan = planTreeMove(editor, elements, data.group, 'inside')
      const alreadyInside = elements.length > 0 && elements.every(element => element.parent?.()?.node === data.group.node)
      option.disabled = alreadyInside || !plan.valid
      if (alreadyInside) option.title = 'The selected elements are already in this collection.'
      else if (!plan.valid) option.title = plan.reason
      select.append(option)
      destinations.set(id, data.group)
    }
    const newOption = node('option', 'New collection…')
    newOption.value = 'new'
    select.append(newOption)
    select.selectedIndex = [...select.options].findIndex(option => !option.disabled)

    const nameField = node('div')
    nameField.className = 'outliner-move-name-field'
    const nameLabel = node('label', 'New collection name')
    nameLabel.htmlFor = 'outliner-move-name'
    const name = node('input')
    name.id = nameLabel.htmlFor
    name.name = 'collection-name'
    name.type = 'text'
    name.maxLength = 256
    name.autocomplete = 'off'
    name.value = `Collection ${(editor.collectionIndex || 0) + 1}`
    nameField.append(nameLabel, name)

    const status = node('p')
    status.className = 'outliner-move-message'
    status.setAttribute('role', 'status')
    const actions = node('div')
    actions.className = 'outliner-move-actions'
    const cancel = node('button', 'Cancel')
    cancel.type = 'button'
    const submit = node('button', 'Move')
    submit.type = 'submit'
    actions.append(cancel, submit)
    form.append(heading, summary, label, select, nameField, status, actions)
    dialog.append(form)
    document.body.append(dialog)

    session = {
      dialog, elements, previousFocus,
      focusedRowId: previousFocus?.closest?.('[data-outliner-id]')?.dataset.outlinerId,
      root: editor.drawing, revision: editor.commandSessionRevision,
    }
    const unavailable = editor.mode !== 'model'
      ? 'Collections can only be changed in Model Space.'
      : !elements.length ? 'Select at least one element to move.'
        : elements.some(element => !canReorderTreeElement(editor, element))
          ? 'Locked or protected elements cannot be moved.' : ''
    status.textContent = unavailable
    select.disabled = submit.disabled = Boolean(unavailable)

    function updateNameField() {
      const creating = select.selectedOptions[0] === newOption
      nameField.hidden = !creating
      name.disabled = !creating || Boolean(unavailable)
      name.required = creating && !unavailable
    }
    updateNameField()
    select.addEventListener('change', () => {
      updateNameField()
      if (!name.disabled) {
        name.focus()
        name.select()
      }
    })
    cancel.addEventListener('click', () => close())
    dialog.addEventListener('cancel', event => {
      event.preventDefault()
      close()
    })
    dialog.addEventListener('close', () => {
      if (session?.dialog === dialog) close()
    })
    dialog.addEventListener('paste', event => event.stopPropagation())
    form.addEventListener('submit', event => {
      event.preventDefault()
      if (unavailable || session?.dialog !== dialog) return
      if (session.root !== editor.drawing || session.revision !== editor.commandSessionRevision
        || editor.mode !== 'model' || editor.isDrawing || editor.isInteracting || editor.isEditingVertex) {
        close()
        return
      }
      try {
        const destination = select.selectedOptions[0] === newOption
          ? { name: name.value } : { collection: destinations.get(select.value) }
        editor.execute(new MoveToCollectionCommand(editor, elements, destination))
        close()
      } catch (error) {
        status.textContent = error.message || 'The elements could not be moved.'
      }
    })
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    if (unavailable) cancel.focus()
    else if (!name.disabled) {
      name.focus()
      name.select()
    } else select.focus()
  }

  function onKeyDown(event) {
    if (session) {
      suppressedKeyups.add(event.code || event.key)
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        const focusable = [...session.dialog.querySelectorAll('button, select, input')]
          .filter(element => !element.disabled && !element.closest('[hidden]'))
        const index = focusable.indexOf(document.activeElement)
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus()
      }
      return
    }
    if (!hovered || event.key.toLowerCase() !== 'm' || event.repeat || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || editor.isDrawing || editor.isInteracting || editor.isEditingVertex || editor.isTypingText
      || editor.activeEditor === 'geometry-nodes'
      || document.querySelector('dialog[open], [role="dialog"][aria-hidden="false"], .prefs-overlay[aria-hidden="false"], .block-modal-overlay, #welcome-overlay')) return
    const editable = document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    if (editable && editable.id !== 'terminalInput') return
    event.preventDefault()
    event.stopImmediatePropagation()
    suppressedKeyups.add(event.code || event.key)
    open()
  }

  function onKeyUp(event) {
    const key = event.code || event.key
    if (!session && !suppressedKeyups.has(key)) return
    event.stopImmediatePropagation()
    suppressedKeyups.delete(key)
  }

  const enter = () => { hovered = true }
  const leave = () => { hovered = false }
  const reset = () => close(false)
  panel.addEventListener('pointerenter', enter)
  panel.addEventListener('pointerleave', leave)
  window.addEventListener('blur', leave)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  const resetSignals = ['documentSessionReset', 'editorModeChanged', 'activeEditorChanged', 'commandCancelled']
  resetSignals.forEach(name => editor.signals[name]?.add(reset))

  return {
    close,
    dispose() {
      close(false)
      panel.removeEventListener('pointerenter', enter)
      panel.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      resetSignals.forEach(name => editor.signals[name]?.remove(reset))
    },
  }
}

export { initOutlinerCollectionMove }
