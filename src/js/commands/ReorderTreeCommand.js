import { Matrix } from '@svgdotjs/svg.js'
import { Command } from '../Command'
import { applyCollectionStyleToElement, isElementHidden, isElementLocked } from '../Collection'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'
import { captureRootTransformContext, getParentToRootMatrix } from '../utils/rootSpaceTransform'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../utils/svgNumericBounds'

const DRAWABLE_TYPES = new Set(['g', 'line', 'rect', 'circle', 'ellipse', 'path', 'polyline', 'polygon', 'text', 'image', 'use'])
const INTERNAL_MARKERS = ['data-gn-derived', 'data-gn-output', 'data-gn-source', 'data-block-def', 'data-block-edit', 'data-block-ghost', 'data-paper-viewport', 'data-nanquim-transient']

function activeRoot(editor) {
  return editor.mode === 'paper' ? editor.paperAnnotations : editor.drawing
}

function isCollection(editor, element) {
  return element?.attr?.('data-collection') === 'true'
    && editor.collections?.get(element.attr('id'))?.group?.node === element.node
}

function isOrdinaryGroup(element) {
  return element?.type === 'g'
    && element.attr('data-group') === 'true'
    && element.attr('data-geometry-nodes') !== 'true'
}

function protectedPath(editor, element, root, includeSelf = true) {
  let current = includeSelf ? element : element?.parent?.()
  while (current?.node && current.node !== root?.node) {
    if (INTERNAL_MARKERS.some(name => current.attr(name) === 'true')) return true
    if (current.node !== element.node && current.attr('data-geometry-nodes') === 'true') return true
    if (isElementLocked(editor, current)) return true
    current = current.parent?.()
  }
  return current?.node !== root?.node || isElementLocked(editor, root)
}

function canReorderTreeElement(editor, element) {
  const root = activeRoot(editor)
  if (editor.editingBlock || !root?.node || !element?.node || element.node === root.node) return false
  if (!DRAWABLE_TYPES.has(element.type) || !root.node.contains(element.node)) return false
  if (protectedPath(editor, element, root)) return false
  if (element.attr('data-collection') === 'true') {
    return editor.mode === 'model' && isCollection(editor, element) && element.parent()?.node === root.node
  }
  return true
}

function orderedRoots(elements) {
  const unique = [...new Map(elements.map(element => [element?.node, element])).values()]
  return unique.filter(element => !unique.some(other => (
    other !== element && other?.node?.contains(element?.node)
  ))).sort((left, right) => (
    left.node.compareDocumentPosition(right.node) & 4 ? -1 : 1
  ))
}

function invalid(reason, noop = false) {
  return { valid: false, reason, noop }
}

/** Resolve a drop without touching geometry or allocating rendered helpers. */
function planTreeMove(editor, elements, target, position = 'inside') {
  const root = activeRoot(editor)
  if (!Array.isArray(elements) || elements.length === 0) return invalid('No elements to move.')
  if (editor.editingBlock) return invalid('Finish block editing before reorganizing the tree.')
  if (!root?.node || !target?.node || !['before', 'after', 'inside'].includes(position)) {
    return invalid('Choose a collection, group, or element in the active document.')
  }
  if (elements.some(element => !canReorderTreeElement(editor, element))) {
    return invalid('Locked elements and generated or inactive content cannot be moved.')
  }
  const sources = orderedRoots(elements)
  const collections = sources.every(element => isCollection(editor, element))
  if (!collections && sources.some(element => isCollection(editor, element))) {
    return invalid('Move collections separately from their contents.')
  }
  if (sources.some(element => element.node === target.node || element.node.contains(target.node))) {
    return invalid('An element cannot be moved into itself or its descendants.')
  }
  if (target.node !== root.node && !root.node.contains(target.node)) {
    return invalid('Elements cannot be moved between Model and Paper Space.')
  }

  const parent = position === 'inside' ? target : target.parent?.()
  if (!parent?.node || (parent.node !== root.node && !root.node.contains(parent.node))) {
    return invalid('Choose a destination inside the active drawing.')
  }
  if (collections) {
    if (editor.mode !== 'model' || parent.node !== root.node || position === 'inside' || !isCollection(editor, target)) {
      return invalid('Collections can only be reordered beside other collections.')
    }
  } else if (parent.node === root.node) {
    if (editor.mode !== 'paper') return invalid('Place elements inside a collection or group.')
  } else if (!isCollection(editor, parent) && !isOrdinaryGroup(parent)
    && !(position !== 'inside' && parent.type === 'g' && sources.every(element => element.parent()?.node === parent.node))) {
    return invalid('Only collections and ordinary groups can contain moved elements.')
  }
  if (protectedPath(editor, parent, root)
    || (target.node !== root.node && protectedPath(editor, target, root))) {
    return invalid('Locked or generated content cannot accept this drop.')
  }

  const nodes = new Set(sources.map(element => element.node))
  let before = position === 'before' ? target.node : position === 'after' ? target.node.nextSibling : null
  while (before && nodes.has(before)) before = before.nextSibling
  const previousChildren = Array.from(parent.node.childNodes)
  const remainingChildren = previousChildren.filter(node => !nodes.has(node))
  const index = before ? remainingChildren.indexOf(before) : remainingChildren.length
  const nextChildren = [...remainingChildren.slice(0, index), ...sources.map(element => element.node), ...remainingChildren.slice(index)]
  if (previousChildren.length === nextChildren.length && previousChildren.every((node, index) => node === nextChildren[index])) {
    return invalid('The elements are already in that position.', true)
  }
  return { valid: true, reason: '', elements: sources, parent, before, collections, root }
}

function owningCollection(editor, element) {
  let current = element
  while (current?.node?.nodeType === 1) {
    if (isCollection(editor, current)) return current
    if (current.type === 'svg') break
    current = current.parent?.()
  }
  return null
}

function snapshotAttributes(node) {
  return Array.from(node.attributes).map(attribute => ({
    name: attribute.name,
    localName: attribute.localName,
    namespace: attribute.namespaceURI,
    value: attribute.value,
  }))
}

function restoreAttributes(node, attributes) {
  const names = new Set(attributes.map(attribute => attribute.name))
  Array.from(node.attributes).forEach(attribute => {
    if (!names.has(attribute.name)) node.removeAttributeNS(attribute.namespaceURI, attribute.localName)
  })
  attributes.forEach(attribute => {
    if (node.getAttributeNS(attribute.namespace, attribute.localName) !== attribute.value) {
      node.setAttributeNS(attribute.namespace, attribute.name, attribute.value)
    }
  })
}

function captureState(editor, elements, collections) {
  return {
    placements: elements.map(element => ({
      element,
      parent: element.node.parentNode,
      index: Array.from(element.node.parentNode.childNodes).indexOf(element.node),
    })),
    attributes: elements.flatMap(element => [element.node, ...element.node.querySelectorAll('*')])
      .map(node => ({ node, attributes: snapshotAttributes(node) })),
    collections: collections ? Array.from(editor.collections) : null,
  }
}

function restoreState(editor, state) {
  state.placements.forEach(({ element }) => element.node.remove())
  const parents = new Map()
  state.placements.forEach(placement => {
    if (!parents.has(placement.parent)) parents.set(placement.parent, [])
    parents.get(placement.parent).push(placement)
  })
  parents.forEach(placements => placements.sort((left, right) => left.index - right.index).forEach(({ element, parent, index }) => {
    parent.insertBefore(element.node, parent.childNodes[index] || null)
  }))
  state.attributes.forEach(({ node, attributes }) => restoreAttributes(node, attributes))
  if (state.collections) {
    editor.collections.clear()
    state.collections.forEach(([key, value]) => editor.collections.set(key, value))
  }
}

function syncCollectionOrder(editor) {
  const previous = new Map(editor.collections)
  editor.collections.clear()
  editor.drawing.children().each(element => {
    const id = element.attr('id')
    if (previous.get(id)?.group?.node !== element.node) return
    editor.collections.set(id, previous.get(id))
    previous.delete(id)
  })
  previous.forEach((value, key) => editor.collections.set(key, value))
}

function compensatedTransform(element, parent, root) {
  const context = captureRootTransformContext(element, root)
  const destination = new Matrix(getParentToRootMatrix({ parent: () => parent }, root))
  const determinant = destination.a * destination.d - destination.b * destination.c
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    throw new Error('The destination transform cannot be inverted safely.')
  }
  if (['a', 'b', 'c', 'd', 'e', 'f'].every(key => (
    Math.abs(destination[key] - context.parentToRoot[key]) <= 1e-12
  ))) return null
  const matrix = destination.inverse().multiply(context.parentToRoot).multiply(context.local)
  if (!['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(matrix[key]) && Math.abs(matrix[key]) <= MAX_SVG_GEOMETRY_MAGNITUDE)) {
    throw new Error('The resulting transform exceeds supported geometry limits.')
  }
  return matrix.toString()
}

class ReorderTreeCommand extends Command {
  constructor(editor, elements, target, position = 'inside') {
    super(editor)
    this.type = 'ReorderTreeCommand'
    this.name = 'Reorganize tree'
    this.elements = [...elements]
    this.target = target
    this.position = position
    this.root = activeRoot(editor)
    this.selectionBefore = [...editor.selected]
    this.before = null
    this.after = null
  }

  execute() {
    if (this.after) return this.redo()
    if (activeRoot(this.editor)?.node !== this.root?.node) throw new Error('The active document changed before the drop.')
    const plan = planTreeMove(this.editor, this.elements, this.target, this.position)
    if (!plan.valid) throw new Error(plan.reason)
    const moves = plan.elements.map(element => ({
      element,
      transform: element.parent()?.node === plan.parent.node ? null : compensatedTransform(element, plan.parent, plan.root),
      restyle: !plan.collections && owningCollection(this.editor, element)?.node !== owningCollection(this.editor, plan.parent)?.node,
    }))
    this.elements = plan.elements
    this.collections = plan.collections
    this.before = captureState(this.editor, this.elements, this.collections)
    try {
      moves.forEach(({ element, transform, restyle }) => {
        plan.parent.node.insertBefore(element.node, plan.before)
        if (transform !== null) element.attr('transform', transform)
        if (restyle) applyCollectionStyleToElement(this.editor, element)
      })
      if (this.collections) syncCollectionOrder(this.editor)
      this.after = captureState(this.editor, this.elements, this.collections)
    } catch (error) {
      this.rollback(error, this.before)
    }
    this.notify(this.collections ? this.selectionBefore : this.elements)
  }

  rollback(error, state) {
    try {
      restoreState(this.editor, state)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `${error.message} Restoring the tree also failed.`)
    }
    throw error
  }

  restore(state, selection) {
    const previous = captureState(this.editor, this.elements, this.collections)
    try {
      restoreState(this.editor, state)
    } catch (error) {
      this.rollback(error, previous)
    }
    this.notify(selection)
  }

  undo() {
    this.restore(this.before, this.selectionBefore)
  }

  redo() {
    this.restore(this.after, this.collections ? this.selectionBefore : this.elements)
  }

  notify(selection) {
    invalidateSpatialIndexes(this.editor)
    this.dispatchSignal('clearSelection')
    const root = activeRoot(this.editor)
    this.editor.selected = selection.filter(element => (
      element?.node && root?.node?.contains(element.node)
      && !isElementHidden(this.editor, element) && !isElementLocked(this.editor, element)
    ))
    this.dispatchSignal(this.collections ? 'updatedCollections' : 'updatedOutliner')
    this.dispatchSignal('updatedSelection')
    if (this.root?.node === this.editor.drawing?.node) this.dispatchSignal('modelContentChanged')
  }
}

export { ReorderTreeCommand, canReorderTreeElement, planTreeMove }
