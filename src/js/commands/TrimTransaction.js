const CROSS_TYPE_GEOMETRY_ATTRIBUTES = new Set([
  'cx',
  'cy',
  'd',
  'height',
  'points',
  'r',
  'rx',
  'ry',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
])

const TRANSIENT_ATTRIBUTES = new Set([
  'data-nanquim-transient',
  'id',
  'selected',
])

function childIndex(parent, element) {
  return Array.from(parent.node.children).indexOf(element.node)
}

function placementReference(parent, placement) {
  if (placement.nextSibling?.parentNode === parent.node) {
    return placement.nextSibling
  }
  return parent.node.children[placement.index] || null
}

function removeIfAttached(element) {
  if (element?.node?.parentNode) element.remove()
}

function stripInteractionState(element) {
  element.attr('data-nanquim-transient', null)
  element.attr('selected', null)
  element.removeClass('elementHover')
  element.removeClass('elementSelected')
}

function restoreSource(parent, source, placement) {
  if (source.node.parentNode === parent.node) return
  parent.node.insertBefore(source.node, placementReference(parent, placement))
}

function removeUnexpectedChildren(parent, childrenBefore) {
  Array.from(parent.node.children).forEach((node) => {
    if (!childrenBefore.has(node)) node.remove()
  })
}

export function captureTrimPlacement(parent, element) {
  return {
    index: childIndex(parent, element),
    nextSibling: element.node.nextSibling,
  }
}

export function insertTrimElement(parent, element, placement) {
  parent.node.insertBefore(element.node, placementReference(parent, placement))
}

export function insertTrimElements(parent, elements, placement) {
  const reference = placementReference(parent, placement)
  elements.forEach((element) => parent.node.insertBefore(element.node, reference))
}

export function prepareTrimClone(source) {
  const clone = source.clone()
  clone.attr('id', null)
  stripInteractionState(clone)
  return clone
}

export function copyTrimSemantics(source, target) {
  Array.from(source.node.attributes).forEach((attribute) => {
    if (TRANSIENT_ATTRIBUTES.has(attribute.name)
      || CROSS_TYPE_GEOMETRY_ATTRIBUTES.has(attribute.name)) return
    target.node.setAttribute(attribute.name, attribute.value)
  })
  stripInteractionState(target)
  target.attr('fill', 'none')
  target.node.style.fill = 'none'
  return target
}

export function allocateTrimIdentity(editor, element, fallbackName) {
  const id = editor.elementIndex
  element.attr('id', id)
  editor.elementIndex = id + 1
  if (!element.attr('name')) element.attr('name', `${fallbackName} ${id}`)
  return id
}

export function replaceTrimSource(parent, source, replacements, sourcePlacement) {
  const currentPlacement = captureTrimPlacement(parent, source)
  try {
    removeIfAttached(source)
    insertTrimElements(parent, replacements, sourcePlacement)
  } catch (error) {
    replacements.forEach(removeIfAttached)
    restoreSource(parent, source, currentPlacement)
    throw error
  }
}

export function restoreTrimSource(parent, source, replacements, sourcePlacement) {
  const replacementPlacements = replacements.map((element) => ({
    element,
    ...captureTrimPlacement(parent, element),
  }))

  try {
    replacements.forEach(removeIfAttached)
    restoreSource(parent, source, sourcePlacement)
  } catch (error) {
    removeIfAttached(source)
    replacementPlacements
      .sort((left, right) => left.index - right.index)
      .forEach(({ element, ...placement }) => insertTrimElement(parent, element, placement))
    throw error
  }
}

export function createAndReplaceTrimSource({
  createReplacements,
  editor,
  parent,
  source,
  sourcePlacement,
}) {
  const startingElementIndex = editor.elementIndex
  const childrenBefore = new Set(parent.node.children)
  let replacements = []

  try {
    replacements = createReplacements()
    if (!Array.isArray(replacements)) {
      throw new TypeError('Trim replacement factory must return an array')
    }
    replacements.forEach(removeIfAttached)
    replaceTrimSource(parent, source, replacements, sourcePlacement)
    return replacements
  } catch (error) {
    replacements.forEach(removeIfAttached)
    removeUnexpectedChildren(parent, childrenBefore)
    restoreSource(parent, source, sourcePlacement)
    editor.elementIndex = startingElementIndex
    throw error
  }
}

export function notifyTrimMutation(command) {
  const { editor } = command
  editor.spatialIndex?.markDirty()
  editor.fullSpatialIndex?.markDirty()
  command.dispatchSignal('updatedOutliner')
}
