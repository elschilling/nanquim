/**
 * Collection management module.
 * A collection is an SVG <g> group inside editor.drawing that groups elements
 * together. Each collection has visibility, lock, and default style properties.
 */

let collectionCounter = 0

/**
 * Initialize the collection system on the editor.
 * Creates `editor.collections` Map and a default collection.
 */
function initCollections(editor) {
    editor.collections = new Map()
    editor.activeCollection = null

    const defaultCollection = createCollection(editor, 'Collection 1')
    editor.activeCollection = defaultCollection
}

/**
 * Create a new collection (SVG <g> group) inside editor.drawing.
 * @param {object} editor
 * @param {string} name
 * @returns {SVG.G} the svg.js group element
 */
function createCollection(editor, name) {
    collectionCounter++
    const group = editor.drawing.group()
    const id = 'collection-' + collectionCounter
    group.attr('id', id)
    group.attr('name', name)
    group.attr('data-collection', 'true')

    const data = {
        group,
        visible: true,
        locked: false,
        style: {
            stroke: 'white',
            'stroke-width': 0.1,
            'stroke-linecap': 'round',
            fill: 'transparent',
        },
    }

    // Apply default style to the group so children inherit
    applyCollectionStyle(group, data.style)

    editor.collections.set(id, data)
    editor.activeCollection = group

    editor.signals.updatedCollections.dispatch()
    editor.signals.updatedOutliner.dispatch()

    return group
}

/**
 * Delete a collection and all its children.
 */
function deleteCollection(editor, id) {
    const data = editor.collections.get(id)
    if (!data) return

    // If we're deleting the active collection, switch to another
    if (editor.activeCollection === data.group) {
        editor.activeCollection = null
    }

    data.group.remove()
    editor.collections.delete(id)

    // If no collections left, create a default one
    if (editor.collections.size === 0) {
        createCollection(editor, 'Default')
    } else if (!editor.activeCollection) {
        // Set active to the first remaining collection
        const first = editor.collections.values().next().value
        editor.activeCollection = first.group
    }

    editor.signals.updatedCollections.dispatch()
    editor.signals.updatedOutliner.dispatch()
}

/**
 * Set the active collection for new draw operations.
 */
function setActiveCollection(editor, id) {
    const data = editor.collections.get(id)
    if (!data) return
    editor.activeCollection = data.group
    editor.signals.updatedCollections.dispatch()
    editor.signals.updatedOutliner.dispatch()
}

/**
 * Toggle visibility of a collection.
 */
function toggleVisibility(editor, id) {
    const data = editor.collections.get(id)
    if (!data) return

    data.visible = !data.visible
    if (data.visible) {
        data.group.show()
    } else {
        data.group.hide()
    }

    editor.signals.updatedCollections.dispatch()
    editor.signals.updatedOutliner.dispatch()
}

/**
 * Toggle lock state of a collection.
 */
function toggleLock(editor, id) {
    const data = editor.collections.get(id)
    if (!data) return

    data.locked = !data.locked
    editor.signals.updatedCollections.dispatch()
    editor.signals.updatedOutliner.dispatch()
}

/**
 * Update the default style of a collection and apply it to its group.
 */
function setCollectionStyle(editor, id, style) {
    const data = editor.collections.get(id)
    if (!data) return

    Object.assign(data.style, style)
    applyCollectionStyle(data.group, data.style)

    // Apply to child elements that don't override the property
    data.group.children().each((child) => {
        const overrides = getElementOverrides(child)
        Object.entries(style).forEach(([prop, value]) => {
            if (overrides[prop]) return // skip overridden properties
            child.css(prop, value)
        })
    })

    editor.signals.updatedOutliner.dispatch()
}

/**
 * Get which style properties an element overrides (doesn't inherit from collection).
 * Returns an object like { stroke: true, fill: true }
 */
function getElementOverrides(element) {
    try {
        const raw = element.attr('data-style-overrides')
        if (raw) return JSON.parse(raw)
    } catch (e) { /* ignore */ }
    return {}
}

/**
 * Set which style properties an element overrides.
 */
function setElementOverrides(element, overrides) {
    const filtered = {}
    Object.entries(overrides).forEach(([k, v]) => {
        if (v) filtered[k] = true
    })
    if (Object.keys(filtered).length > 0) {
        element.attr('data-style-overrides', JSON.stringify(filtered))
    } else {
        element.attr('data-style-overrides', null)
    }
}

/**
 * Apply collection style to a single element for non-overridden properties.
 */
function applyCollectionStyleToElement(editor, element) {
    const parent = element.parent()
    if (!parent || parent.attr('data-collection') !== 'true') return
    const data = editor.collections.get(parent.attr('id'))
    if (!data) return
    const overrides = getElementOverrides(element)
    Object.entries(data.style).forEach(([prop, value]) => {
        if (overrides[prop]) return
        element.css(prop, value)
    })
}

/**
 * Apply style properties to a collection's <g> element.
 * Children without explicit inline styles will inherit these.
 */
function applyCollectionStyle(group, style) {
    Object.entries(style).forEach(([prop, value]) => {
        group.css(prop, value)
    })
}

/**
 * Check if an element belongs to a hidden collection.
 */
function isElementHidden(editor, element) {
    const parent = element.parent()
    if (parent && parent.attr('data-collection') === 'true') {
        const data = editor.collections.get(parent.attr('id'))
        if (data && !data.visible) return true
    }
    return false
}

/**
 * Check if an element belongs to a locked collection.
 */
function isElementLocked(editor, element) {
    const parent = element.parent()
    if (parent && parent.attr('data-collection') === 'true') {
        const data = editor.collections.get(parent.attr('id'))
        if (data && data.locked) return true
    }
    return false
}

/**
 * Get all drawable elements across all visible collections.
 * Returns a flat array of SVG elements.
 */
function getDrawableElements(editor) {
    const elements = []
    editor.collections.forEach((data) => {
        if (!data.visible) return
        data.group.children().each((child) => {
            if (child.attr('data-hidden') === 'true') return
            elements.push(child)
        })
    })
    return elements
}

/**
 * Get all selectable elements (visible and not locked).
 */
function getSelectableElements(editor) {
    const elements = []
    editor.collections.forEach((data) => {
        if (!data.visible || data.locked) return
        data.group.children().each((child) => {
            if (child.attr('data-hidden') === 'true') return
            if (child.attr('data-locked') === 'true') return
            elements.push(child)
        })
    })
    return elements
}

/**
 * Toggle visibility of an individual element.
 */
function toggleElementVisibility(editor, element) {
    const isHidden = element.attr('data-hidden') === 'true'
    if (isHidden) {
        element.attr('data-hidden', null)
        element.show()
    } else {
        element.attr('data-hidden', 'true')
        element.hide()
        // Deselect if currently selected
        const idx = editor.selected.indexOf(element)
        if (idx > -1) editor.selected.splice(idx, 1)
    }
    editor.signals.updatedOutliner.dispatch()
}

/**
 * Toggle lock of an individual element.
 */
function toggleElementLock(editor, element) {
    const isLocked = element.attr('data-locked') === 'true'
    if (isLocked) {
        element.attr('data-locked', null)
    } else {
        element.attr('data-locked', 'true')
        // Deselect if currently selected
        const idx = editor.selected.indexOf(element)
        if (idx > -1) editor.selected.splice(idx, 1)
    }
    editor.signals.updatedOutliner.dispatch()
}

/**
 * Migrate legacy SVGs: wrap orphan elements (direct children of editor.drawing
 * that are not collection groups) into a Default collection.
 */
function migrateLegacyElements(editor) {
    const orphans = []
    editor.drawing.children().each((child) => {
        if (child.attr('data-collection') !== 'true') {
            orphans.push(child)
        }
    })

    if (orphans.length > 0) {
        // Get or create default collection
        let defaultGroup = editor.activeCollection
        if (!defaultGroup) {
            defaultGroup = createCollection(editor, 'Default')
        }
        orphans.forEach((el) => {
            el.putIn(defaultGroup)
        })
        editor.signals.updatedOutliner.dispatch()
    }
}

/**
 * Rebuild editor.collections from existing collection <g> groups in the drawing.
 * Called after loading an SVG file.
 */
function rebuildCollectionsFromDOM(editor) {
    editor.collections.clear()
    collectionCounter = 0

    editor.drawing.children().each((child) => {
        if (child.attr('data-collection') === 'true') {
            collectionCounter++
            const id = child.attr('id')
            const data = {
                group: child,
                visible: child.css('display') !== 'none',
                locked: child.attr('data-locked') === 'true',
                style: {
                    stroke: child.css('stroke') || 'white',
                    'stroke-width': parseFloat(child.css('stroke-width')) || 0.1,
                    'stroke-linecap': child.css('stroke-linecap') || 'round',
                    fill: child.css('fill') || 'transparent',
                },
            }
            editor.collections.set(id, data)
        }
    })

    // If no collections found, this is a legacy file
    if (editor.collections.size === 0) {
        const defaultGroup = createCollection(editor, 'Default')
        editor.activeCollection = defaultGroup
        migrateLegacyElements(editor)
    } else {
        // Set active to first collection
        const first = editor.collections.values().next().value
        editor.activeCollection = first.group
    }

    editor.signals.updatedCollections.dispatch()
    editor.signals.updatedOutliner.dispatch()
}

export {
    initCollections,
    createCollection,
    deleteCollection,
    setActiveCollection,
    toggleVisibility,
    toggleLock,
    setCollectionStyle,
    isElementHidden,
    isElementLocked,
    getDrawableElements,
    getSelectableElements,
    toggleElementVisibility,
    toggleElementLock,
    getElementOverrides,
    setElementOverrides,
    applyCollectionStyleToElement,
    migrateLegacyElements,
    rebuildCollectionsFromDOM,
}
