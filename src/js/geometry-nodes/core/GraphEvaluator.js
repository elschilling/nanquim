import GeometrySet2D, { cloneValue } from './GeometrySet2D.js'
import GraphValidator, { diagnostic } from './GraphValidator.js'
import { builtinRegistry } from './NodeRegistry.js'
import { createDeterministicId } from './ids.js'

function now() {
  if (globalThis.performance && typeof globalThis.performance.now === 'function') {
    return globalThis.performance.now()
  }
  return Date.now()
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)
}

function cloneRuntimeValue(value) {
  return value instanceof GeometrySet2D ? value : cloneValue(value)
}

function normaliseSocketValue(value, socket) {
  if (socket && socket.type === 'geometry') {
    try {
      return GeometrySet2D.from(value)
    } catch (error) {
      return GeometrySet2D.empty()
    }
  }
  return cloneRuntimeValue(value)
}

function createEmptyResult(diagnostics = [], startTime = now()) {
  const totalMs = Math.max(0, now() - startTime)
  return {
    geometry: GeometrySet2D.empty(),
    outputs: {},
    diagnostics,
    timings: { totalMs, byNode: {}, nodes: [] },
    evaluatedNodeIds: [],
  }
}

class GraphEvaluator {
  constructor(registry = builtinRegistry) {
    this.registry = registry
    this.validator = new GraphValidator(registry)
  }

  evaluate(graphOrNodeGraph, options = {}) {
    const startedAt = now()
    const graph = graphOrNodeGraph && typeof graphOrNodeGraph.toJSON === 'function'
      ? graphOrNodeGraph.toJSON()
      : graphOrNodeGraph

    if (options instanceof GeometrySet2D) options = { geometry: options }
    options = options && typeof options === 'object' ? options : {}

    const validation = this.validator.validate(graph, { reachableOnly: true })
    const diagnostics = [...validation.diagnostics]
    const diagnosticKeys = new Set(diagnostics.map(item => (
      `${item.code}|${item.nodeId || ''}|${item.linkId || ''}|${item.message}`
    )))

    const addDiagnostic = (level, code, message, details = {}) => {
      const item = diagnostic(level, code, message, details)
      const key = `${item.code}|${item.nodeId || ''}|${item.linkId || ''}|${item.message}`
      if (!diagnosticKeys.has(key)) {
        diagnosticKeys.add(key)
        diagnostics.push(item)
      }
      return item
    }

    if (!graph || typeof graph !== 'object') {
      return createEmptyResult(diagnostics, startedAt)
    }

    if (options.signal && options.signal.aborted) {
      addDiagnostic('warning', 'evaluation-aborted', 'Geometry Nodes evaluation was cancelled')
      return createEmptyResult(diagnostics, startedAt)
    }

    const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
    const links = Array.isArray(graph.links) ? graph.links : []
    const nodeMap = new Map(nodes.map(node => [node.id, node]))
    const linksByInput = new Map()

    links.forEach(link => {
      const key = `${link.toNode}\u001f${link.toSocket}`
      if (!linksByInput.has(key)) linksByInput.set(key, [])
      linksByInput.get(key).push(link)
    })

    const graphInputs = {}
    const suppliedInputs = options.inputs && typeof options.inputs === 'object'
      ? options.inputs
      : {}
    if (hasOwn(options, 'geometry')) graphInputs.geometry = options.geometry
    Object.assign(graphInputs, suppliedInputs)

    const interfaceInputs = graph.interface && Array.isArray(graph.interface.inputs)
      ? graph.interface.inputs
      : []
    interfaceInputs.forEach(socket => {
      const value = hasOwn(graphInputs, socket.id)
        ? graphInputs[socket.id]
        : socket.defaultValue
      graphInputs[socket.id] = normaliseSocketValue(value, socket)
    })

    const nodeState = new Map()
    const nodeOutputs = new Map()
    const timingRows = []
    const timingByNode = {}

    const checkCancelled = () => {
      if (!options.signal || !options.signal.aborted) return
      const error = new Error('Geometry Nodes evaluation was cancelled')
      error.name = 'AbortError'
      throw error
    }

    const evaluateNode = nodeId => {
      checkCancelled()
      if (nodeState.get(nodeId) === 'done') return nodeOutputs.get(nodeId) || {}
      if (nodeState.get(nodeId) === 'visiting') {
        const cycleAlreadyReported = diagnostics.some(item => (
          item.code === 'cycle' &&
          (item.nodeId === nodeId || (Array.isArray(item.nodeIds) && item.nodeIds.includes(nodeId)))
        ))
        if (!cycleAlreadyReported) {
          addDiagnostic('error', 'cycle', `Node cycle reached while evaluating "${nodeId}"`, {
            nodeId,
          })
        }
        return {}
      }

      const node = nodeMap.get(nodeId)
      if (!node) {
        addDiagnostic('error', 'missing-node', `Node "${nodeId}" does not exist`, { nodeId })
        return {}
      }

      const definition = this.registry.get(node.type)
      if (!definition) {
        addDiagnostic('error', 'unknown-node-type', `Unknown node type "${node.type}"`, {
          nodeId,
          nodeType: node.type,
        })
        nodeState.set(nodeId, 'done')
        nodeOutputs.set(nodeId, {})
        return {}
      }

      nodeState.set(nodeId, 'visiting')
      const nodeStartedAt = now()
      let outputs = {}

      try {
        const inputs = {}
        this.registry.getInputs(node, graph).forEach(inputSocket => {
          const key = `${node.id}\u001f${inputSocket.id}`
          const incomingLinks = linksByInput.get(key) || []

          if (inputSocket.multi) {
            inputs[inputSocket.id] = incomingLinks.map(link => {
              const sourceOutputs = evaluateNode(link.fromNode)
              return normaliseSocketValue(sourceOutputs[link.fromSocket], inputSocket)
            })
            return
          }

          if (incomingLinks.length > 0) {
            const link = incomingLinks[incomingLinks.length - 1]
            const sourceOutputs = evaluateNode(link.fromNode)
            inputs[inputSocket.id] = normaliseSocketValue(
              sourceOutputs[link.fromSocket],
              inputSocket,
            )
            return
          }

          const value = hasOwn(node.values, inputSocket.id)
            ? node.values[inputSocket.id]
            : inputSocket.defaultValue
          inputs[inputSocket.id] = normaliseSocketValue(value, inputSocket)
        })

        const context = {
          registry: this.registry,
          graph,
          graphInputs,
          signal: options.signal || null,
          checkCancelled,
          createItemId: (...parts) => createDeterministicId(
            'geometry',
            graph.id || 'graph',
            node.id,
            ...parts,
          ),
          warn: (message, code = 'node-warning', details = {}) => addDiagnostic(
            'warning',
            code,
            message,
            { nodeId: node.id, ...details },
          ),
          error: (message, code = 'node-error', details = {}) => addDiagnostic(
            'error',
            code,
            message,
            { nodeId: node.id, ...details },
          ),
        }

        const result = definition.evaluate({ inputs, node, graph, context })
        if (result && typeof result.then === 'function') {
          throw new TypeError('Asynchronous node evaluators are not supported')
        }

        if (result instanceof GeometrySet2D) {
          const geometryOutput = this.registry
            .getOutputs(node, graph)
            .find(socket => socket.type === 'geometry')
          outputs[geometryOutput ? geometryOutput.id : 'geometry'] = result
        } else if (result && typeof result === 'object') {
          outputs = { ...result }
        } else {
          const outputSockets = this.registry.getOutputs(node, graph)
          if (outputSockets.length === 1) outputs[outputSockets[0].id] = result
        }

        this.registry.getOutputs(node, graph).forEach(outputSocket => {
          const value = hasOwn(outputs, outputSocket.id)
            ? outputs[outputSocket.id]
            : outputSocket.defaultValue
          outputs[outputSocket.id] = normaliseSocketValue(value, outputSocket)
        })
      } catch (error) {
        if (error && error.name === 'AbortError') throw error
        addDiagnostic('error', 'node-evaluation-failed', error && error.message
          ? error.message
          : `Node "${node.id}" failed`, {
          nodeId: node.id,
          nodeType: node.type,
        })
        outputs = {}
      } finally {
        const durationMs = Math.max(0, now() - nodeStartedAt)
        timingByNode[node.id] = durationMs
        timingRows.push({ nodeId: node.id, type: node.type, durationMs })
        nodeOutputs.set(node.id, outputs)
        nodeState.set(node.id, 'done')
      }

      return outputs
    }

    const outputNode = nodes.find(node => node.type === 'groupOutput')
    if (!outputNode) return createEmptyResult(diagnostics, startedAt)

    let outputs = {}
    try {
      outputs = evaluateNode(outputNode.id)
    } catch (error) {
      if (error && error.name === 'AbortError') {
        addDiagnostic('warning', 'evaluation-aborted', error.message)
      } else {
        addDiagnostic('error', 'evaluation-failed', error && error.message
          ? error.message
          : 'Geometry Nodes evaluation failed')
      }
    }

    const outputInterface = graph.interface && Array.isArray(graph.interface.outputs)
      ? graph.interface.outputs
      : []
    const geometrySocket = outputInterface.find(socket => socket.id === 'geometry') ||
      outputInterface.find(socket => socket.type === 'geometry')
    const geometryValue = geometrySocket
      ? outputs[geometrySocket.id]
      : outputs.geometry
    let evaluatedGeometry = GeometrySet2D.empty()
    try {
      evaluatedGeometry = GeometrySet2D.from(geometryValue)
    } catch (error) {
      if (geometryValue !== null && geometryValue !== undefined) {
        addDiagnostic('error', 'invalid-geometry-output', 'Group Output did not produce GeometrySet2D', {
          nodeId: outputNode.id,
        })
      }
    }

    const totalMs = Math.max(0, now() - startedAt)
    const timings = {
      totalMs,
      byNode: timingByNode,
      nodes: timingRows,
      ...timingByNode,
    }

    return {
      geometry: evaluatedGeometry,
      outputs,
      diagnostics,
      timings,
      evaluatedNodeIds: timingRows.map(row => row.nodeId),
    }
  }
}

function evaluateGraph(graph, options, registry = builtinRegistry) {
  return new GraphEvaluator(registry).evaluate(graph, options)
}

export {
  GraphEvaluator,
  evaluateGraph,
}

export default GraphEvaluator
