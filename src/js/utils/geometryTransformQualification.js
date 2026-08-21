function nodeHasTransform(node) {
  const attribute = node.getAttribute?.('transform')
  if (attribute && attribute.trim() !== '') return true

  const inline = node.style?.transform
  if (inline && inline !== 'none') return true

  const view = node.ownerDocument?.defaultView
  const computed = view?.getComputedStyle?.(node)?.transform
  return Boolean(computed && computed !== 'none')
}

export function hasOwnGeometryTransform(element) {
  return !element?.node || nodeHasTransform(element.node)
}

export function hasUnsupportedGeometryTransform(element, drawing) {
  if (!element?.node) return true

  const boundary = drawing?.node || null
  let node = element.node
  while (node && node !== boundary) {
    if (nodeHasTransform(node)) return true
    node = node.parentNode
  }

  return Boolean(boundary && node !== boundary)
}

export function hasUnsupportedAncestorTransform(element, drawing) {
  if (!element?.node) return true

  const boundary = drawing?.node || null
  let node = element.node.parentNode
  while (node && node !== boundary) {
    if (nodeHasTransform(node)) return true
    node = node.parentNode
  }

  return Boolean(boundary && node !== boundary)
}
