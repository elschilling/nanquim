import { Command } from '../Command'
import {
  boundaryToPathD,
  extractSegments,
  findEnclosingBoundary,
  findIslands,
} from '../utils/boundaryDetection'
import {
  HATCH_TRANSFORM_DIAGNOSTIC,
  qualifyHatchGeometry,
  transformedGeometryContainsPoint,
  transformedGeometryIntersectsBoundary,
} from '../utils/hatchTransformQualification'
import { hasUnsupportedGeometryTransform } from '../utils/geometryTransformQualification'
import { ensurePattern, getPatternId, HATCH_PATTERNS } from '../utils/hatchPatterns'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../utils/svgNumericBounds'

const RECTANGLE_EPSILON = 1e-9

function finiteRectangleValue(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_SVG_GEOMETRY_MAGNITUDE
}

function rectangleHatchBoundary(rectangle) {
  const x = Number(rectangle.attr('x'))
  const y = Number(rectangle.attr('y'))
  const width = Number(rectangle.attr('width'))
  const height = Number(rectangle.attr('height'))
  const rawRx = rectangle.attr('rx')
  const rawRy = rectangle.attr('ry')
  const hasRx = rawRx !== undefined && rawRx !== null && rawRx !== ''
  const hasRy = rawRy !== undefined && rawRy !== null && rawRy !== ''
  let rx = hasRx ? Number(rawRx) : (hasRy ? Number(rawRy) : 0)
  let ry = hasRy ? Number(rawRy) : (hasRx ? Number(rawRx) : 0)

  if (![x, y, width, height, rx, ry].every(finiteRectangleValue)
    || width <= RECTANGLE_EPSILON || height <= RECTANGLE_EPSILON
    || rx < 0 || ry < 0
    || !finiteRectangleValue(x + width) || !finiteRectangleValue(y + height)) return null

  rx = Math.min(rx, width / 2)
  ry = Math.min(ry, height / 2)
  const right = x + width
  const bottom = y + height
  const point = { x: x + width / 2, y: y + height / 2 }

  if (rx <= RECTANGLE_EPSILON || ry <= RECTANGLE_EPSILON) {
    return {
      pathD: `M ${x} ${y} L ${right} ${y} L ${right} ${bottom} L ${x} ${bottom} Z`,
      point,
    }
  }

  return {
    pathD: [
      `M ${x + rx} ${y}`,
      `H ${right - rx}`,
      `A ${rx} ${ry} 0 0 1 ${right} ${y + ry}`,
      `V ${bottom - ry}`,
      `A ${rx} ${ry} 0 0 1 ${right - rx} ${bottom}`,
      `H ${x + rx}`,
      `A ${rx} ${ry} 0 0 1 ${x} ${bottom - ry}`,
      `V ${y + ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
      'Z',
    ].join(' '),
    point,
  }
}

function selectedRectangles(selection) {
  if (!Array.isArray(selection) || selection.length === 0
    || selection.some(element => element?.type !== 'rect')) return null
  return [...new Map(selection.map(element => [element.node, element])).values()]
}

function childIndex(element) {
  const parent = element.parent()
  return parent ? Array.from(parent.node.children).indexOf(element.node) : -1
}

function insertAt(parent, element, index) {
  const reference = index >= 0 ? parent.node.children[index] || null : null
  parent.node.insertBefore(element.node, reference)
}

function combinedError(error, rollbackErrors, message) {
  if (rollbackErrors.length === 0) return error
  return new AggregateError([error, ...rollbackErrors], message)
}

class HatchCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'HatchCommand'
    this.name = 'Hatch'
    this.hatchElement = null
    this.hatchParent = null
    this.hatchIndex = -1
    this.patternElement = null
    this.patternIndex = -1
    this.createdPattern = false
    this.interactiveExecutionDone = false
    this.patternType = editor.lastHatchPattern || 'SOLID'
    this.hatchScale = editor.lastHatchScale || 10
    this.pendingHatch = null
  }

  execute() {
    if (this.interactiveExecutionDone) {
      this._applyInitial()
      return
    }

    const patternLabel = HATCH_PATTERNS[this.patternType]?.label || this.patternType
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'HATCH ' })
    const rectangles = selectedRectangles(this.editor.selected)
    if (rectangles) {
      this.hatchSelectedRectangles(rectangles)
      return
    }
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `[${patternLabel} / scale ${this.hatchScale}] Select rectangles first or click inside a closed region to hatch.`,
    })

    this.editor.isInteracting = true
    this.editor.suppressHandlers = true
    this.editor.selectSingleElement = true
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
    this.editor.signals.pointCaptured.addOnce(this.onPointClicked, this)
  }

  hatchSelectedRectangles(rectangles) {
    if (rectangles.some(rectangle => (
      hasUnsupportedGeometryTransform(rectangle, this.editor.drawing)
    ))) {
      this.editor.signals.terminalLogged.dispatch({ msg: HATCH_TRANSFORM_DIAGNOSTIC })
      this.cleanup()
      return
    }

    const boundaries = rectangles.map(rectangleHatchBoundary)
    if (boundaries.some(boundary => !boundary)) {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'HATCH requires selected rectangles with finite positive dimensions.',
      })
      this.cleanup()
      return
    }

    this.pendingHatch = {
      boundaryCount: rectangles.length * 4,
      fillColor: this.getFillColor(),
      fillRule: 'nonzero',
      parent: this.editor.activeCollection || this.editor.drawing,
      pathD: boundaries.map(boundary => boundary.pathD).join(' '),
      point: { ...boundaries[0].point },
    }
    this.interactiveExecutionDone = true
    this.cleanup()
    this.editor.execute(this)
  }

  onPointClicked(point) {
    this.editor.signals.terminalLogged.dispatch({
      msg: `Detecting boundary at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})...`,
    })

    const geometryPolicy = qualifyHatchGeometry(this.editor)
    if (transformedGeometryContainsPoint(geometryPolicy, point)) {
      this.rejectTransformedBoundary()
      return
    }

    const segments = extractSegments(this.editor, geometryPolicy.safeElements)
    const boundaryEdges = findEnclosingBoundary(this.editor, point, segments)
    if (!boundaryEdges || boundaryEdges.length < 2) {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'No closed boundary found at that point. Try clicking inside a closed region.',
      })
      this.editor.signals.pointCaptured.addOnce(this.onPointClicked, this)
      return
    }

    if (transformedGeometryIntersectsBoundary(geometryPolicy, boundaryEdges, segments)) {
      this.rejectTransformedBoundary()
      return
    }

    let pathD = boundaryToPathD(boundaryEdges, segments)
    if (!pathD) {
      this.editor.signals.terminalLogged.dispatch({ msg: 'Failed to create hatch path.' })
      this.cleanup()
      return
    }
    findIslands(
      this.editor,
      boundaryEdges,
      segments,
      point,
      geometryPolicy.safeElements,
    ).forEach((islandPath) => {
      pathD += ` ${islandPath}`
    })

    this.pendingHatch = {
      boundaryCount: boundaryEdges.length,
      fillColor: this.getFillColor(),
      parent: this.editor.activeCollection || this.editor.drawing,
      pathD,
      point: { x: point.x, y: point.y },
    }
    this.interactiveExecutionDone = true
    this.cleanup()
    this.editor.execute(this)
  }

  getFillColor() {
    const collection = this.editor.activeCollection
    if (!collection) return '#888888'
    const collectionData = this.editor.collections?.get(collection.attr('id'))
    if (collectionData?.style?.stroke) return collectionData.style.stroke
    const stroke = collection.attr('stroke')
    return stroke && stroke !== 'none' ? stroke : '#888888'
  }

  rejectTransformedBoundary() {
    this.editor.signals.pointCaptured.addOnce(this.onPointClicked, this)
    this.editor.signals.terminalLogged.dispatch({ msg: HATCH_TRANSFORM_DIAGNOSTIC })
  }

  _applyInitial() {
    if (!this.pendingHatch?.pathD || !this.pendingHatch.parent) {
      throw new TypeError('Hatch creation requires a detected boundary.')
    }

    const editor = this.editor
    const startingElementIndex = editor.elementIndex
    const defs = editor.svg.defs()
    const defsBefore = new Set(Array.from(defs.node.children))
    const parentChildrenBefore = new Set(Array.from(this.pendingHatch.parent.node.children))
    const patternId = this.patternType === 'SOLID'
      ? null
      : getPatternId(this.patternType, this.pendingHatch.fillColor, this.hatchScale)
    const existingPattern = patternId ? defs.findOne(`#${patternId}`) : null
    try {
      let fillValue = { color: this.pendingHatch.fillColor, opacity: 1 }
      if (patternId) {
        const ensuredId = ensurePattern(
          editor.svg,
          this.patternType,
          this.pendingHatch.fillColor,
          this.hatchScale,
        )
        if (ensuredId) {
          this.patternElement = defs.findOne(`#${ensuredId}`)
          this.createdPattern = !existingPattern && Boolean(this.patternElement)
          this.patternIndex = this.patternElement ? childIndex(this.patternElement) : -1
          fillValue = `url(#${ensuredId})`
        }
      }

      this.hatchParent = this.pendingHatch.parent
      this.hatchElement = this.hatchParent.path(this.pendingHatch.pathD)
      this.hatchElement.fill(fillValue)
      this.hatchElement.attr({
        'fill-rule': this.pendingHatch.fillRule || 'evenodd',
        id: editor.elementIndex++,
        name: 'Hatch',
      })
      this.hatchElement.stroke({ width: 0, opacity: 0 })
      this.hatchElement.addClass('hatch-fill')
      this.hatchElement.data('hatchData', {
        clickPoint: { ...this.pendingHatch.point },
        fillColor: this.pendingHatch.fillColor,
        hatchScale: this.hatchScale,
        opacity: 1,
        patternType: this.patternType,
      })
      this.hatchElement.back()
      this.hatchIndex = childIndex(this.hatchElement)
    } catch (error) {
      this.hatchElement?.remove()
      Array.from(this.pendingHatch.parent.node.children).forEach((node) => {
        if (!parentChildrenBefore.has(node)) node.remove()
      })
      Array.from(defs.node.children).forEach((node) => {
        if (!defsBefore.has(node)) node.remove()
      })
      editor.elementIndex = startingElementIndex
      this.hatchElement = null
      this.patternElement = null
      this.createdPattern = false
      this.hatchIndex = -1
      this.patternIndex = -1
      throw error
    }

    editor.lastHatchPattern = this.patternType
    editor.lastHatchScale = this.hatchScale
    this._notify(`Hatch created with ${this.pendingHatch.boundaryCount} boundary edges.`)
  }

  cleanup() {
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
    this.editor.selectSingleElement = false
    this.editor.signals.pointCaptured.remove(this.onPointClicked, this)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)
  }

  undo() {
    try {
      this.hatchElement.remove()
      if (this.createdPattern) this.patternElement.remove()
    } catch (error) {
      const rollbackErrors = []
      try {
        if (this.createdPattern && !this.patternElement.parent()) {
          insertAt(this.editor.svg.defs(), this.patternElement, this.patternIndex)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        if (!this.hatchElement.parent()) {
          insertAt(this.hatchParent, this.hatchElement, this.hatchIndex)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      throw combinedError(
        error,
        rollbackErrors,
        `${error.message} Restoring the hatch also failed.`,
      )
    }
    this._notify('Undo: Hatch removed.')
  }

  redo() {
    try {
      if (this.createdPattern) {
        insertAt(this.editor.svg.defs(), this.patternElement, this.patternIndex)
      }
      insertAt(this.hatchParent, this.hatchElement, this.hatchIndex)
    } catch (error) {
      this.hatchElement.remove()
      if (this.createdPattern) this.patternElement.remove()
      throw error
    }
    this._notify('Redo: Hatch restored.')
  }

  _notify(message) {
    this.editor.spatialIndex.markDirty()
    this.editor.fullSpatialIndex.markDirty()
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('terminalLogged', { msg: message })
  }
}

function hatchCommand(editor) {
  const command = new HatchCommand(editor)
  command.execute()
}

export { HatchCommand, hatchCommand }
