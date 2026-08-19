import { cloneValue } from './GeometrySet2D.js'
import { createId } from './ids.js'
import { finiteNumber } from './matrix.js'

const GRAPH_SCHEMA_VERSION = 1

const DEFAULT_INTERFACE = Object.freeze({
  inputs: Object.freeze([{
    id: 'geometry',
    name: 'Geometry',
    type: 'geometry',
    defaultValue: null,
  }]),
  outputs: Object.freeze([{
    id: 'geometry',
    name: 'Geometry',
    type: 'geometry',
    defaultValue: null,
  }]),
})

function normaliseInterfaceSocket(socket, index, direction) {
  const fallbackId = `${direction}-${index}`
  const id = String(socket && (socket.id || socket.name) || fallbackId)
  return {
    ...cloneValue(socket || {}),
    id,
    name: String(socket && socket.name || id),
    type: String(socket && socket.type || 'any'),
    defaultValue: cloneValue(socket && (
      Object.prototype.hasOwnProperty.call(socket, 'defaultValue')
        ? socket.defaultValue
        : socket.default
    )),
  }
}

function normaliseInterface(graphInterface = DEFAULT_INTERFACE) {
  const source = graphInterface && typeof graphInterface === 'object'
    ? graphInterface
    : DEFAULT_INTERFACE
  const inputs = Array.isArray(source.inputs) ? source.inputs : DEFAULT_INTERFACE.inputs
  const outputs = Array.isArray(source.outputs) ? source.outputs : DEFAULT_INTERFACE.outputs

  return {
    inputs: inputs.map((socket, index) => normaliseInterfaceSocket(socket, index, 'input')),
    outputs: outputs.map((socket, index) => normaliseInterfaceSocket(socket, index, 'output')),
  }
}

function normaliseNode(node = {}) {
  return {
    ...cloneValue(node),
    id: String(node.id || createId('node')),
    type: String(node.type || 'groupInput'),
    x: finiteNumber(node.x),
    y: finiteNumber(node.y),
    values: cloneValue(node.values || {}),
  }
}

function normaliseLink(link = {}) {
  return {
    ...cloneValue(link),
    id: String(link.id || createId('link')),
    fromNode: String(link.fromNode || ''),
    fromSocket: String(link.fromSocket || ''),
    toNode: String(link.toNode || ''),
    toSocket: String(link.toSocket || ''),
  }
}

function createDefaultGraphData(options = {}) {
  const inputId = String(options.inputNodeId || createId('node'))
  const outputId = String(options.outputNodeId || createId('node'))
  const graphInterface = normaliseInterface(options.interface || DEFAULT_INTERFACE)
  const inputSocket = graphInterface.inputs.find(socket => socket.id === 'geometry') || graphInterface.inputs[0]
  const outputSocket = graphInterface.outputs.find(socket => socket.id === 'geometry') || graphInterface.outputs[0]
  const links = inputSocket && outputSocket
    ? [{
        id: createId('link'),
        fromNode: inputId,
        fromSocket: inputSocket.id,
        toNode: outputId,
        toSocket: outputSocket.id,
      }]
    : []

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    id: String(options.id || createId('graph')),
    name: String(options.name || 'Geometry Nodes'),
    revision: Number.isInteger(options.revision) ? options.revision : 0,
    interface: graphInterface,
    nodes: [
      { id: inputId, type: 'groupInput', x: -240, y: 0, values: {} },
      { id: outputId, type: 'groupOutput', x: 240, y: 0, values: {} },
    ],
    links,
    view: cloneValue(options.view || { x: 0, y: 0, zoom: 1 }),
  }
}

class NodeGraph {
  constructor(data) {
    const source = data instanceof NodeGraph ? data.toJSON() : data
    const graph = source && Array.isArray(source.nodes)
      ? source
      : createDefaultGraphData(source || {})

    this.schemaVersion = Number.isInteger(graph.schemaVersion)
      ? graph.schemaVersion
      : GRAPH_SCHEMA_VERSION
    this.id = String(graph.id || createId('graph'))
    this.name = String(graph.name || 'Geometry Nodes')
    this.revision = Number.isInteger(graph.revision) ? graph.revision : 0
    this.interface = normaliseInterface(graph.interface)
    this.nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).map(normaliseNode)
    this.links = (Array.isArray(graph.links) ? graph.links : []).map(normaliseLink)
    this.view = cloneValue(graph.view || { x: 0, y: 0, zoom: 1 })
  }

  static create(options = {}) {
    return new NodeGraph(createDefaultGraphData(options))
  }

  static createDefault(options = {}) {
    return NodeGraph.create(options)
  }

  static fromJSON(value) {
    const data = typeof value === 'string' ? JSON.parse(value) : value
    return new NodeGraph(data)
  }

  touch() {
    this.revision += 1
    return this
  }

  getNode(nodeId) {
    return this.nodes.find(node => node.id === String(nodeId)) || null
  }

  addNode(typeOrNode, options = {}) {
    const source = typeof typeOrNode === 'string'
      ? { ...options, type: typeOrNode }
      : typeOrNode
    const node = normaliseNode(source)
    if (this.getNode(node.id)) throw new Error(`Node id "${node.id}" already exists`)

    this.nodes.push(node)
    this.touch()
    return node
  }

  updateNode(nodeId, patch = {}) {
    const node = this.getNode(nodeId)
    if (!node) return null

    const nextValues = Object.prototype.hasOwnProperty.call(patch, 'values')
      ? { ...node.values, ...cloneValue(patch.values || {}) }
      : node.values
    Object.assign(node, cloneValue(patch), {
      id: node.id,
      type: String(patch.type || node.type),
      x: finiteNumber(Object.prototype.hasOwnProperty.call(patch, 'x') ? patch.x : node.x),
      y: finiteNumber(Object.prototype.hasOwnProperty.call(patch, 'y') ? patch.y : node.y),
      values: nextValues,
    })
    this.touch()
    return node
  }

  setNodeValue(nodeId, key, value) {
    const node = this.getNode(nodeId)
    if (!node) return null

    node.values[String(key)] = cloneValue(value)
    this.touch()
    return node
  }

  removeNode(nodeId) {
    const id = String(nodeId)
    const index = this.nodes.findIndex(node => node.id === id)
    if (index === -1) return null

    const [removed] = this.nodes.splice(index, 1)
    this.links = this.links.filter(link => link.fromNode !== id && link.toNode !== id)
    this.touch()
    return removed
  }

  addLink(fromNodeOrLink, fromSocket, toNode, toSocket, options = {}) {
    const source = fromNodeOrLink && typeof fromNodeOrLink === 'object'
      ? fromNodeOrLink
      : { ...options, fromNode: fromNodeOrLink, fromSocket, toNode, toSocket }
    const link = normaliseLink(source)
    if (this.links.some(existing => existing.id === link.id)) {
      throw new Error(`Link id "${link.id}" already exists`)
    }

    this.links.push(link)
    this.touch()
    return link
  }

  removeLink(linkId) {
    const id = String(linkId)
    const index = this.links.findIndex(link => link.id === id)
    if (index === -1) return null

    const [removed] = this.links.splice(index, 1)
    this.touch()
    return removed
  }

  setInterface(graphInterface) {
    this.interface = normaliseInterface(graphInterface)
    this.touch()
    return this.interface
  }

  setView(view) {
    this.view = { ...this.view, ...cloneValue(view || {}) }
    this.touch()
    return this.view
  }

  clone() {
    return NodeGraph.fromJSON(this.toJSON())
  }

  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      name: this.name,
      revision: this.revision,
      interface: cloneValue(this.interface),
      nodes: this.nodes.map(normaliseNode),
      links: this.links.map(normaliseLink),
      view: cloneValue(this.view),
    }
  }
}

function createNodeGraph(options = {}) {
  return NodeGraph.create(options)
}

function createDefaultNodeGraph(options = {}) {
  return NodeGraph.createDefault(options)
}

export {
  DEFAULT_INTERFACE,
  GRAPH_SCHEMA_VERSION,
  NodeGraph,
  createDefaultGraphData,
  createDefaultNodeGraph,
  createNodeGraph,
  normaliseInterface,
  normaliseLink,
  normaliseNode,
}

export default NodeGraph
