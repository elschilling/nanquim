/**
 * Spatial index for fast element lookups using an R-tree (rbush).
 *
 * Replaces O(n) full-scan hit-testing with O(log n + k) queries
 * where k is the number of candidates near the query region.
 *
 * All bounding boxes are stored in SVG root (viewBox) coordinate space
 * so they match the coordinates from svg.point(pageX, pageY).
 */
import RBush from 'rbush'
import { getSelectableElements } from './Collection'

/**
 * Transform a point from element-local space to SVG root (viewBox) space.
 * elCTM: element.getCTM() — local to screen
 * svgInv: precomputed inverse of svg.getCTM() — screen to viewBox
 */
function localToRoot(x, y, elCTM, svgInv) {
    // local → screen
    const sx = elCTM.a * x + elCTM.c * y + elCTM.e
    const sy = elCTM.b * x + elCTM.d * y + elCTM.f
    // screen → viewBox
    return {
        x: svgInv.a * sx + svgInv.c * sy + svgInv.e,
        y: svgInv.b * sx + svgInv.d * sy + svgInv.f,
    }
}

/**
 * Compute the axis-aligned bounding box of an element in SVG root space.
 * Returns { minX, minY, maxX, maxY, element } or null.
 */
function getElementBBox(el, svgNode) {
    try {
        const bbox = el.node.getBBox()
        if (bbox.width === 0 && bbox.height === 0 && bbox.x === 0 && bbox.y === 0) {
            return null
        }

        const elCTM = el.node.getCTM()
        const svgCTM = svgNode.getCTM()

        if (!elCTM || !svgCTM) {
            // No transform info — use local bbox as-is
            return {
                minX: bbox.x,
                minY: bbox.y,
                maxX: bbox.x + bbox.width,
                maxY: bbox.y + bbox.height,
                element: el,
            }
        }

        // Compute inverse of svgCTM once
        const svgInv = svgCTM.inverse()

        // Transform all 4 corners of the local bbox to root space
        const corners = [
            localToRoot(bbox.x, bbox.y, elCTM, svgInv),
            localToRoot(bbox.x + bbox.width, bbox.y, elCTM, svgInv),
            localToRoot(bbox.x + bbox.width, bbox.y + bbox.height, elCTM, svgInv),
            localToRoot(bbox.x, bbox.y + bbox.height, elCTM, svgInv),
        ]

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of corners) {
            if (c.x < minX) minX = c.x
            if (c.y < minY) minY = c.y
            if (c.x > maxX) maxX = c.x
            if (c.y > maxY) maxY = c.y
        }

        return { minX, minY, maxX, maxY, element: el }
    } catch (_e) {
        // getBBox / getCTM can throw for elements not in the DOM
        return null
    }
}

function SpatialIndex() {
    this.tree = new RBush()
    this._dirty = true
    this._svgNode = null
}

SpatialIndex.prototype = {
    /**
     * Mark the index as needing a rebuild on next query.
     */
    markDirty: function () {
        this._dirty = true
    },

    /**
     * Full rebuild: clears the tree and bulk-loads all selectable elements.
     * Bboxes are computed in SVG root (viewBox) coordinate space.
     */
    rebuild: function (editor) {
        this.tree.clear()
        const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
        if (!activeSvg) return
        this._svgNode = activeSvg.node
        const elements = getSelectableElements(editor)
        const items = []
        for (let i = 0; i < elements.length; i++) {
            const item = getElementBBox(elements[i], this._svgNode)
            if (item) items.push(item)
        }
        this.tree.load(items)
        this._dirty = false
    },

    /**
     * Ensure the index is up-to-date. Call before any search.
     */
    ensureFresh: function (editor) {
        if (this._dirty) {
            this.rebuild(editor)
        }
    },

    /**
     * Search for elements whose bounding box overlaps the given rectangle.
     * The rectangle must be in SVG root (viewBox) coordinate space.
     * @param {{ minX: number, minY: number, maxX: number, maxY: number }} rect
     * @returns {Array<{ minX, minY, maxX, maxY, element }>}
     */
    search: function (rect) {
        return this.tree.search(rect)
    },
}

export { SpatialIndex, getElementBBox }
