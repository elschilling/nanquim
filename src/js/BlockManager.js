/**
 * BlockManager.js
 *
 * Utilities for creating, inserting, listing, and exploding block definitions.
 * A block definition is a <g> inside SVG <defs>. Instances are <use> elements.
 */

/**
 * Create a block definition from the given elements.
 * Clones each element into a <g> inside <defs>, translated so that
 * basePoint becomes the origin (0,0).
 *
 * @param {object} editor
 * @param {string} name - unique block name
 * @param {Array} elements - SVG.js elements to include
 * @param {{x: number, y: number}} basePoint - base/insertion point
 * @returns {SVG.G} the definition group in <defs>
 */
function createBlockDefinition(editor, name, elements, basePoint) {
  const defs = editor.svg.defs()
  const defId = 'block-' + name

  const defGroup = defs.group()
    .attr('id', defId)
    .attr('data-block-def', 'true')
    .attr('data-base-point', JSON.stringify({ x: basePoint.x, y: basePoint.y }))

  elements.forEach(el => {
    const clone = el.clone()
    // Strip interaction classes
    clone.removeClass('elementHover')
    clone.removeClass('elementSelected')
    if (clone.type === 'g' && clone.children) {
      const stripRecursive = (node) => {
        node.removeClass('elementHover')
        node.removeClass('elementSelected')
        if (node.type === 'g' && node.children) {
          node.children().each(child => stripRecursive(child))
        }
      }
      stripRecursive(clone)
    }
    defGroup.add(clone)
  })

  // Translate all children so base point becomes origin
  defGroup.children().each(child => {
    translateElement(child, -basePoint.x, -basePoint.y)
  })

  // Store metadata
  editor.blockDefinitions.set(name, {
    defId,
    basePoint: { x: basePoint.x, y: basePoint.y },
    elementCount: elements.length,
  })

  return defGroup
}

/**
 * Insert a block instance (<use> element) into the drawing.
 *
 * @param {object} editor
 * @param {string} name - block name (must exist in blockDefinitions)
 * @param {{x: number, y: number}} position - insertion point
 * @param {SVG.G} parent - parent collection group
 * @returns {SVG.Use} the <use> element
 */
function insertBlockInstance(editor, name, position, parent) {
  const defId = 'block-' + name
  const defEl = editor.svg.defs().findOne('#' + CSS.escape(defId))
  if (!defEl) return null

  const id = editor.elementIndex++
  const useEl = parent.use(defEl)
    .attr('id', id)
    .attr('name', name)
    .attr('data-block-instance', 'true')
    .attr('data-block-name', name)
    .move(position.x, position.y)

  editor.spatialIndex.markDirty()
  editor.fullSpatialIndex.markDirty()

  return useEl
}

/**
 * Get the names of all defined blocks.
 * @param {object} editor
 * @returns {string[]}
 */
function getBlockNames(editor) {
  return Array.from(editor.blockDefinitions.keys())
}

/**
 * Rebuild editor.blockDefinitions from the SVG <defs> DOM.
 * Called during file load.
 * @param {object} editor
 */
function rebuildBlockDefinitionsFromDOM(editor) {
  editor.blockDefinitions = new Map()
  const defs = editor.svg.defs()
  const defGroups = defs.find('[data-block-def="true"]')

  defGroups.forEach(defGroup => {
    const defId = defGroup.attr('id')
    const name = defId.replace(/^block-/, '')
    let basePoint = { x: 0, y: 0 }
    try {
      const bp = defGroup.attr('data-base-point')
      if (bp) basePoint = JSON.parse(bp)
    } catch (e) { /* use default */ }

    editor.blockDefinitions.set(name, {
      defId,
      basePoint,
      elementCount: defGroup.children().length,
    })
  })
}

/**
 * Explode a block instance: replace <use> with cloned definition children.
 *
 * @param {object} editor
 * @param {SVG.Use} useElement - the <use> block instance
 * @returns {Array} array of new SVG.js elements inserted into the drawing
 */
function explodeBlockInstance(editor, useElement) {
  const blockName = useElement.attr('data-block-name')
  const defId = 'block-' + blockName
  const defEl = editor.svg.defs().findOne('#' + CSS.escape(defId))
  if (!defEl) return []

  const parent = useElement.parent()
  const posX = useElement.x()
  const posY = useElement.y()

  const newElements = []
  defEl.children().each(child => {
    const clone = child.clone()
    parent.add(clone)
    // Translate clone back to world position
    translateElement(clone, posX, posY)
    const id = editor.elementIndex++
    clone.attr('id', id)
    newElements.push(clone)
  })

  useElement.remove()
  editor.spatialIndex.markDirty()
  editor.fullSpatialIndex.markDirty()

  return newElements
}

/**
 * Translate an SVG element by dx, dy.
 * Handles different element types (line, circle, ellipse, rect, path, g, text, use).
 */
function translateElement(el, dx, dy) {
  const type = el.type

  if (type === 'line') {
    const arr = el.array()
    el.plot(arr.map(p => [p[0] + dx, p[1] + dy]))
  } else if (type === 'circle' || type === 'ellipse') {
    el.center(el.cx() + dx, el.cy() + dy)
  } else if (type === 'text') {
    el.x(el.x() + dx)
    el.y(el.y() + dy)
  } else if (type === 'g') {
    // Recurse into group children
    el.children().each(child => translateElement(child, dx, dy))
  } else if (type === 'use') {
    el.move(el.x() + dx, el.y() + dy)
  } else {
    // rect, path, polyline, polygon, etc.
    el.move(el.x() + dx, el.y() + dy)
  }

  // Update custom data attributes that store absolute positions
  const arcData = el.data('arcData')
  if (arcData) {
    el.data('arcData', {
      p1: { x: arcData.p1.x + dx, y: arcData.p1.y + dy },
      p2: { x: arcData.p2.x + dx, y: arcData.p2.y + dy },
      p3: { x: arcData.p3.x + dx, y: arcData.p3.y + dy },
    })
  }

  const ctd = el.data('circleTrimData')
  if (ctd) {
    el.data('circleTrimData', {
      ...ctd,
      cx: ctd.cx + dx,
      cy: ctd.cy + dy,
      startPt: { x: ctd.startPt.x + dx, y: ctd.startPt.y + dy },
      endPt: { x: ctd.endPt.x + dx, y: ctd.endPt.y + dy },
    })
  }

  const sd = el.data('splineData')
  if (sd) {
    el.data('splineData', {
      points: sd.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
    })
  }
}

/**
 * Enter block-edit mode: clone the definition contents into a temporary edit
 * group positioned at the instance's insertion point, and fade everything else.
 *
 * @param {object} editor
 * @param {SVG.Use} useElement - the block instance to edit
 * @returns {{ name, useElement, defGroup, editGroup }} editing state
 */
function enterBlockEdit(editor, useElement) {
  const name = useElement.attr('data-block-name')
  const defId = 'block-' + name
  const defGroup = editor.svg.defs().findOne('#' + CSS.escape(defId))
  if (!defGroup) return null

  const posX = useElement.x()
  const posY = useElement.y()

  // Create a temporary editing group inside the drawing group so it shares
  // panzoom with the rest of the canvas.  Marked as a collection so that
  // applyCollectionStyleToElement() can resolve styles for new elements.
  const editGroup = editor.drawing.group()
    .attr('id', 'block-edit-group')
    .attr('data-block-edit', 'true')
    .attr('data-collection', 'true')

  // Inherit style from the instance's parent collection
  const parentCollection = useElement.parent()
  const parentData = editor.collections.get(parentCollection.attr('id'))
  const editStyle = parentData
    ? { ...parentData.style }
    : { stroke: 'white', 'stroke-width': 0.1, 'stroke-linecap': 'round', fill: 'transparent', opacity: 1 }

  // Register as a temporary collection so style lookups work
  editor.collections.set('block-edit-group', {
    group: editGroup,
    visible: true,
    locked: false,
    style: editStyle,
  })

  // Apply the instance's transform (rotation/scale) to the edit group so that
  // cloned content and newly drawn elements share the same coordinate space.
  const instanceTransform = useElement.transform()
  editGroup.transform(instanceTransform)

  // Clone definition children into the edit group, translated to instance position
  defGroup.children().each(child => {
    const clone = child.clone()
    const id = editor.elementIndex++
    clone.attr('id', id)
    translateElement(clone, posX, posY)
    editGroup.add(clone)
  })

  // Hide the instance being edited
  useElement.hide()

  // Clear selection
  editor.signals.clearSelection.dispatch()

  // Add fade class to all collections
  editor.svg.node.classList.add('block-edit-mode')
  editGroup.node.classList.add('block-edit-active')

  // Redirect new draw elements into the edit group
  const savedActiveCollection = editor.activeCollection
  editor.activeCollection = editGroup

  editor.editingBlock = { name, useElement, defGroup, editGroup, savedActiveCollection }
  editor.spatialIndex.markDirty()
  editor.fullSpatialIndex.markDirty()
  editor.signals.updatedOutliner.dispatch()
  editor.signals.updatedProperties.dispatch()

  return editor.editingBlock
}

/**
 * Save block edits: update the definition from the edit group contents,
 * then refresh all instances.
 */
function saveBlockEdit(editor) {
  const state = editor.editingBlock
  if (!state) return

  const { name, useElement, defGroup, editGroup, savedActiveCollection } = state
  const meta = editor.blockDefinitions.get(name)
  const posX = useElement.x()
  const posY = useElement.y()

  // Clear the old definition contents
  defGroup.clear()

  // Copy edit group children into the definition, translated back to origin
  editGroup.children().each(child => {
    const clone = child.clone()
    clone.removeClass('elementHover')
    clone.removeClass('elementSelected')
    translateElement(clone, -posX, -posY)
    defGroup.add(clone)
  })

  // Update metadata
  if (meta) {
    meta.elementCount = defGroup.children().length
  }

  // Clean up
  editor.collections.delete('block-edit-group')
  editGroup.remove()
  useElement.show()
  editor.svg.node.classList.remove('block-edit-mode')
  editor.activeCollection = savedActiveCollection
  editor.editingBlock = null

  editor.spatialIndex.markDirty()
  editor.fullSpatialIndex.markDirty()
  editor.signals.clearSelection.dispatch()
  editor.signals.updatedOutliner.dispatch()
  editor.signals.updatedProperties.dispatch()
  editor.signals.refreshHandlers.dispatch()
}

/**
 * Discard block edits and exit edit mode.
 */
function discardBlockEdit(editor) {
  const state = editor.editingBlock
  if (!state) return

  const { useElement, editGroup, savedActiveCollection } = state

  editor.collections.delete('block-edit-group')
  editGroup.remove()
  useElement.show()
  editor.svg.node.classList.remove('block-edit-mode')
  editor.activeCollection = savedActiveCollection
  editor.editingBlock = null

  editor.spatialIndex.markDirty()
  editor.fullSpatialIndex.markDirty()
  editor.signals.clearSelection.dispatch()
  editor.signals.updatedOutliner.dispatch()
  editor.signals.updatedProperties.dispatch()
  editor.signals.refreshHandlers.dispatch()
}

export {
  createBlockDefinition,
  insertBlockInstance,
  getBlockNames,
  rebuildBlockDefinitionsFromDOM,
  explodeBlockInstance,
  translateElement,
  enterBlockEdit,
  saveBlockEdit,
  discardBlockEdit,
}
