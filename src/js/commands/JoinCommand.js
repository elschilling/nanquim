import { Command } from '../Command'
import { isDerivedGeometry, isElementLocked } from '../Collection'
import { hasUnsupportedGeometryTransform } from '../utils/geometryTransformQualification'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'
import { MAX_SVG_GEOMETRY_MAGNITUDE } from '../utils/svgNumericBounds'
import { copyTrimSemantics } from './TrimTransaction'

const JOIN_TOLERANCE = 1e-6
const MAX_JOIN_ELEMENTS = 1000
const MAX_JOIN_SEGMENTS = 10000
const SUPPORTED_TYPES = new Set(['line', 'path', 'polyline'])
const JOIN_GEOMETRY_DATA = Object.freeze([
  ['arcData', 'data-arc-data'],
  ['circleTrimData', 'data-circle-trim-data'],
  ['ellipseArcData', 'data-ellipse-arc-data'],
  ['splineData', 'data-spline-data'],
])

function pointsEqual(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= JOIN_TOLERANCE
}

function finitePoint(point) {
  return point.length === 2
    && point.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_SVG_GEOMETRY_MAGNITUDE)
}

function finiteValues(values) {
  return values.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_SVG_GEOMETRY_MAGNITUDE)
}

function commandEndpoint(command) {
  if (command[0] === 'L') return [command[1], command[2]]
  if (command[0] === 'C') return [command[5], command[6]]
  if (command[0] === 'Q') return [command[3], command[4]]
  if (command[0] === 'A') return [command[6], command[7]]
  return null
}

function lineGeometry(element) {
  let points = null
  if (element.type === 'line') {
    points = [
      [Number(element.attr('x1')), Number(element.attr('y1'))],
      [Number(element.attr('x2')), Number(element.attr('y2'))],
    ]
  } else if (element.type === 'polyline') {
    try {
      points = element.array().map(([x, y]) => [Number(x), Number(y)])
    } catch (_) {
      return null
    }
  } else {
    return null
  }

  if (points.some(point => !finitePoint(point))) return null
  const deduplicated = points.filter((point, index) => (
    index === 0 || !pointsEqual(point, points[index - 1])
  ))
  if (deduplicated.length < 2 || pointsEqual(deduplicated[0], deduplicated.at(-1))) return null
  let current = deduplicated[0]
  const segments = deduplicated.slice(1).map((point) => {
    const segment = { command: ['L', point[0], point[1]], start: [...current] }
    current = point
    return segment
  })
  return {
    end: [...deduplicated.at(-1)],
    linearPoints: deduplicated,
    requiresPath: false,
    segments,
    start: [...deduplicated[0]],
  }
}

function pathGeometry(element) {
  let path
  try {
    path = element.array().map(segment => [...segment])
  } catch (_) {
    return null
  }
  if (path.length < 2 || path[0][0] !== 'M' || !finiteValues(path[0].slice(1))) return null

  const start = [Number(path[0][1]), Number(path[0][2])]
  if (!finitePoint(start)) return null
  let current = [...start]
  let cubicControl = null
  let quadraticControl = null
  const segments = []

  for (const raw of path.slice(1)) {
    const type = String(raw[0]).toUpperCase()
    const values = raw.slice(1).map(Number)
    if (!finiteValues(values) || type === 'M' || type === 'Z') return null

    let command = null
    if (type === 'L' && values.length === 2) {
      command = ['L', values[0], values[1]]
    } else if (type === 'H' && values.length === 1) {
      command = ['L', values[0], current[1]]
    } else if (type === 'V' && values.length === 1) {
      command = ['L', current[0], values[0]]
    } else if (type === 'C' && values.length === 6) {
      command = ['C', ...values]
    } else if (type === 'S' && values.length === 4) {
      const control = cubicControl
        ? [2 * current[0] - cubicControl[0], 2 * current[1] - cubicControl[1]]
        : [...current]
      command = ['C', control[0], control[1], ...values]
    } else if (type === 'Q' && values.length === 4) {
      command = ['Q', ...values]
    } else if (type === 'T' && values.length === 2) {
      const control = quadraticControl
        ? [2 * current[0] - quadraticControl[0], 2 * current[1] - quadraticControl[1]]
        : [...current]
      command = ['Q', control[0], control[1], ...values]
    } else if (type === 'A' && values.length === 7
      && values[0] > 0 && values[1] > 0
      && (values[3] === 0 || values[3] === 1)
      && (values[4] === 0 || values[4] === 1)) {
      command = ['A', ...values]
    } else {
      return null
    }

    const end = commandEndpoint(command)
    if (!end || !finitePoint(end)) return null
    segments.push({ command, start: [...current] })
    current = end
    cubicControl = type === 'C' || type === 'S'
      ? [command[3], command[4]]
      : null
    quadraticControl = type === 'Q' || type === 'T'
      ? [command[1], command[2]]
      : null
  }

  if (segments.length === 0 || pointsEqual(start, current)) return null
  return {
    end: [...current],
    linearPoints: null,
    requiresPath: true,
    segments,
    start,
  }
}

function curveGeometry(element) {
  if (!element || !SUPPORTED_TYPES.has(element.type)) return null
  return element.type === 'path' ? pathGeometry(element) : lineGeometry(element)
}

function reverseCommand(segment) {
  const { command, start } = segment
  if (command[0] === 'L') return ['L', start[0], start[1]]
  if (command[0] === 'C') {
    return ['C', command[3], command[4], command[1], command[2], start[0], start[1]]
  }
  if (command[0] === 'Q') return ['Q', command[1], command[2], start[0], start[1]]
  if (command[0] === 'A') {
    return [
      'A',
      command[1],
      command[2],
      command[3],
      command[4],
      command[5] === 1 ? 0 : 1,
      start[0],
      start[1],
    ]
  }
  return null
}

function orientGeometry(geometry, enterEndpoint) {
  if (enterEndpoint === 0) {
    return {
      commands: geometry.segments.map(segment => [...segment.command]),
      end: [...geometry.end],
      linearPoints: geometry.linearPoints?.map(point => [...point]) || null,
      start: [...geometry.start],
    }
  }
  return {
    commands: [...geometry.segments].reverse().map(reverseCommand),
    end: [...geometry.start],
    linearPoints: geometry.linearPoints
      ? [...geometry.linearPoints].reverse().map(point => [...point])
      : null,
    start: [...geometry.end],
  }
}

function endpointConnections(segments, segmentIndex, endpointIndex) {
  const point = endpointIndex === 0
    ? segments[segmentIndex].geometry.start
    : segments[segmentIndex].geometry.end
  const connections = []

  segments.forEach((segment, candidateIndex) => {
    if (candidateIndex === segmentIndex) return
    if (pointsEqual(point, segment.geometry.start)) connections.push({ candidateIndex, endpointIndex: 0 })
    if (pointsEqual(point, segment.geometry.end)) connections.push({ candidateIndex, endpointIndex: 1 })
  })
  return connections
}

function planJoinChain(elements) {
  if (elements.length > MAX_JOIN_ELEMENTS) {
    return { valid: false, reason: `JOIN supports at most ${MAX_JOIN_ELEMENTS} elements at a time.` }
  }
  const segments = elements.map((element, index) => ({
    element,
    geometry: curveGeometry(element),
    index,
  }))
  if (segments.some(segment => !segment.geometry)) {
    return { valid: false, reason: 'JOIN requires finite, non-degenerate open curve geometry.' }
  }
  const segmentCount = segments.reduce((total, segment) => total + segment.geometry.segments.length, 0)
  if (segmentCount > MAX_JOIN_SEGMENTS) {
    return { valid: false, reason: `JOIN supports at most ${MAX_JOIN_SEGMENTS} curve segments at a time.` }
  }

  const endpoints = segments.flatMap((segment, segmentIndex) => [0, 1].map(endpointIndex => ({
    connections: endpointConnections(segments, segmentIndex, endpointIndex),
    endpointIndex,
    segmentIndex,
  })))
  if (endpoints.some(endpoint => endpoint.connections.length > 1)) {
    return { valid: false, reason: 'JOIN requires one connected, non-branching chain.' }
  }

  const openEndpoints = endpoints.filter(endpoint => endpoint.connections.length === 0)
  if (openEndpoints.length !== 0 && openEndpoints.length !== 2) {
    return { valid: false, reason: 'JOIN requires one connected, non-branching chain.' }
  }

  const start = openEndpoints[0] || { endpointIndex: 0, segmentIndex: 0 }
  const used = new Set()
  const joined = []
  const commands = []
  let segmentIndex = start.segmentIndex
  let enterEndpoint = start.endpointIndex

  while (!used.has(segmentIndex)) {
    const segment = segments[segmentIndex]
    const oriented = orientGeometry(segment.geometry, enterEndpoint)
    if (commands.length === 0) commands.push(['M', oriented.start[0], oriented.start[1]])
    commands.push(...oriented.commands)
    if (oriented.linearPoints) {
      if (joined.length === 0) joined.push(...oriented.linearPoints)
      else joined.push(...oriented.linearPoints.slice(1))
    }
    used.add(segmentIndex)

    const exitEndpoint = enterEndpoint === 0 ? 1 : 0
    const connection = endpointConnections(segments, segmentIndex, exitEndpoint)
      .find(candidate => !used.has(candidate.candidateIndex))
    if (!connection) break
    segmentIndex = connection.candidateIndex
    enterEndpoint = connection.endpointIndex
  }

  if (used.size !== segments.length) {
    return { valid: false, reason: 'JOIN requires one connected, non-branching chain.' }
  }
  if (openEndpoints.length === 0 && joined.length > 0) joined[joined.length - 1] = [...joined[0]]
  if (openEndpoints.length === 0) commands.push(['Z'])

  return {
    closed: openEndpoints.length === 0,
    commands,
    points: joined,
    resultType: segments.some(segment => segment.geometry.requiresPath) ? 'path' : 'polyline',
    valid: true,
  }
}

function uniqueElements(elements) {
  return [...new Map(elements.filter(element => element?.node).map(element => [element.node, element])).values()]
}

function childIndex(parent, element) {
  return Array.from(parent.node.children).indexOf(element.node)
}

function sameNodes(actual, expected) {
  return actual.length === expected.length && actual.every((node, index) => node === expected[index])
}

function combinedError(error, rollbackError, message) {
  return rollbackError ? new AggregateError([error, rollbackError], message, { cause: error }) : error
}

class JoinElementsCommand extends Command {
  constructor(editor, elements = editor.selected) {
    super(editor)
    this.type = 'JoinElementsCommand'
    this.name = 'Join'
    const requestedElements = uniqueElements(elements)
    this.selectionBefore = [...editor.selected]
    this.parent = requestedElements[0]?.parent() || null
    this.placements = requestedElements.map(element => ({
      element,
      index: this.parent ? childIndex(this.parent, element) : -1,
    }))
    this.placements.sort((left, right) => left.index - right.index)
    this.elements = this.placements.map(placement => placement.element)
    this.styleSource = this.elements[0] || null
    this.resultIndex = this.placements.length > 0
      ? Math.min(...this.placements.map(placement => placement.index))
      : -1
    this.result = null
    this.originalChildren = this.parent ? Array.from(this.parent.node.children) : []
    this.appliedChildren = []
    this.plan = null
    this.validationMessage = this._validate()
  }

  get isValid() {
    return this.validationMessage === ''
  }

  _validate() {
    if (this.elements.length < 2) return 'Select at least two connected open curves to join.'
    if (this.elements.some(element => !SUPPORTED_TYPES.has(element.type))) {
      return 'JOIN supports connected open lines, polylines, arcs, elliptical arcs, splines, and SVG paths.'
    }
    if (!this.parent || this.elements.some(element => element.parent()?.node !== this.parent.node)) {
      return 'JOIN requires all selected elements to share the same parent.'
    }
    if (this.placements.some(placement => placement.index < 0)) {
      return 'JOIN cannot modify detached geometry.'
    }
    if (this.elements.some(element => isElementLocked(this.editor, element) || isDerivedGeometry(element))) {
      return 'JOIN cannot modify locked or generated geometry.'
    }
    if (this.elements.some(element => hasUnsupportedGeometryTransform(element, this.editor.drawing))) {
      return 'JOIN does not support transformed elements or ancestors.'
    }

    this.plan = planJoinChain(this.elements)
    return this.plan.valid ? '' : this.plan.reason
  }

  reportInvalid() {
    this.dispatchSignal('terminalLogged', { msg: this.validationMessage })
  }

  execute() {
    if (!this.isValid) throw new TypeError(this.validationMessage)
    const firstApply = !this.result
    const elementIndexBefore = this.editor.elementIndex
    const childrenBefore = Array.from(this.parent.node.children)

    try {
      if (firstApply) this._createResult()
      this._replaceChildren(this.originalChildren, this.appliedChildren)
    } catch (error) {
      let rollbackError = null
      try {
        this.parent.node.replaceChildren(...childrenBefore)
      } catch (failure) {
        rollbackError = failure
      }
      if (firstApply) {
        this.result?.remove()
        this.result = null
        this.appliedChildren = []
        this.editor.elementIndex = elementIndexBefore
      }
      invalidateSpatialIndexes(this.editor)
      throw combinedError(error, rollbackError, 'JOIN failed and its original geometry could not be fully restored.')
    }

    this._notify([this.result], `Joined ${this.elements.length} elements into one ${this.plan.resultType}.`)
  }

  undo() {
    this._replaceChildren(this.appliedChildren, this.originalChildren)
    this._notify(this.selectionBefore, 'Undo: joined elements restored.')
  }

  redo() {
    this._replaceChildren(this.originalChildren, this.appliedChildren)
    this._notify([this.result], `Redo: joined ${this.plan.resultType} restored.`)
  }

  _createResult() {
    const childrenBefore = Array.from(this.parent.node.children)
    try {
      this.result = this.plan.resultType === 'path'
        ? this.parent.path(this.plan.commands)
        : this.parent.polyline(this.plan.points)
      copyTrimSemantics(this.styleSource, this.result)
      JOIN_GEOMETRY_DATA.forEach(([dataKey, attribute]) => {
        this.result.data(dataKey, null)
        this.result.attr(attribute, null)
      })
      const id = this.editor.elementIndex++
      const resultName = this.plan.resultType === 'path' ? 'Joined Path' : 'Joined Polyline'
      this.result.attr({ id, name: `${resultName} ${id}` })
      this.result.remove()

      const selectedNodes = new Set(this.elements.map(element => element.node))
      const remaining = this.originalChildren.filter(node => !selectedNodes.has(node))
      const insertionIndex = this.originalChildren
        .slice(0, this.resultIndex)
        .filter(node => !selectedNodes.has(node)).length
      this.appliedChildren = [
        ...remaining.slice(0, insertionIndex),
        this.result.node,
        ...remaining.slice(insertionIndex),
      ]
    } catch (error) {
      this.parent.node.replaceChildren(...childrenBefore)
      throw error
    }
  }

  _replaceChildren(expected, replacement) {
    const current = Array.from(this.parent.node.children)
    if (!sameNodes(current, expected)) {
      throw new Error('JOIN geometry changed outside its History transaction.')
    }
    try {
      this.parent.node.replaceChildren(...replacement)
    } catch (error) {
      let rollbackError = null
      try {
        this.parent.node.replaceChildren(...current)
      } catch (failure) {
        rollbackError = failure
      }
      throw combinedError(error, rollbackError, 'JOIN could not restore its previous document boundary.')
    }
  }

  _notify(selection, message) {
    invalidateSpatialIndexes(this.editor)
    this.dispatchSignal('clearSelection')
    this.editor.selected = [...selection]
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('updatedOutliner')
    this.dispatchSignal('terminalLogged', { msg: message })
  }
}

class JoinCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'JoinCommand'
    this.name = 'Join'
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnElementSelected = this.onElementSelected.bind(this)
    this.sessionActive = false
  }

  execute() {
    this.dispatchSignal('terminalLogged', { type: 'strong', msg: 'JOIN ' })
    if (this.editor.selected.length >= 2) {
      this.confirmSelection()
      return
    }

    this.sessionActive = true
    this.editor.isInteracting = true
    this.editor.suppressHandlers = true
    this.dispatchSignal('terminalLogged', {
      type: 'span',
      msg: 'Select connected open curves and press Enter to join. Esc cancels.',
    })
    document.addEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.toogledSelect.add(this.boundOnElementSelected)
    this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
  }

  onElementSelected(element) {
    if (!element?.node) return
    const index = this.editor.selected.findIndex(selected => selected?.node === element.node)
    if (index >= 0) this.editor.selected.splice(index, 1)
    else this.editor.selected.push(element)
    this.dispatchSignal('updatedSelection')
  }

  onKeyDown(event) {
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
      event.preventDefault()
      this.confirmSelection()
    } else if (event.key === 'Escape') {
      this.cleanup()
      this.dispatchSignal('terminalLogged', { msg: 'JOIN cancelled.' })
    }
  }

  confirmSelection() {
    const elements = [...this.editor.selected]
    this.cleanup()
    const mutation = new JoinElementsCommand(this.editor, elements)
    if (!mutation.isValid) {
      mutation.reportInvalid()
      return null
    }

    try {
      return this.editor.execute(mutation)
    } catch (error) {
      this.dispatchSignal('terminalLogged', { msg: `JOIN failed: ${error.message}` })
      return null
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    this.editor.signals.commandCancelled.remove(this.cleanup, this)
    this.sessionActive = false
    this.editor.isInteracting = false
    this.editor.suppressHandlers = false
  }
}

function joinCommand(editor) {
  const command = new JoinCommand(editor)
  command.execute()
  return command
}

export { JOIN_TOLERANCE, JoinCommand, JoinElementsCommand, joinCommand, planJoinChain }
