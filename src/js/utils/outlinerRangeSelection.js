import { isDerivedGeometry, isElementHidden, isElementLocked } from '../Collection'

function initOutlinerRangeSelection(editor, tree, clearVisuals) {
  const elements = new WeakMap()
  let anchor = null
  let baseline = []
  let selecting = false

  const isCollection = element => element?.attr?.('data-collection') === 'true'
  const blocked = () => editor.preventSelection || editor.isInteracting
    || editor.isEditingVertex || editor.selectSingleElement || editor.activeEditor === 'geometry-nodes'

  function reset() {
    anchor = null
    baseline = []
  }

  function selectable(element) {
    const root = editor.editingBlock?.editGroup
      || (editor.mode === 'paper' ? editor.paperAnnotations : editor.drawing)
    if (!element?.node || element.node === root?.node || !root?.node.contains(element.node)
      || isElementHidden(editor, element) || isElementLocked(editor, element) || isDerivedGeometry(element)) return false
    let current = element
    while (current?.node && current.node !== root.node) {
      if (current.attr('data-gn-source') === 'true' || current.attr('data-nanquim-transient') === 'true') return false
      current = current.parent?.()
    }
    return true
  }

  function selectRange(element) {
    if (!anchor || isCollection(anchor) !== isCollection(element)) return false
    const collections = isCollection(element)
    const visible = [...tree.querySelectorAll('[data-outliner-id]')]
      .map(row => elements.get(row))
      .filter(item => selectable(item) && isCollection(item) === collections)
    const start = visible.indexOf(anchor)
    const end = visible.indexOf(element)
    if (start < 0 || end < 0) return false
    const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1)
    const candidates = [...new Map([
      ...baseline.filter(item => selectable(item) && isCollection(item) === collections),
      ...range,
    ].map(item => [item.node, item])).values()]
    // A selected group already contains its children. Keep each geometry root
    // once so commands cannot copy or transform an expanded subtree twice.
    const nodes = new Set(candidates.map(item => item.node))
    const selected = candidates.filter(item => {
      let parent = item.node.parentNode
      while (parent) {
        if (nodes.has(parent)) return false
        parent = parent.parentNode
      }
      return true
    }).sort((left, right) => left.node.compareDocumentPosition(right.node) & 4 ? -1 : 1)
    clearVisuals()
    editor.selected = selected
    editor.signals.updatedSelection.dispatch()
    return true
  }

  function select(event, element, selectNormally) {
    selecting = true
    try {
      if (event.shiftKey && !blocked()) {
        if (!selectable(element)) return
        if (selectRange(element)) {
          event.preventDefault()
          return
        }
      }
      selectNormally()
      if (!blocked() && selectable(element) && editor.selected.includes(element)) {
        anchor = element
        baseline = [...editor.selected]
      } else reset()
    } finally {
      selecting = false
    }
  }

  editor.signals.updatedSelection.add(() => {
    if (!selecting) reset()
  })
  for (const name of ['clearSelection', 'documentSessionReset', 'editorModeChanged', 'activeEditorChanged', 'commandCancelled']) {
    editor.signals[name]?.add(reset)
  }

  return {
    bindRow(row, element) { elements.set(row, element) },
    select,
    reset,
  }
}

export { initOutlinerRangeSelection }
