import { SVG } from '@svgdotjs/svg.js'
import { GraphEvaluator } from './core/GraphEvaluator.js'
import { NodeGraph, createDefaultNodeGraph } from './core/NodeGraph.js'
import { createBuiltinRegistry, socketTypesCompatible } from './core/NodeRegistry.js'
import { createId } from './core/ids.js'
import { SvgGeometryAdapter } from './SvgGeometryAdapter.js'
import { SvgOutputRenderer } from './SvgOutputRenderer.js'
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

function domNode(value) {
  if (!value) return null
  return value.node || value
}

function svgElement(value) {
  if (!value) return null
  return value.node ? value : SVG(value)
}

function childByAttribute(parent, name) {
  const node = domNode(parent)
  return Array.from((node && node.children) || []).find((child) => child.getAttribute(name) === 'true') || null
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

function droppedPosition(options = {}) {
  const source = options && options.position && typeof options.position === 'object'
    ? options.position
    : options
  const position = {}
  if (source && Number.isFinite(Number(source.x))) position.x = Number(source.x)
  if (source && Number.isFinite(Number(source.y))) position.y = Number(source.y)
  return position
}

function insertAt(parent, child, index) {
  const reference = parent.children[index] || null
  parent.insertBefore(child, reference)
}

function isPromise(value) {
  return Boolean(value && typeof value.then === 'function')
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
    return {
      ...plan,
      node: insertedNode,
      position: insertedNode ? { x: insertedNode.x, y: insertedNode.y } : null,
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

  evaluateInstance(value) {
    const instance = typeof value === 'string' ? this.instances.get(value) : value
    if (!instance) return null

    const graph = this.getGraph(instance.graphId)
    const revision = ++instance.revision
    if (instance.abortController) instance.abortController.abort()
    instance.abortController = typeof AbortController === 'function' ? new AbortController() : null
    instance.status = 'evaluating'
    instance.error = null
    this._dispatch('nodeEvaluationStarted', instance)

    const finish = (result) => {
      if (!this.instances.has(instance.id) || instance.revision !== revision) return null
      const diagnostics = (result && result.diagnostics) || []
      const errorDiagnostic = diagnostics.find((item) => item && (
        item.level === 'error' || item.severity === 'error'
      ))
      if (errorDiagnostic) {
        return fail(new Error(errorDiagnostic.message || 'Geometry Nodes evaluation failed.'), diagnostics)
      }
      const geometry = result && result.geometry ? result.geometry : result
      this.renderer.render(geometry, instance.output, { objectId: instance.objectId })
      instance.status = 'ready'
      instance.error = null
      instance.diagnostics = diagnostics
      instance.timings = (result && result.timings) || null
      this._dispatch('nodeGraphChanged', instance.graphId, graph)
      this._dispatch('geometryNodesEvaluated', instance)
      this._dispatch('nodeEvaluationCompleted', instance, result)
      this._dirty()
      return result
    }

    const fail = (error, diagnostics = null) => {
      if (!this.instances.has(instance.id) || instance.revision !== revision) return null
      instance.status = 'error'
      instance.error = error instanceof Error ? error.message : String(error)
      instance.diagnostics = diagnostics || [{ level: 'error', severity: 'error', message: instance.error }]
      this._dispatch('nodeGraphChanged', instance.graphId, graph)
      this._dispatch('geometryNodesEvaluated', instance)
      this._dispatch('nodeEvaluationFailed', instance, error)
      this._log(`Geometry Nodes: ${instance.error}`)
      // Crucially, the renderer is not called on an evaluation failure, so the
      // previous output remains visible and exportable.
      return null
    }

    try {
      const sourceGeometry = this.adapter.fromSource(instance.source)
      if (!instance.enabled) return finish({ geometry: sourceGeometry, diagnostics: [] })
      if (!graph) throw new Error(`Missing Geometry Nodes graph: ${instance.graphId}`)
      const result = this.evaluator.evaluate(graph, {
        geometry: sourceGeometry,
        inputs: instance.inputs || {},
        signal: instance.abortController && instance.abortController.signal,
      })
      return isPromise(result) ? result.then(finish).catch(fail) : finish(result)
    } catch (error) {
      return fail(error)
    }
  }

  evaluateGraphInstances(graphId) {
    const results = Array.from(this.instances.values())
      .filter((instance) => instance.graphId === graphId)
      .map((instance) => this.evaluateInstance(instance))
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
      activeObjectId: this.activeObjectId,
      graphs: Array.from(this.graphs.values()).map((graph) => this._graphToJSON(graph)),
      instances: attachedInstances.map((instance) => ({
        id: instance.id,
        objectId: instance.objectId,
        graphId: instance.graphId,
        enabled: instance.enabled,
        inputs: cloneData(instance.inputs || {}),
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
    if (typeof data === 'string') data = JSON.parse(data)
    data = data || {}

    this.graphs.clear()
    ;(data.graphs || []).forEach((graphData) => this.createGraph(graphData.name, graphData))
    this.instances.clear()

    const serializedById = new Map((data.instances || []).map((instance) => [instance.id, instance]))
    const drawingNode = domNode(this.editor.drawing)
    const wrappers = drawingNode
      ? Array.from(drawingNode.querySelectorAll('[data-geometry-nodes="true"]'))
      : []

    wrappers.forEach((wrapperNode) => {
      const sourceNode = childByAttribute(wrapperNode, 'data-gn-source')
      const outputNode = childByAttribute(wrapperNode, 'data-gn-output')
      if (!sourceNode || !outputNode) return

      const id = wrapperNode.getAttribute('data-gn-instance-id') || createId('modifier')
      const saved = serializedById.get(id) || {}
      const objectId = wrapperNode.getAttribute('data-gn-object-id') || saved.objectId || createId('object')
      const graphId = wrapperNode.getAttribute('data-gn-graph-id') || saved.graphId
      const enabledAttribute = wrapperNode.getAttribute('data-gn-enabled')
      const enabled = saved.enabled !== undefined ? Boolean(saved.enabled) : enabledAttribute !== 'false'

      wrapperNode.setAttribute('data-gn-instance-id', id)
      wrapperNode.setAttribute('data-gn-object-id', objectId)
      if (graphId) wrapperNode.setAttribute('data-gn-graph-id', graphId)
      wrapperNode.setAttribute('data-gn-enabled', String(enabled))

      const instance = {
        id,
        objectId,
        graphId,
        enabled,
        inputs: cloneData(saved.inputs || {}),
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

    this.activeObjectId = data.activeObjectId || null
    const evaluations = Array.from(this.instances.values()).map((instance) => this.evaluateInstance(instance))
    this._dispatch('activeNodeGraphChanged', this.getActiveInstance(), this.getActiveGraph())
    this._dirty()
    return evaluations.some(isPromise) ? Promise.all(evaluations).then(() => this) : this
  }
}

export { GeometryNodeManager, SCHEMA_VERSION }
export default GeometryNodeManager
