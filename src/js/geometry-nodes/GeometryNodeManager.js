import { SVG } from '@svgdotjs/svg.js'
import { GraphEvaluator } from './core/GraphEvaluator.js'
import { NodeGraph, createDefaultNodeGraph } from './core/NodeGraph.js'
import { createBuiltinRegistry, socketTypesCompatible } from './core/NodeRegistry.js'
import { createId } from './core/ids.js'
import { SvgGeometryAdapter } from './SvgGeometryAdapter.js'
import { SvgOutputRenderer } from './SvgOutputRenderer.js'
import { parseSafeJson } from '../utils/sanitizeSvg.js'
import {
  ApplyGeometryNodesCommand,
  AttachGeometryNodesCommand,
  GraphSnapshotCommand,
  RemoveGeometryNodesCommand,
  SetGeometryNodesEnabledCommand,
  cloneData,
} from './GeometryNodeCommands.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SCHEMA_VERSION = 1
const GRAPH_VIEW_ZOOM_MIN = 0.2
const GRAPH_VIEW_ZOOM_MAX = 2.5
const MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS = 128
const SERIALIZED_GEOMETRY_NODE_LIMITS = Object.freeze({
  maxGraphs: 128,
  maxInstances: 4096,
  maxNodesPerGraph: 2048,
  maxLinksPerGraph: 8192,
  maxTotalNodes: 10000,
  maxTotalLinks: 40000,
  maxInterfaceSockets: 128,
  maxIdentifierLength: 256,
  maxLabelLength: 1024,
  maxStringLength: 4 * 1024 * 1024,
  maxValueNodes: 100000,
  maxValueDepth: 64,
})
const GEOMETRY_NODE_LOAD_RENDER_LIMITS = Object.freeze({
  remainingItems: 100000,
  remainingElements: 100000,
  remainingTextLength: 4 * 1024 * 1024,
  remainingAttributeLength: 16 * 1024 * 1024,
  remainingPayloadLength: 32 * 1024 * 1024,
  remainingEvaluatedNodes: 100000,
  remainingProcessedLinks: 100000,
  remainingSocketValues: 100000,
  remainingMaterializedItems: 100000,
  remainingMaterializedValueNodes: 2000000,
  remainingSourceItems: 100000,
  remainingSourceElements: 100000,
  remainingSourceTextLength: 4 * 1024 * 1024,
  remainingSourceAttributeLength: 16 * 1024 * 1024,
  remainingSourceSerializedLength: 32 * 1024 * 1024,
})

function createLoadRenderBudget(overrides = {}) {
  return { ...GEOMETRY_NODE_LOAD_RENDER_LIMITS, ...(overrides || {}) }
}

const BATCH_STOP_BUDGET_KEYS = Object.freeze([
  'remainingItems',
  'remainingElements',
  'remainingTextLength',
  'remainingAttributeLength',
  'remainingPayloadLength',
  'remainingEvaluatedNodes',
  'remainingProcessedLinks',
  'remainingSocketValues',
  'remainingMaterializedItems',
  'remainingMaterializedValueNodes',
  'remainingSourceItems',
  'remainingSourceElements',
  'remainingSourceTextLength',
  'remainingSourceAttributeLength',
  'remainingSourceSerializedLength',
])

function batchBudgetExhausted(budget) {
  return Boolean(budget && BATCH_STOP_BUDGET_KEYS.some((key) => (
    Number.isFinite(budget[key]) && budget[key] <= 0
  )))
}

function boundedDiagnostics(value, fallbackMessage = '') {
  const source = Array.isArray(value) ? value : []
  if (source.length === 0) {
    return fallbackMessage
      ? [{
          level: 'error',
          severity: 'error',
          code: 'evaluation-failed',
          message: fallbackMessage,
        }]
      : []
  }
  if (source.length <= MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS) return source.slice()

  const retainedCount = MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS - 1
  const retained = source.slice(0, retainedCount)
  let omittedHasError = false
  for (let index = retainedCount; index < source.length; index += 1) {
    const item = source[index]
    if (item && (item.level === 'error' || item.severity === 'error')) {
      omittedHasError = true
      break
    }
  }
  const omittedCount = source.length - retainedCount
  retained.push({
    level: omittedHasError ? 'error' : 'warning',
    severity: omittedHasError ? 'error' : 'warning',
    code: 'diagnostics-truncated',
    message: `${omittedCount} additional graph diagnostics were omitted`,
    omittedCount,
  })
  return retained
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertBoundedString(value, label, maxLength, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new TypeError(`${label} is required.`)
    return ''
  }
  const text = String(value)
  if (text.length > maxLength) throw new RangeError(`${label} exceeds the safe length limit.`)
  return text
}

function assertBoundedSerializedValue(value, limits = SERIALIZED_GEOMETRY_NODE_LIMITS) {
  const pending = [{ value, depth: 0 }]
  const visited = new WeakSet()
  let nodes = 0
  let stringLength = 0

  while (pending.length > 0) {
    const entry = pending.pop()
    nodes += 1
    if (nodes > limits.maxValueNodes || entry.depth > limits.maxValueDepth) {
      throw new RangeError('Geometry Nodes metadata exceeds the safe complexity limit.')
    }
    if (typeof entry.value === 'string') {
      stringLength += entry.value.length
      if (stringLength > limits.maxStringLength) {
        throw new RangeError('Geometry Nodes metadata exceeds the safe text limit.')
      }
      continue
    }
    if (!entry.value || typeof entry.value !== 'object') continue
    if (visited.has(entry.value)) continue
    visited.add(entry.value)

    if (Array.isArray(entry.value)) {
      for (let index = 0; index < entry.value.length; index += 1) {
        pending.push({ value: entry.value[index], depth: entry.depth + 1 })
      }
      continue
    }

    const keys = Object.keys(entry.value)
    if (keys.some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
      throw new TypeError('Geometry Nodes metadata contains an unsafe object key.')
    }
    keys.forEach((key) => {
      stringLength += key.length
      if (stringLength > limits.maxStringLength) {
        throw new RangeError('Geometry Nodes metadata exceeds the safe text limit.')
      }
      pending.push({ value: entry.value[key], depth: entry.depth + 1 })
    })
  }
}

function assertSerializedGeometryNodes(value, limits = SERIALIZED_GEOMETRY_NODE_LIMITS) {
  if (!isRecord(value)) throw new TypeError('Geometry Nodes metadata must be an object.')
  assertBoundedSerializedValue(value, limits)

  const metadataVersion = value.version === undefined ? value.schemaVersion : value.version
  if (metadataVersion !== undefined && (
    !Number.isInteger(metadataVersion) || metadataVersion < 1 || metadataVersion > SCHEMA_VERSION
  )) {
    throw new TypeError(`Unsupported Geometry Nodes metadata version: ${metadataVersion}`)
  }

  const graphs = value.graphs === undefined ? [] : value.graphs
  const instances = value.instances === undefined ? [] : value.instances
  if (!Array.isArray(graphs) || graphs.length > limits.maxGraphs) {
    throw new RangeError('Geometry Nodes metadata contains too many graph assets.')
  }
  if (!Array.isArray(instances) || instances.length > limits.maxInstances) {
    throw new RangeError('Geometry Nodes metadata contains too many modifier instances.')
  }

  let totalNodes = 0
  let totalLinks = 0
  const graphIds = new Set()
  graphs.forEach((graph) => {
    if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
      throw new TypeError('Geometry Nodes graph assets require node and link arrays.')
    }
    if (graph.schemaVersion !== undefined && (
      !Number.isInteger(graph.schemaVersion) || graph.schemaVersion < 1 || graph.schemaVersion > SCHEMA_VERSION
    )) {
      throw new TypeError(`Unsupported Geometry Nodes graph version: ${graph.schemaVersion}`)
    }
    if (graph.nodes.length > limits.maxNodesPerGraph || graph.links.length > limits.maxLinksPerGraph) {
      throw new RangeError('A Geometry Nodes graph exceeds the safe topology limit.')
    }
    totalNodes += graph.nodes.length
    totalLinks += graph.links.length
    if (totalNodes > limits.maxTotalNodes || totalLinks > limits.maxTotalLinks) {
      throw new RangeError('Geometry Nodes metadata exceeds the safe total topology limit.')
    }

    const graphId = assertBoundedString(
      graph.id,
      'Geometry Nodes graph id',
      limits.maxIdentifierLength,
    )
    assertBoundedString(graph.name, 'Geometry Nodes graph name', limits.maxLabelLength)
    if (graphId && graphIds.has(graphId)) throw new TypeError(`Duplicate Geometry Nodes graph id: ${graphId}`)
    if (graphId) graphIds.add(graphId)

    if (graph.interface !== undefined && graph.interface !== null) {
      if (!isRecord(graph.interface)) throw new TypeError('Geometry Nodes graph interface must be an object.')
      for (const direction of ['inputs', 'outputs']) {
        const sockets = graph.interface[direction]
        if (sockets !== undefined && (!Array.isArray(sockets) || sockets.length > limits.maxInterfaceSockets)) {
          throw new RangeError('Geometry Nodes graph interface exceeds the safe socket limit.')
        }
        ;(sockets || []).forEach((socket) => {
          if (!isRecord(socket)) throw new TypeError('Geometry Nodes graph contains an invalid interface socket.')
          assertBoundedString(socket.id, 'Geometry Nodes socket id', limits.maxIdentifierLength)
          assertBoundedString(socket.name, 'Geometry Nodes socket name', limits.maxLabelLength)
          assertBoundedString(socket.type, 'Geometry Nodes socket type', limits.maxIdentifierLength)
        })
      }
    }
    if (graph.view !== undefined) {
      if (!isRecord(graph.view)) throw new TypeError('Geometry Nodes graph view must be an object.')
      if (
        !Number.isFinite(graph.view.x)
        || !Number.isFinite(graph.view.y)
        || !Number.isFinite(graph.view.zoom)
      ) {
        throw new TypeError('Geometry Nodes graph view requires finite x, y, and zoom values.')
      }
      if (graph.view.zoom < GRAPH_VIEW_ZOOM_MIN || graph.view.zoom > GRAPH_VIEW_ZOOM_MAX) {
        throw new RangeError('Geometry Nodes graph view zoom is outside the supported range.')
      }
    }
    graph.nodes.forEach((node) => {
      if (!isRecord(node) || (node.values !== undefined && node.values !== null && !isRecord(node.values))) {
        throw new TypeError('Geometry Nodes graph contains an invalid node.')
      }
      assertBoundedString(node.id, 'Geometry Nodes node id', limits.maxIdentifierLength)
      assertBoundedString(node.type, 'Geometry Nodes node type', limits.maxIdentifierLength)
    })
    graph.links.forEach((link) => {
      if (!isRecord(link)) throw new TypeError('Geometry Nodes graph contains an invalid link.')
      for (const field of ['id', 'fromNode', 'fromSocket', 'toNode', 'toSocket']) {
        assertBoundedString(link[field], `Geometry Nodes link ${field}`, limits.maxIdentifierLength)
      }
    })
  })

  const instanceIds = new Set()
  const objectIds = new Set()
  instances.forEach((instance) => {
    if (!isRecord(instance) || (
      instance.inputs !== undefined && instance.inputs !== null && !isRecord(instance.inputs)
    )) {
      throw new TypeError('Geometry Nodes metadata contains an invalid modifier instance.')
    }
    const instanceId = assertBoundedString(
      instance.id,
      'Geometry Nodes modifier id',
      limits.maxIdentifierLength,
      { required: true },
    )
    const objectId = assertBoundedString(
      instance.objectId,
      'Geometry Nodes object id',
      limits.maxIdentifierLength,
      { required: true },
    )
    assertBoundedString(
      instance.graphId,
      'Geometry Nodes modifier graph id',
      limits.maxIdentifierLength,
      { required: true },
    )
    if (instanceId && instanceIds.has(instanceId)) {
      throw new TypeError(`Duplicate Geometry Nodes modifier id: ${instanceId}`)
    }
    if (objectId && objectIds.has(objectId)) {
      throw new TypeError(`Duplicate Geometry Nodes object id: ${objectId}`)
    }
    if (instanceId) instanceIds.add(instanceId)
    if (objectId) objectIds.add(objectId)
  })

  assertBoundedString(value.activeObjectId, 'Geometry Nodes active object id', limits.maxIdentifierLength)

  return value
}

function domNode(value) {
  if (!value) return null
  return value.node || value
}

function svgElement(value) {
  if (!value) return null
  return value.node ? value : SVG(value)
}

function attributeSnapshot(node) {
  return Object.fromEntries(Array.from(node.attributes || []).map((attribute) => [attribute.name, attribute.value]))
}

function restoreAttributes(node, attributes) {
  Array.from(node.attributes || []).forEach((attribute) => node.removeAttribute(attribute.name))
  Object.entries(attributes || {}).forEach(([name, value]) => node.setAttribute(name, value))
}

function removeGeometryNodeMetadata(root) {
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    Array.from(element.attributes || []).forEach((attribute) => {
      if (attribute.name === 'data-geometry-nodes' || attribute.name.startsWith('data-gn-')) {
        element.removeAttribute(attribute.name)
      }
    })
  })
}

function normalizeNodes(nodes) {
  if (nodes instanceof Map) return Array.from(nodes.values())
  if (Array.isArray(nodes)) return nodes
  if (nodes && typeof nodes === 'object') return Object.values(nodes)
  return []
}

function normalizeLinks(links) {
  if (links instanceof Map) return Array.from(links.values())
  if (Array.isArray(links)) return links
  if (links && typeof links === 'object') return Object.values(links)
  return []
}

function ensureGraphJSONShape(value) {
  const json = cloneData(value || {})
  json.id = json.id || createId('graph')
  json.name = json.name || 'Geometry Nodes'
  json.nodes = normalizeNodes(json.nodes).map((node) => ({ ...node, values: { ...(node.values || {}) } }))
  json.links = normalizeLinks(json.links).map((link) => ({ ...link }))
  return json
}

function graphNode(graph, id) {
  if (!graph) return null
  if (graph.nodes instanceof Map) return graph.nodes.get(id) || null
  return normalizeNodes(graph.nodes).find((node) => node.id === id) || null
}

function graphLink(graph, id) {
  if (!graph) return null
  if (graph.links instanceof Map) return graph.links.get(id) || null
  return normalizeLinks(graph.links).find((link) => link.id === id) || null
}

function socketById(sockets, id) {
  return Array.from(sockets || []).find((socket) => socket.id === id) || null
}

function pathExists(links, startNodeId, targetNodeId) {
  if (startNodeId === targetNodeId) return true
  const adjacency = new Map()
  normalizeLinks(links).forEach((link) => {
    if (!adjacency.has(link.fromNode)) adjacency.set(link.fromNode, [])
    adjacency.get(link.fromNode).push(link.toNode)
  })

  const visited = new Set([startNodeId])
  const pending = [startNodeId]
  while (pending.length > 0) {
    const nodeId = pending.pop()
    for (const nextNodeId of adjacency.get(nodeId) || []) {
      if (nextNodeId === targetNodeId) return true
      if (visited.has(nextNodeId)) continue
      visited.add(nextNodeId)
      pending.push(nextNodeId)
    }
  }
  return false
}

function insertionSocketScore(sourceSocket, targetSocket, inputSocket, outputSocket) {
  const sourceType = sourceSocket.type || 'any'
  const targetType = targetSocket.type || 'any'
  const inputType = inputSocket.type || 'any'
  const outputType = outputSocket.type || 'any'
  const geometryWire = sourceType === 'geometry' || targetType === 'geometry'
  let score = 0

  // Geometry modifiers conventionally expose a geometry passthrough. Prefer
  // that pair over permissive `any` sockets even when those are listed first.
  if (geometryWire && inputType === 'geometry' && outputType === 'geometry') score += 10000
  if (inputType === sourceType) score += 100
  if (outputType === targetType) score += 100
  if (inputType === outputType) score += 20
  if (inputSocket.id === outputSocket.id) score += 8
  if (String(inputSocket.name).toLowerCase() === String(outputSocket.name).toLowerCase()) score += 4
  if (inputType !== 'any') score += 1
  if (outputType !== 'any') score += 1
  return score
}

function normalizeSocketDirection(direction) {
  const value = String(direction || '').toLowerCase()
  if (value === 'input' || value === 'inputs' || value === 'in') return 'input'
  if (value === 'output' || value === 'outputs' || value === 'out') return 'output'
  return null
}

function connectionSocketScore(outputSocket, inputSocket) {
  const outputType = String(outputSocket && outputSocket.type || 'any')
  const inputType = String(inputSocket && inputSocket.type || 'any')

  // Keep registry order as the final tie-breaker, but rank lossless matches
  // ahead of Nanquim's integer-to-float coercion and permissive `any` sockets.
  if (outputType === inputType && outputType !== 'any') return 300
  if (outputType === 'integer' && inputType === 'float') return 200
  if (outputType === 'any' || inputType === 'any') {
    return 100 + (outputType !== 'any' || inputType !== 'any' ? 1 : 0)
  }
  return 0
}

function droppedPosition(options = {}) {
  const source = options && options.position && typeof options.position === 'object'
    ? options.position
    : options
  const position = {}
  if (source && Number.isFinite(Number(source.x))) position.x = Number(source.x)
  if (source && Number.isFinite(Number(source.y))) position.y = Number(source.y)
  return position
}

function insertionNodePositions(graph, value) {
  if (value === undefined) return { positions: [], reason: null }
  if (!Array.isArray(value)) {
    return { positions: null, reason: 'Insertion node positions must be an array.' }
  }

  const nodes = new Map(normalizeNodes(graph && graph.nodes).map((node) => [node.id, node]))
  const seen = new Set()
  const positions = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || !nodes.has(candidate.id)) {
      return { positions: null, reason: `Unknown node in insertion position update: ${candidate && candidate.id}` }
    }
    if (seen.has(candidate.id)) {
      return { positions: null, reason: `Duplicate insertion position update: ${candidate.id}` }
    }
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
      return { positions: null, reason: `Invalid insertion position for node: ${candidate.id}` }
    }
    seen.add(candidate.id)
    positions.push({ id: candidate.id, x: candidate.x, y: candidate.y })
  }
  return { positions, reason: null }
}

function insertAt(parent, child, index) {
  const reference = parent.children[index] || null
  parent.insertBefore(child, reference)
}

function isPromise(value) {
  return Boolean(value && typeof value.then === 'function')
}

function exposedInstanceInputs(value) {
  const inputs = isRecord(value) ? cloneData(value) : {}
  delete inputs.geometry
  return inputs
}

/**
 * Owns Geometry Nodes graph assets and the modifier instances attached to SVG
 * objects. The manager is deliberately the only layer that mutates the live
 * source/output DOM pair.
 */
class GeometryNodeManager {
  constructor(editor, options = {}) {
    this.editor = editor
    this.registry = options.registry || createBuiltinRegistry()
    this.evaluator = options.evaluator || new GraphEvaluator(this.registry)
    this.adapter = options.adapter || new SvgGeometryAdapter(editor)
    this.renderer = options.renderer || new SvgOutputRenderer(editor)
    this.batchBudgetLimits = { ...(options.batchBudgetLimits || {}) }

    this.graphs = new Map()
    this.instances = new Map()
    this.activeObjectId = null
  }

  _dispatch(name, ...args) {
    const signal = this.editor.signals && this.editor.signals[name]
    if (signal && typeof signal.dispatch === 'function') signal.dispatch(...args)
  }

  _log(message, type = 'span') {
    this._dispatch('terminalLogged', { type, msg: message })
  }

  _dirty(options = {}) {
    if (this.editor.spatialIndex && this.editor.spatialIndex.markDirty) this.editor.spatialIndex.markDirty()
    if (this.editor.fullSpatialIndex && this.editor.fullSpatialIndex.markDirty) this.editor.fullSpatialIndex.markDirty()
    this._dispatch('modelContentChanged')
    this._dispatch('geometryNodesChanged')
    this._dispatch('updatedOutliner')
    this._dispatch('updatedProperties')
    if (options.selection) this._dispatch('updatedSelection')
  }

  _execute(command) {
    if (this.editor && typeof this.editor.execute === 'function') this.editor.execute(command)
    else command.execute()
    return command
  }

  _select(elements) {
    this._dispatch('clearSelection')
    this.editor.selected = elements.filter(Boolean)
    this._dispatch('updatedSelection')
  }

  _graphToJSON(graph) {
    const value = graph && typeof graph.toJSON === 'function'
      ? graph.toJSON()
      : {
          id: graph.id,
          name: graph.name,
          nodes: normalizeNodes(graph.nodes),
          links: normalizeLinks(graph.links),
        }
    return ensureGraphJSONShape(value)
  }

  _graphFromJSON(data) {
    const json = ensureGraphJSONShape(data)
    if (typeof NodeGraph.fromJSON === 'function') return NodeGraph.fromJSON(json)
    return new NodeGraph(json)
  }

  createGraph(name = 'Geometry Nodes', data = null) {
    let graph
    if (data) {
      graph = this._graphFromJSON(data)
    } else if (typeof NodeGraph.createDefault === 'function') {
      graph = NodeGraph.createDefault({ name })
    } else if (typeof createDefaultNodeGraph === 'function') {
      graph = createDefaultNodeGraph({ name })
    } else {
      graph = new NodeGraph({ id: createId('graph'), name, nodes: [], links: [] })
    }

    if (!graph.id) graph.id = createId('graph')
    if (!graph.name || typeof graph.name !== 'string') graph.name = name
    this.graphs.set(graph.id, graph)
    this._dispatch('nodeGraphChanged', graph.id, graph)
    return graph
  }

  getGraph(id) {
    return this.graphs.get(id) || null
  }

  getActiveInstance() {
    if (!this.activeObjectId) return null
    return Array.from(this.instances.values()).find((instance) => instance.objectId === this.activeObjectId) || null
  }

  getActiveGraph() {
    const instance = this.getActiveInstance()
    return instance ? this.getGraph(instance.graphId) : null
  }

  setGraphView(graphId, view = {}) {
    const graph = this.getGraph(graphId)
    if (!graph) throw new Error(`Unknown Geometry Nodes graph: ${graphId}`)

    const current = graph.view && typeof graph.view === 'object'
      ? graph.view
      : { x: 0, y: 0, zoom: 1 }
    const next = {
      x: Object.prototype.hasOwnProperty.call(view, 'x') ? Number(view.x) : Number(current.x),
      y: Object.prototype.hasOwnProperty.call(view, 'y') ? Number(view.y) : Number(current.y),
      zoom: Object.prototype.hasOwnProperty.call(view, 'zoom') ? Number(view.zoom) : Number(current.zoom),
    }
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.zoom)) {
      throw new TypeError('Geometry Nodes graph view requires finite x, y, and zoom values.')
    }
    if (next.zoom < GRAPH_VIEW_ZOOM_MIN || next.zoom > GRAPH_VIEW_ZOOM_MAX) {
      throw new RangeError('Geometry Nodes graph view zoom is outside the supported range.')
    }
    if (
      Number(current.x) === next.x
      && Number(current.y) === next.y
      && Number(current.zoom) === next.zoom
    ) return false

    if (typeof graph.setView === 'function') graph.setView(next)
    else graph.view = next
    this.editor.documentState?.markChanged?.('geometry-nodes-view')
    return true
  }

  setActiveByElement(element) {
    let node = domNode(element)
    if (node && node.nodeType !== 1) node = node.parentElement
    const wrapper = node && node.closest ? node.closest('[data-geometry-nodes="true"]') : null
    const objectId = wrapper && wrapper.getAttribute('data-gn-object-id')
    this.activeObjectId = objectId || null
    const instance = this.getActiveInstance()
    this._dispatch('activeNodeGraphChanged', instance, instance && this.getGraph(instance.graphId))
    return instance
  }

  setActiveElement(element) {
    return this.setActiveByElement(element)
  }

  attachSelection(elements = this.editor.selected, graphId = null, recordHistory = true) {
    const normalized = Array.from(elements || []).map(svgElement).filter(Boolean)
    if (normalized.length === 0) {
      this._log('Select SVG geometry before adding a Geometry Nodes modifier.')
      return null
    }

    const existing = normalized.map((element) => this.setActiveByElement(element)).find(Boolean)
    if (existing) return existing

    const parent = normalized[0].node.parentNode
    if (!parent || normalized.some((element) => element.node.parentNode !== parent)) {
      this._log('Geometry Nodes currently requires selected elements to share one parent.')
      return null
    }

    let graph = graphId && this.getGraph(graphId)
    if (!graph) graph = this.createGraph(`Geometry Nodes ${this.graphs.size + 1}`)

    if (!recordHistory) return this._attachSelectionNow(normalized, graph.id).instance
    const command = this._execute(new AttachGeometryNodesCommand(this, normalized, graph.id))
    return command.instance
  }

  _attachSelectionNow(elements, graphId) {
    const nodes = elements.map(domNode)
    const parent = nodes[0].parentNode
    const original = nodes
      .map((node) => ({ node, index: Array.from(parent.children).indexOf(node) }))
      .sort((a, b) => a.index - b.index)
    const wrapperIndex = original[0].index
    const documentRef = parent.ownerDocument || document
    const wrapperNode = documentRef.createElementNS(SVG_NS, 'g')
    const sourceNode = documentRef.createElementNS(SVG_NS, 'g')
    const outputNode = documentRef.createElementNS(SVG_NS, 'g')
    const objectId = createId('object')
    const instanceId = createId('modifier')
    const numericId = this.editor.elementIndex++

    wrapperNode.setAttribute('id', String(numericId))
    wrapperNode.setAttribute('name', `Geometry Nodes ${numericId}`)
    wrapperNode.setAttribute('data-group', 'true')
    wrapperNode.setAttribute('data-geometry-nodes', 'true')
    wrapperNode.setAttribute('data-gn-object-id', objectId)
    wrapperNode.setAttribute('data-gn-instance-id', instanceId)
    wrapperNode.setAttribute('data-gn-graph-id', graphId)
    wrapperNode.setAttribute('data-gn-enabled', 'true')

    sourceNode.setAttribute('data-gn-source', 'true')
    sourceNode.setAttribute('data-hidden', 'true')
    sourceNode.setAttribute('display', 'none')
    sourceNode.setAttribute('aria-hidden', 'true')
    sourceNode.setAttribute('pointer-events', 'none')
    outputNode.setAttribute('data-gn-output', 'true')

    wrapperNode.append(sourceNode, outputNode)
    insertAt(parent, wrapperNode, wrapperIndex)
    original.forEach(({ node }) => sourceNode.appendChild(node))

    const instance = {
      id: instanceId,
      objectId,
      graphId,
      enabled: true,
      inputs: {},
      status: 'idle',
      error: null,
      diagnostics: [],
      revision: 0,
      wrapper: svgElement(wrapperNode),
      source: svgElement(sourceNode),
      output: svgElement(outputNode),
    }
    this.instances.set(instance.id, instance)
    this.activeObjectId = objectId

    const state = { instance, parent, wrapperIndex, original, wrapperNode, sourceNode, outputNode }
    this._select([instance.wrapper])
    this.evaluateInstance(instance)
    this._dispatch('activeNodeGraphChanged', instance, this.getGraph(graphId))
    this._dirty()
    return state
  }

  _undoAttachNow(state) {
    const { parent, wrapperNode, original, instance } = state
    wrapperNode.remove()
    original.forEach(({ node, index }) => insertAt(parent, node, index))
    this.instances.delete(instance.id)
    if (this.activeObjectId === instance.objectId) this.activeObjectId = null
    this._select(original.map(({ node }) => svgElement(node)))
    this._dispatch('activeNodeGraphChanged', null, null)
    this._dirty()
  }

  _redoAttachNow(state) {
    const { parent, wrapperIndex, original, wrapperNode, sourceNode, instance } = state
    insertAt(parent, wrapperNode, wrapperIndex)
    original.forEach(({ node }) => sourceNode.appendChild(node))
    this.instances.set(instance.id, instance)
    this.activeObjectId = instance.objectId
    this._select([instance.wrapper])
    this.evaluateInstance(instance)
    this._dispatch('activeNodeGraphChanged', instance, this.getGraph(instance.graphId))
    this._dirty()
  }

  _mutateGraphJSON(graphId, name, mutator) {
    const graph = this.getGraph(graphId)
    if (!graph) throw new Error(`Unknown Geometry Nodes graph: ${graphId}`)
    const before = this._graphToJSON(graph)
    const after = ensureGraphJSONShape(before)
    const resultId = mutator(after)
    after.revision = (Number.isInteger(before.revision) ? before.revision : 0) + 1
    this._execute(new GraphSnapshotCommand(this, graphId, before, after, name))
    return resultId
  }

  _restoreGraphSnapshot(graphId, snapshot) {
    const json = ensureGraphJSONShape(snapshot)
    json.id = graphId
    const graph = this._graphFromJSON(json)
    this.graphs.set(graphId, graph)
    this._dispatch('nodeGraphChanged', graphId, graph)
    const active = this.getActiveInstance()
    if (active && active.graphId === graphId) this._dispatch('activeNodeGraphChanged', active, graph)
    this.evaluateGraphInstances(graphId)
  }

  addNode(graphId, type, x = 0, y = 0) {
    const definition = this.registry && this.registry.get ? this.registry.get(type) : null
    const id = createId('node')
    this._mutateGraphJSON(graphId, `Add ${definition ? definition.label || definition.name || type : type}`, (json) => {
      const graph = this._graphFromJSON(json)
      const node = this.registry && this.registry.createNode
        ? this.registry.createNode(type, { id, x, y, graph })
        : { id, type, x: Number(x) || 0, y: Number(y) || 0, values: {} }
      if (this.registry && this.registry.getOutputs) {
        this.registry.getOutputs(node, graph).forEach((socket) => {
          if (!Object.prototype.hasOwnProperty.call(node.values, socket.id) && socket.defaultValue !== undefined) {
            node.values[socket.id] = cloneData(socket.defaultValue)
          }
        })
      }
      json.nodes.push(node)
      return id
    })
    return graphNode(this.getGraph(graphId), id)
  }

  removeNodes(graphId, nodeIds) {
    return this.deleteSelection(graphId, nodeIds, [])
  }

  deleteSelection(graphId, nodeIds = [], linkIds = []) {
    const graph = this.getGraph(graphId)
    if (!graph) throw new Error(`Unknown Geometry Nodes graph: ${graphId}`)
    const protectedIds = new Set(normalizeNodes(graph.nodes)
      .filter((node) => node.type === 'groupInput' || node.type === 'groupOutput')
      .map((node) => node.id))
    const ids = new Set((nodeIds || []).filter((id) => !protectedIds.has(id)))
    const links = new Set(linkIds || [])
    if ((nodeIds || []).some((id) => protectedIds.has(id))) {
      this._log('Group Input and Group Output cannot be deleted.')
    }
    if (ids.size === 0 && links.size === 0) return { nodeIds: [], linkIds: [] }
    this._mutateGraphJSON(graphId, 'Delete Geometry Nodes', (json) => {
      json.nodes = json.nodes.filter((node) => !ids.has(node.id))
      json.links = json.links.filter((link) => (
        !links.has(link.id) && !ids.has(link.fromNode) && !ids.has(link.toNode)
      ))
    })
    return { nodeIds: Array.from(ids), linkIds: Array.from(links) }
  }

  setNodePosition(graphId, nodeId, x, y) {
    return this.setNodePositions(graphId, [{ id: nodeId, x, y }])
  }

  setNodePositions(graphId, positions) {
    const updates = Array.from(positions || [])
    if (updates.length === 0) return []
    this._mutateGraphJSON(graphId, 'Move Geometry Node', (json) => {
      updates.forEach((position) => {
        const node = json.nodes.find((candidate) => candidate.id === position.id)
        if (!node) throw new Error(`Unknown Geometry Nodes node: ${position.id}`)
        node.x = Number(position.x) || 0
        node.y = Number(position.y) || 0
      })
    })
    return updates
  }

  setNodeValue(graphId, nodeId, socketId, value) {
    this._mutateGraphJSON(graphId, 'Set Geometry Node Value', (json) => {
      const node = json.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) throw new Error(`Unknown Geometry Nodes node: ${nodeId}`)
      node.values = { ...(node.values || {}), [socketId]: cloneData(value) }
    })
  }

  connect(graphId, fromNodeId, fromSocketId, toNodeId, toSocketId) {
    const id = createId('link')
    this._mutateGraphJSON(graphId, 'Connect Geometry Nodes', (json) => {
      if (!json.nodes.some((node) => node.id === fromNodeId) || !json.nodes.some((node) => node.id === toNodeId)) {
        throw new Error('Cannot connect sockets on missing nodes.')
      }

      const target = json.nodes.find((node) => node.id === toNodeId)
      const candidateGraph = this._graphFromJSON(json)
      const inputs = target && this.registry && this.registry.getInputs
        ? this.registry.getInputs(target, candidateGraph)
        : []
      const socket = inputs.find((input) => input.id === toSocketId)
      if (!socket || !socket.multi) {
        json.links = json.links.filter((link) => !(link.toNode === toNodeId && link.toSocket === toSocketId))
      }
      json.links.push({ id, fromNode: fromNodeId, fromSocket: fromSocketId, toNode: toNodeId, toSocket: toSocketId })
      return id
    })
    return normalizeLinks(this.getGraph(graphId).links).find((link) => link.id === id) || null
  }

  _nodeConnectionPlan(graphId, origin, nodeType, options = {}) {
    const graph = this.getGraph(graphId)
    if (!graph) return { plan: null, reason: `Unknown Geometry Nodes graph: ${graphId}` }
    if (!origin || typeof origin !== 'object') {
      return { plan: null, reason: 'A socket is required to add a connected node.' }
    }

    const direction = normalizeSocketDirection(origin.direction)
    const originNodeId = String(origin.nodeId || '')
    const originSocketId = String(origin.socketId || origin.id || '')
    if (!direction || !originNodeId || !originSocketId) {
      return { plan: null, reason: 'The originating socket is invalid.' }
    }

    const definition = this.registry && this.registry.get ? this.registry.get(nodeType) : null
    const interfaceNode = nodeType === 'groupInput'
      || nodeType === 'groupOutput'
      || String(definition && definition.category || '').toLowerCase() === 'interface'
    if (!definition) return { plan: null, reason: `Unknown node type: ${nodeType}` }
    if (definition.hidden || interfaceNode) {
      return { plan: null, reason: 'Hidden and interface nodes cannot be added from socket search.' }
    }

    // Resolve dynamic/interface sockets against an isolated graph view so the
    // search menu remains a genuinely read-only operation.
    const candidateGraph = this._graphFromJSON(this._graphToJSON(graph))
    const originNode = graphNode(candidateGraph, originNodeId)
    if (!originNode) return { plan: null, reason: `Unknown Geometry Nodes node: ${originNodeId}` }

    let originSocket
    try {
      const originSockets = direction === 'output'
        ? this.registry.getOutputs(originNode, candidateGraph)
        : this.registry.getInputs(originNode, candidateGraph)
      originSocket = socketById(originSockets, originSocketId)
    } catch (error) {
      return { plan: null, reason: error instanceof Error ? error.message : String(error) }
    }
    if (!originSocket || originSocket.hidden) {
      return { plan: null, reason: 'The originating socket is no longer available.' }
    }
    if (origin.type && String(origin.type) !== String(originSocket.type)) {
      return { plan: null, reason: 'The originating socket type changed before search completed.' }
    }

    const reservedIds = new Set(normalizeNodes(candidateGraph.nodes).map((node) => node.id))
    normalizeLinks(candidateGraph.links).forEach((link) => {
      reservedIds.add(link.fromNode)
      reservedIds.add(link.toNode)
    })
    let candidateNodeId = options.nodeId ? String(options.nodeId) : '__gn_connection_preview__'
    if (options.nodeId && reservedIds.has(candidateNodeId)) {
      return { plan: null, reason: `Geometry Nodes node id is already in use: ${candidateNodeId}` }
    }
    while (reservedIds.has(candidateNodeId)) candidateNodeId += '_'

    const position = droppedPosition(options)
    let candidateNode
    let candidateSockets
    try {
      candidateNode = this.registry.createNode(nodeType, {
        id: candidateNodeId,
        x: position.x,
        y: position.y,
        graph: candidateGraph,
      })
      candidateGraph.nodes.push(candidateNode)
      const outputs = this.registry.getOutputs(candidateNode, candidateGraph)
      outputs.forEach((socket) => {
        if (!Object.prototype.hasOwnProperty.call(candidateNode.values, socket.id) && socket.defaultValue !== undefined) {
          candidateNode.values[socket.id] = cloneData(socket.defaultValue)
        }
      })
      candidateSockets = direction === 'output'
        ? this.registry.getInputs(candidateNode, candidateGraph)
        : outputs
    } catch (error) {
      return { plan: null, reason: error instanceof Error ? error.message : String(error) }
    }

    const compatible = []
    candidateSockets.forEach((socket, index) => {
      if (socket.hidden) return
      const outputSocket = direction === 'output' ? originSocket : socket
      const inputSocket = direction === 'output' ? socket : originSocket
      if (!socketTypesCompatible(outputSocket.type, inputSocket.type)) return
      const score = connectionSocketScore(outputSocket, inputSocket)
      compatible.push({ socket, score, index })
    })
    compatible.sort((a, b) => b.score - a.score || a.index - b.index)
    if (compatible.length === 0) {
      return { plan: null, reason: 'The node has no compatible socket for this connection.' }
    }

    const requestedSocketId = String(
      options.connectionSocketId
      || options.socketId
      || options.connectionSocket && options.connectionSocket.id
      || options.plan && options.plan.connectionSocket && options.plan.connectionSocket.id
      || '',
    )
    const selected = requestedSocketId
      ? compatible.find(({ socket }) => socket.id === requestedSocketId)
      : compatible[0]
    if (!selected) {
      return { plan: null, reason: `The selected socket is not compatible: ${requestedSocketId}` }
    }

    const links = normalizeLinks(candidateGraph.links)
    const replacedLinks = direction === 'input' && !originSocket.multi
      ? links.filter((link) => link.toNode === originNodeId && link.toSocket === originSocketId)
      : []
    const replacedIds = new Set(replacedLinks.map((link) => link.id))
    const remainingLinks = links.filter((link) => !replacedIds.has(link.id))
    const prospectiveLinkFor = (socket) => direction === 'output'
      ? { fromNode: originNodeId, fromSocket: originSocketId, toNode: candidateNodeId, toSocket: socket.id }
      : { fromNode: candidateNodeId, fromSocket: socket.id, toNode: originNodeId, toSocket: originSocketId }
    const prospectiveLink = prospectiveLinkFor(selected.socket)

    if (pathExists(remainingLinks, prospectiveLink.toNode, prospectiveLink.fromNode)) {
      return { plan: null, reason: 'Adding the node would create a cycle.' }
    }

    const plans = compatible.map(({ socket }) => ({
      graphId,
      nodeType: definition.type,
      label: definition.label || definition.name || definition.type,
      direction,
      origin: {
        nodeId: originNodeId,
        socketId: originSocketId,
        direction,
        type: originSocket.type,
      },
      originSocket: cloneData(originSocket),
      connectionSocket: cloneData(socket),
      replacedLinks: replacedLinks.map((link) => cloneData(link)),
    }))
    const plan = plans.find(({ connectionSocket }) => connectionSocket.id === selected.socket.id)

    return {
      plan,
      plans,
      candidateNode,
      prospectiveLink,
      reason: null,
    }
  }

  getNodeConnectionPlan(graphId, origin, nodeType) {
    return this._nodeConnectionPlan(graphId, origin, nodeType).plan
  }

  getNodeConnectionPlans(graphId, origin, nodeType) {
    return this._nodeConnectionPlan(graphId, origin, nodeType).plans || []
  }

  addNodeConnectedToSocket(graphId, origin, nodeType, options = {}) {
    const nodeId = createId('node')
    const { plan, candidateNode, prospectiveLink, reason } = this._nodeConnectionPlan(
      graphId,
      origin,
      nodeType,
      {
        ...droppedPosition(options),
        nodeId,
        connectionSocketId: options.connectionSocketId
          || options.socketId
          || options.connectionSocket && options.connectionSocket.id
          || options.plan && options.plan.connectionSocket && options.plan.connectionSocket.id,
      },
    )
    if (!plan) {
      this._log(`Geometry Nodes: ${reason || 'The node cannot be connected to this socket.'}`)
      return null
    }

    const linkId = createId('link')
    const replacedIds = new Set(plan.replacedLinks.map((link) => link.id))
    this._mutateGraphJSON(graphId, `Add Connected ${plan.label}`, (json) => {
      if (!json.nodes.some((node) => node.id === plan.origin.nodeId)) {
        throw new Error('The node graph changed before the connected node was added.')
      }
      json.nodes.push(cloneData(candidateNode))
      if (replacedIds.size > 0) {
        json.links = json.links.filter((link) => !replacedIds.has(link.id))
      }
      json.links.push({ id: linkId, ...prospectiveLink })
    })

    const updatedGraph = this.getGraph(graphId)
    const node = graphNode(updatedGraph, nodeId)
    const link = graphLink(updatedGraph, linkId)
    return {
      ...plan,
      node,
      link,
      position: node ? { x: node.x, y: node.y } : null,
    }
  }

  _linkInsertionPlan(graphId, nodeId, linkId) {
    const graph = this.getGraph(graphId)
    if (!graph) return { plan: null, reason: `Unknown Geometry Nodes graph: ${graphId}` }

    // Resolve every socket against the same immutable graph view. This matters
    // for interface sockets and custom nodes whose socket lists depend on node
    // values or other graph state.
    const candidateGraph = this._graphFromJSON(this._graphToJSON(graph))
    const node = graphNode(candidateGraph, nodeId)
    const link = graphLink(candidateGraph, linkId)
    if (!node) return { plan: null, reason: `Unknown Geometry Nodes node: ${nodeId}` }
    if (!link) return { plan: null, reason: `Unknown Geometry Nodes link: ${linkId}` }

    const definition = this.registry && this.registry.get ? this.registry.get(node.type) : null
    const interfaceNode = node.type === 'groupInput'
      || node.type === 'groupOutput'
      || String(definition && definition.category || '').toLowerCase() === 'interface'
    if (interfaceNode) return { plan: null, reason: 'Interface nodes cannot be inserted into links.' }
    const links = normalizeLinks(candidateGraph.links)
    if (links.some((candidate) => candidate.fromNode === node.id || candidate.toNode === node.id)) {
      return { plan: null, reason: 'Only completely unconnected nodes can be inserted into links.' }
    }
    if (!definition) return { plan: null, reason: `Unknown node type: ${node.type}` }

    const sourceNode = graphNode(candidateGraph, link.fromNode)
    const targetNode = graphNode(candidateGraph, link.toNode)
    if (!sourceNode || !targetNode) {
      return { plan: null, reason: 'The link has a missing endpoint.' }
    }

    let sourceSocket
    let targetSocket
    let inputs
    let outputs
    try {
      sourceSocket = socketById(this.registry.getOutputs(sourceNode, candidateGraph), link.fromSocket)
      targetSocket = socketById(this.registry.getInputs(targetNode, candidateGraph), link.toSocket)
      inputs = this.registry.getInputs(node, candidateGraph)
      outputs = this.registry.getOutputs(node, candidateGraph)
    } catch (error) {
      return { plan: null, reason: error instanceof Error ? error.message : String(error) }
    }

    if (!sourceSocket || !targetSocket) {
      return { plan: null, reason: 'The link references a socket that is no longer available.' }
    }

    const compatibleInputs = inputs.filter((input) => {
      if (!socketTypesCompatible(sourceSocket.type, input.type)) return false
      if (input.multi) return true
      return !links.some((candidate) => (
        candidate.toNode === node.id && candidate.toSocket === input.id
      ))
    })
    const compatibleOutputs = outputs.filter((output) => (
      socketTypesCompatible(output.type, targetSocket.type)
    ))
    if (compatibleInputs.length === 0 || compatibleOutputs.length === 0) {
      return { plan: null, reason: 'The node has no available compatible input/output passthrough.' }
    }

    let selected = null
    compatibleInputs.forEach((inputSocket) => {
      compatibleOutputs.forEach((outputSocket) => {
        const score = insertionSocketScore(sourceSocket, targetSocket, inputSocket, outputSocket)
        if (!selected || score > selected.score) {
          selected = { inputSocket, outputSocket, score }
        }
      })
    })

    const remainingLinks = links.filter((candidate) => candidate.id !== link.id)
    const incoming = {
      fromNode: link.fromNode,
      fromSocket: link.fromSocket,
      toNode: node.id,
      toSocket: selected.inputSocket.id,
    }
    const outgoing = {
      fromNode: node.id,
      fromSocket: selected.outputSocket.id,
      toNode: link.toNode,
      toSocket: link.toSocket,
    }

    // Adding u -> v creates a cycle exactly when v can already reach u.
    // Test the two prospective links in commit order after removing the wire
    // being replaced, so unrelated pre-existing diagnostics do not block this
    // otherwise valid edit.
    if (pathExists(remainingLinks, incoming.toNode, incoming.fromNode)) {
      return { plan: null, reason: 'Inserting the node would create a cycle.' }
    }
    if (pathExists([...remainingLinks, incoming], outgoing.toNode, outgoing.fromNode)) {
      return { plan: null, reason: 'Inserting the node would create a cycle.' }
    }

    return {
      plan: {
        graphId,
        nodeId: node.id,
        linkId: link.id,
        link: cloneData(link),
        sourceSocket: cloneData(sourceSocket),
        targetSocket: cloneData(targetSocket),
        inputSocket: cloneData(selected.inputSocket),
        outputSocket: cloneData(selected.outputSocket),
      },
      reason: null,
    }
  }

  getLinkInsertionPlan(graphId, nodeId, linkId) {
    return this._linkInsertionPlan(graphId, nodeId, linkId).plan
  }

  insertNodeOnLink(graphId, nodeId, linkId, options = {}) {
    const { plan, reason } = this._linkInsertionPlan(graphId, nodeId, linkId)
    if (!plan) {
      this._log(`Geometry Nodes: ${reason || 'The node cannot be inserted into this link.'}`)
      return null
    }

    // Overlap resolution belongs to the same user gesture as the rewire. Do
    // all validation before creating a history command so a stale or malformed
    // layout proposal cannot leave behind a partial graph edit.
    const graph = this.getGraph(graphId)
    const positionBatch = options.nodePositions === undefined
      ? options.positions
      : options.nodePositions
    const {
      positions: nodePositions,
      reason: nodePositionReason,
    } = insertionNodePositions(graph, positionBatch)
    if (!nodePositions) {
      this._log(`Geometry Nodes: ${nodePositionReason}`)
      return null
    }

    const incomingId = createId('link')
    const outgoingId = createId('link')
    const position = droppedPosition(options)
    this._mutateGraphJSON(graphId, 'Insert Geometry Node', (json) => {
      const node = json.nodes.find((candidate) => candidate.id === nodeId)
      if (!node || !json.links.some((candidate) => candidate.id === linkId)) {
        throw new Error('The node graph changed before the link insertion completed.')
      }
      if (Object.prototype.hasOwnProperty.call(position, 'x')) node.x = position.x
      if (Object.prototype.hasOwnProperty.call(position, 'y')) node.y = position.y
      nodePositions.forEach((updatedPosition) => {
        const updatedNode = json.nodes.find((candidate) => candidate.id === updatedPosition.id)
        // IDs were checked against the exact snapshot used to plan the edit.
        // Keep this guard in the command builder in case the graph is replaced
        // synchronously between validation and snapshot construction.
        if (!updatedNode) {
          throw new Error('The node graph changed before overlap resolution completed.')
        }
        updatedNode.x = updatedPosition.x
        updatedNode.y = updatedPosition.y
      })
      json.links = json.links.filter((candidate) => candidate.id !== linkId)
      json.links.push({
        id: incomingId,
        fromNode: plan.link.fromNode,
        fromSocket: plan.link.fromSocket,
        toNode: nodeId,
        toSocket: plan.inputSocket.id,
      }, {
        id: outgoingId,
        fromNode: nodeId,
        fromSocket: plan.outputSocket.id,
        toNode: plan.link.toNode,
        toSocket: plan.link.toSocket,
      })
    })

    const updatedGraph = this.getGraph(graphId)
    const insertedNode = graphNode(updatedGraph, nodeId)
    const incomingLink = graphLink(updatedGraph, incomingId)
    const outgoingLink = graphLink(updatedGraph, outgoingId)
    const updatedPositions = nodePositions.map(({ id }) => {
      const updatedNode = graphNode(updatedGraph, id)
      return updatedNode ? { id, x: updatedNode.x, y: updatedNode.y } : null
    }).filter(Boolean)
    return {
      ...plan,
      node: insertedNode,
      position: insertedNode ? { x: insertedNode.x, y: insertedNode.y } : null,
      nodePositions: updatedPositions,
      positions: updatedPositions,
      incomingLink,
      outgoingLink,
      links: [incomingLink, outgoingLink],
    }
  }

  removeLink(graphId, linkId) {
    this._mutateGraphJSON(graphId, 'Disconnect Geometry Nodes', (json) => {
      json.links = json.links.filter((link) => link.id !== linkId)
    })
  }

  evaluateInstance(value, options = {}) {
    const instance = typeof value === 'string' ? this.instances.get(value) : value
    if (!instance) return null
    options = options && typeof options === 'object' ? options : {}

    const graph = this.getGraph(instance.graphId)
    const revision = ++instance.revision
    if (instance.abortController) instance.abortController.abort()
    instance.abortController = typeof AbortController === 'function' ? new AbortController() : null
    instance.status = 'evaluating'
    instance.error = null
    this._dispatch('nodeEvaluationStarted', instance)

    const finish = (result) => {
      if (!this.instances.has(instance.id) || instance.revision !== revision) return null
      const diagnostics = boundedDiagnostics(result && result.diagnostics)
      const errorDiagnostic = diagnostics.find((item) => item && (
        item.level === 'error' || item.severity === 'error'
      ))
      if (errorDiagnostic) {
        return fail(new Error(errorDiagnostic.message || 'Geometry Nodes evaluation failed.'), diagnostics)
      }
      const geometry = result && result.geometry ? result.geometry : result
      this.renderer.render(geometry, instance.output, {
        objectId: instance.objectId,
        budget: options.renderBudget,
      })
      instance.status = 'ready'
      instance.error = null
      instance.diagnostics = diagnostics
      instance.timings = (result && result.timings) || null
      const boundedResult = result && typeof result === 'object' && Array.isArray(result.diagnostics)
        ? { ...result, diagnostics }
        : result
      this._dispatch('nodeGraphChanged', instance.graphId, graph)
      this._dispatch('geometryNodesEvaluated', instance)
      this._dispatch('nodeEvaluationCompleted', instance, boundedResult)
      this._dirty()
      return boundedResult
    }

    const fail = (error, diagnostics = null) => {
      if (!this.instances.has(instance.id) || instance.revision !== revision) return null
      instance.status = 'error'
      instance.error = error instanceof Error ? error.message : String(error)
      instance.diagnostics = boundedDiagnostics(diagnostics, instance.error)
      this._dispatch('nodeGraphChanged', instance.graphId, graph)
      this._dispatch('geometryNodesEvaluated', instance)
      this._dispatch('nodeEvaluationFailed', instance, error)
      this._log(`Geometry Nodes: ${instance.error}`)
      // Crucially, the renderer is not called on an evaluation failure, so the
      // previous output remains visible and exportable.
      return null
    }

    try {
      const sourceGeometry = this.adapter.fromSource(instance.source, {
        budget: options.workBudget,
      })
      if (!instance.enabled) return finish({ geometry: sourceGeometry, diagnostics: [] })
      if (!graph) throw new Error(`Missing Geometry Nodes graph: ${instance.graphId}`)
      const result = this.evaluator.evaluate(graph, {
        geometry: sourceGeometry,
        inputs: instance.inputs || {},
        signal: instance.abortController && instance.abortController.signal,
        budget: options.workBudget,
        validationCache: options.validationCache,
      })
      return isPromise(result) ? result.then(finish).catch(fail) : finish(result)
    } catch (error) {
      return fail(error)
    }
  }

  evaluateGraphInstances(graphId) {
    const workBudget = createLoadRenderBudget(this.batchBudgetLimits)
    const validationCache = new Map()
    const results = []
    let skippedForBudget = false
    Array.from(this.instances.values())
      .filter((instance) => instance.graphId === graphId)
      .forEach((instance) => {
        if (batchBudgetExhausted(workBudget)) {
          skippedForBudget = true
          instance.status = 'error'
          instance.error = 'Geometry Nodes batch evaluation budget was exhausted; last-good output was kept.'
          instance.diagnostics = [{
            level: 'error',
            severity: 'error',
            code: 'batch-evaluation-budget-exhausted',
            message: instance.error,
          }]
          return
        }
        results.push(this.evaluateInstance(instance, {
          renderBudget: workBudget,
          workBudget,
          validationCache,
        }))
      })
    if (skippedForBudget) this._log('Geometry Nodes: batch evaluation budget exhausted; last-good output was kept.')
    return results.some(isPromise) ? Promise.all(results) : results
  }

  setEnabled(instanceId, enabled, recordHistory = true) {
    const instance = this.instances.get(instanceId)
    if (!instance) return null
    if (instance.enabled === Boolean(enabled)) return instance
    if (recordHistory) this._execute(new SetGeometryNodesEnabledCommand(this, instanceId, enabled))
    else this._setEnabledNow(instanceId, enabled)
    return this.instances.get(instanceId) || null
  }

  _setEnabledNow(instanceId, enabled) {
    const instance = this.instances.get(instanceId)
    if (!instance) return null
    instance.enabled = Boolean(enabled)
    instance.wrapper.attr('data-gn-enabled', String(instance.enabled))
    this.evaluateInstance(instance)
    this._dispatch('nodeGraphChanged', instance.graphId, this.getGraph(instance.graphId))
    return instance
  }

  removeModifier(instanceId, recordHistory = true) {
    if (!this.instances.has(instanceId)) return null
    if (!recordHistory) return this._removeModifierNow(instanceId)
    const command = this._execute(new RemoveGeometryNodesCommand(this, instanceId))
    return command.state
  }

  _removeModifierNow(instanceId) {
    const instance = this.instances.get(instanceId)
    if (!instance) throw new Error(`Unknown Geometry Nodes modifier: ${instanceId}`)
    const wrapperNode = domNode(instance.wrapper)
    const sourceNode = domNode(instance.source)
    const outputNode = domNode(instance.output)
    const wrapperAttributes = attributeSnapshot(wrapperNode)
    const sourceChildren = Array.from(sourceNode.children)

    // Removing a modifier must preserve the object's placement. Keep the
    // wrapper as an ordinary SVG group (including its transform) and swap its
    // procedural internals for the canonical source geometry.
    sourceNode.remove()
    outputNode.remove()
    removeGeometryNodeMetadata(wrapperNode)
    sourceChildren.forEach((node) => wrapperNode.appendChild(node))
    const ordinaryAttributes = attributeSnapshot(wrapperNode)
    this.instances.delete(instance.id)
    if (this.activeObjectId === instance.objectId) this.activeObjectId = null

    const state = {
      instance,
      wrapperNode,
      sourceNode,
      outputNode,
      sourceChildren,
      wrapperAttributes,
      ordinaryAttributes,
    }
    this._select([instance.wrapper])
    this._dispatch('activeNodeGraphChanged', null, null)
    this._dirty()
    return state
  }

  _undoRemoveNow(state) {
    const { instance, wrapperNode, sourceNode, outputNode, sourceChildren, wrapperAttributes } = state
    sourceChildren.forEach((node) => node.remove())
    restoreAttributes(wrapperNode, wrapperAttributes)
    wrapperNode.append(sourceNode, outputNode)
    sourceChildren.forEach((node) => sourceNode.appendChild(node))
    this.instances.set(instance.id, instance)
    this.activeObjectId = instance.objectId
    this._select([instance.wrapper])
    this.evaluateInstance(instance)
    this._dispatch('activeNodeGraphChanged', instance, this.getGraph(instance.graphId))
    this._dirty()
  }

  _redoRemoveNow(state) {
    const { instance, wrapperNode, sourceNode, outputNode, sourceChildren, ordinaryAttributes } = state
    sourceNode.remove()
    outputNode.remove()
    restoreAttributes(wrapperNode, ordinaryAttributes)
    sourceChildren.forEach((node) => wrapperNode.appendChild(node))
    this.instances.delete(instance.id)
    if (this.activeObjectId === instance.objectId) this.activeObjectId = null
    this._select([instance.wrapper])
    this._dispatch('activeNodeGraphChanged', null, null)
    this._dirty()
  }

  applyModifier(instanceId, recordHistory = true) {
    if (!this.instances.has(instanceId)) return null
    if (!recordHistory) return this._applyModifierNow(instanceId)
    const command = this._execute(new ApplyGeometryNodesCommand(this, instanceId))
    return command.state
  }

  _applyModifierNow(instanceId) {
    const instance = this.instances.get(instanceId)
    if (!instance) throw new Error(`Unknown Geometry Nodes modifier: ${instanceId}`)
    const wrapperNode = domNode(instance.wrapper)
    const sourceNode = domNode(instance.source)
    const outputNode = domNode(instance.output)
    const wrapperAttributes = attributeSnapshot(wrapperNode)
    const appliedChildren = Array.from(outputNode.children).map((node) => {
      const clone = node.cloneNode(true)
      removeGeometryNodeMetadata(clone)
      return clone
    })

    sourceNode.remove()
    outputNode.remove()
    removeGeometryNodeMetadata(wrapperNode)
    appliedChildren.forEach((node) => wrapperNode.appendChild(node))
    const appliedAttributes = attributeSnapshot(wrapperNode)
    this.instances.delete(instance.id)
    if (this.activeObjectId === instance.objectId) this.activeObjectId = null

    const state = {
      instance,
      wrapperNode,
      sourceNode,
      outputNode,
      wrapperAttributes,
      appliedAttributes,
      appliedChildren,
    }
    this._select([instance.wrapper])
    this._dispatch('activeNodeGraphChanged', null, null)
    this._dirty()
    return state
  }

  _undoApplyNow(state) {
    const { instance, wrapperNode, sourceNode, outputNode, wrapperAttributes, appliedChildren } = state
    appliedChildren.forEach((node) => node.remove())
    restoreAttributes(wrapperNode, wrapperAttributes)
    wrapperNode.append(sourceNode, outputNode)
    this.instances.set(instance.id, instance)
    this.activeObjectId = instance.objectId
    this._select([instance.wrapper])
    this._dispatch('activeNodeGraphChanged', instance, this.getGraph(instance.graphId))
    this._dirty()
  }

  _redoApplyNow(state) {
    const { instance, wrapperNode, sourceNode, outputNode, appliedAttributes, appliedChildren } = state
    sourceNode.remove()
    outputNode.remove()
    restoreAttributes(wrapperNode, appliedAttributes)
    appliedChildren.forEach((node) => wrapperNode.appendChild(node))
    this.instances.delete(instance.id)
    if (this.activeObjectId === instance.objectId) this.activeObjectId = null
    this._select([instance.wrapper])
    this._dispatch('activeNodeGraphChanged', null, null)
    this._dirty()
  }

  serialize() {
    const drawingNode = domNode(this.editor.drawing)
    const attachedInstances = Array.from(this.instances.values()).filter((instance) => {
      const wrapperNode = domNode(instance.wrapper)
      return Boolean(wrapperNode && drawingNode && drawingNode.contains(wrapperNode))
    })
    return {
      version: SCHEMA_VERSION,
      graphs: Array.from(this.graphs.values()).map((graph) => this._graphToJSON(graph)),
      instances: attachedInstances.map((instance) => ({
        id: instance.id,
        objectId: instance.objectId,
        graphId: instance.graphId,
        enabled: instance.enabled,
        inputs: exposedInstanceInputs(instance.inputs),
      })),
    }
  }

  reset({ preserveDom = false } = {}) {
    Array.from(this.instances.values()).forEach((instance) => {
      if (instance.abortController) instance.abortController.abort()
      if (preserveDom) return

      const wrapperNode = domNode(instance.wrapper)
      const sourceNode = domNode(instance.source)
      const parent = wrapperNode && wrapperNode.parentNode
      if (!parent || !sourceNode) return
      const index = Array.from(parent.children).indexOf(wrapperNode)
      const sourceChildren = Array.from(sourceNode.children)
      wrapperNode.remove()
      sourceChildren.forEach((node, offset) => insertAt(parent, node, index + offset))
    })

    this.instances.clear()
    this.graphs.clear()
    this.activeObjectId = null
    this._dispatch('activeNodeGraphChanged', null, null)
    this._dispatch('geometryNodesChanged')
    if (!preserveDom) this._dirty()
    return this
  }

  load(value = {}) {
    let data = value
    if (typeof data === 'string') {
      data = parseSafeJson(data, {
        maxLength: SERIALIZED_GEOMETRY_NODE_LIMITS.maxStringLength,
        maxDepth: SERIALIZED_GEOMETRY_NODE_LIMITS.maxValueDepth,
        maxNodes: SERIALIZED_GEOMETRY_NODE_LIMITS.maxValueNodes,
      })
      if (data === null) throw new TypeError('Geometry Nodes metadata is invalid or unsafe.')
    }
    data = data || {}
    assertSerializedGeometryNodes(data)

    const serializedById = new Map((data.instances || []).map((instance) => [instance.id, instance]))
    const drawingNode = domNode(this.editor.drawing)
    const wrappers = drawingNode
      ? Array.from(drawingNode.querySelectorAll('[data-geometry-nodes="true"]'))
      : []
    if (wrappers.length > SERIALIZED_GEOMETRY_NODE_LIMITS.maxInstances) {
      throw new RangeError('Drawing contains too many Geometry Nodes modifier wrappers.')
    }

    const matchedWrappers = []
    const matchedIds = new Set()
    wrappers.forEach((wrapperNode) => {
      const id = wrapperNode.getAttribute('data-gn-instance-id')
      if (!id || !serializedById.has(id)) return
      if (matchedIds.has(id)) throw new TypeError(`Duplicate Geometry Nodes wrapper id: ${id}`)

      const sourceNodes = Array.from(wrapperNode.children).filter(
        (child) => child.getAttribute('data-gn-source') === 'true',
      )
      const outputNodes = Array.from(wrapperNode.children).filter(
        (child) => child.getAttribute('data-gn-output') === 'true',
      )
      if (
        sourceNodes.length !== 1
        || outputNodes.length !== 1
        || sourceNodes[0] === outputNodes[0]
      ) return
      const sourceNode = sourceNodes[0]
      const outputNode = outputNodes[0]
      matchedIds.add(id)
      matchedWrappers.push({ id, wrapperNode, sourceNode, outputNode, saved: serializedById.get(id) })
    })

    this.graphs.clear()
    ;(data.graphs || []).forEach((graphData) => this.createGraph(graphData.name, graphData))
    this.instances.clear()

    matchedWrappers.forEach(({ id, wrapperNode, sourceNode, outputNode, saved }) => {
      const objectId = saved.objectId
      const graphId = saved.graphId
      const enabled = saved.enabled !== false

      wrapperNode.setAttribute('data-gn-instance-id', id)
      wrapperNode.setAttribute('data-gn-object-id', objectId)
      wrapperNode.setAttribute('data-gn-graph-id', graphId)
      wrapperNode.setAttribute('data-gn-enabled', String(enabled))

      const instance = {
        id,
        objectId,
        graphId,
        enabled,
        inputs: exposedInstanceInputs(saved.inputs),
        status: 'idle',
        error: null,
        diagnostics: [],
        revision: 0,
        wrapper: svgElement(wrapperNode),
        source: svgElement(sourceNode),
        output: svgElement(outputNode),
      }
      this.instances.set(id, instance)
    })

    // Selection is session-only UI state. Historical files may contain an
    // activeObjectId, but reopening must not revive or reserialize it.
    this.activeObjectId = null
    const renderBudget = createLoadRenderBudget(this.batchBudgetLimits)
    const validationCache = new Map()
    const evaluations = []
    let skippedForBudget = false
    Array.from(this.instances.values()).forEach((instance) => {
      if (batchBudgetExhausted(renderBudget)) {
        skippedForBudget = true
        instance.status = 'error'
        instance.error = 'Geometry Nodes load evaluation budget was exhausted; cached output was kept.'
        instance.diagnostics = [{
          level: 'error',
          severity: 'error',
          code: 'load-evaluation-budget-exhausted',
          message: instance.error,
        }]
        return
      }
      evaluations.push(this.evaluateInstance(instance, {
        renderBudget,
        workBudget: renderBudget,
        validationCache,
      }))
    })
    if (skippedForBudget) this._log('Geometry Nodes: load evaluation budget exhausted; cached output was kept.')
    this._dispatch('activeNodeGraphChanged', this.getActiveInstance(), this.getActiveGraph())
    this._dirty()
    return evaluations.some(isPromise) ? Promise.all(evaluations).then(() => this) : this
  }
}

export {
  GeometryNodeManager,
  GEOMETRY_NODE_LOAD_RENDER_LIMITS,
  MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS,
  SCHEMA_VERSION,
  SERIALIZED_GEOMETRY_NODE_LIMITS,
  assertSerializedGeometryNodes,
  createLoadRenderBudget,
}
export default GeometryNodeManager
