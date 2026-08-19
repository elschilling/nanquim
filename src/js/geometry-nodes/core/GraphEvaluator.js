import GeometrySet2D, { cloneValue } from './GeometrySet2D.js'
import GraphValidator, { diagnostic } from './GraphValidator.js'
import { builtinRegistry } from './NodeRegistry.js'
import { createDeterministicId } from './ids.js'

const DEFAULT_EVALUATION_LIMITS = Object.freeze({
  maxEvaluatedNodes: 10000,
  maxGraphLinks: 40000,
  maxProcessedSocketValues: 100000,
  maxMaterializedItems: 100000,
  maxMaterializedValueNodes: 2000000,
  maxDiagnostics: 128,
})

function graphValidationStamp(graph) {
  if (!graph || typeof graph !== 'object') return 'invalid'
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const links = Array.isArray(graph.links) ? graph.links : []
  return `${graph.schemaVersion || ''}|${graph.revision || 0}|${nodes.length}|${links.length}`
}

function boundedDiagnosticLimit(value) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 128
}

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
  constructor(registry = builtinRegistry, options = {}) {
    this.registry = registry
    this.validator = new GraphValidator(registry)
    this.limits = {
      ...DEFAULT_EVALUATION_LIMITS,
      ...(options.limits || options),
    }
  }

  evaluate(graphOrNodeGraph, options = {}) {
    const startedAt = now()
    const graph = graphOrNodeGraph && typeof graphOrNodeGraph.toJSON === 'function'
      ? graphOrNodeGraph.toJSON()
      : graphOrNodeGraph

    if (options instanceof GeometrySet2D) options = { geometry: options }
    options = options && typeof options === 'object' ? options : {}
    const workBudget = options.budget && typeof options.budget === 'object'
      ? options.budget
      : null
    const validationCache = options.validationCache instanceof Map
      ? options.validationCache
      : null
    const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : []
    const links = Array.isArray(graph && graph.links) ? graph.links : []
    const diagnosticLimit = boundedDiagnosticLimit(this.limits.maxDiagnostics)
    const reserveSharedWork = (key, amount, message) => {
      if (!workBudget || !Number.isFinite(workBudget[key])) return
      const remaining = Math.max(0, workBudget[key])
      if (amount > remaining) {
        workBudget[key] = 0
        throw new RangeError(message)
      }
      workBudget[key] = remaining - amount
    }
    if (workBudget && Number.isFinite(workBudget.remainingEvaluatedNodes) && workBudget.remainingEvaluatedNodes <= 0) {
      return createEmptyResult([
        diagnostic('error', 'evaluation-budget-exhausted', 'Geometry Nodes batch exhausted its node-evaluation budget'),
      ], startedAt)
    }
    if (
      (Array.isArray(graph && graph.nodes) && graph.nodes.length > this.limits.maxEvaluatedNodes)
      || (Array.isArray(graph && graph.links) && graph.links.length > this.limits.maxGraphLinks)
    ) {
      return createEmptyResult([
        diagnostic('error', 'evaluation-topology-limit', 'Geometry Nodes graph exceeds the safe evaluation topology limit'),
      ], startedAt)
    }

    const validationCacheKey = graphOrNodeGraph && typeof graphOrNodeGraph === 'object'
      ? graphOrNodeGraph
      : null
    const validationStamp = graphValidationStamp(graph)
    const cachedValidation = validationCacheKey && validationCache
      ? validationCache.get(validationCacheKey)
      : null
    try {
      // Each evaluation builds link indexes even when its validation result is
      // cached, so charge the complete link pass before either operation.
      reserveSharedWork(
        'remainingProcessedLinks',
        links.length,
        'Geometry Nodes batch exceeded the safe graph-link processing limit',
      )
    } catch (error) {
      return createEmptyResult([
        diagnostic('error', 'evaluation-link-budget-exhausted', error.message),
      ], startedAt)
    }

    let validation = cachedValidation && cachedValidation.stamp === validationStamp
      ? cachedValidation.validation
      : null
    if (!validation) {
      validation = this.validator.validate(graph, {
        reachableOnly: true,
        maxDiagnostics: diagnosticLimit,
      })
      if (validationCacheKey && validationCache) {
        validationCache.set(validationCacheKey, { stamp: validationStamp, validation })
      }
    }
    // Validation results may be shared across a batch. Clone retained records
    // because runtime truncation updates its local marker in place.
    const diagnostics = validation.diagnostics.map(item => ({ ...item }))
    const diagnosticKeys = new Set(diagnostics.map(item => (
      `${item.code}|${item.nodeId || ''}|${item.linkId || ''}|${item.message}`
    )))

    const addDiagnostic = (level, code, message, details = {}) => {
      const item = diagnostic(level, code, message, details)
      const key = `${item.code}|${item.nodeId || ''}|${item.linkId || ''}|${item.message}`
      if (diagnosticKeys.has(key)) return item
      diagnosticKeys.add(key)
      if (diagnostics.length < diagnosticLimit) {
        diagnostics.push(item)
        return item
      }

      const existingMarker = diagnostics.find(candidate => candidate.code === 'diagnostics-truncated')
      if (existingMarker) {
        existingMarker.omittedCount = Number(existingMarker.omittedCount || 0) + 1
        existingMarker.message = `${existingMarker.omittedCount} additional graph diagnostics were omitted`
        if (level === 'error') {
          existingMarker.level = 'error'
          existingMarker.severity = 'error'
        }
        return item
      }

      const evicted = diagnostics.pop()
      const omittedHasError = level === 'error' || (evicted && (
        evicted.level === 'error' || evicted.severity === 'error'
      ))
      diagnostics.push(diagnostic(
        omittedHasError ? 'error' : 'warning',
        'diagnostics-truncated',
        '2 additional graph diagnostics were omitted',
        { omittedCount: 2 },
      ))
      return item
    }

    if (!graph || typeof graph !== 'object') {
      return createEmptyResult(diagnostics, startedAt)
    }

    if (options.signal && options.signal.aborted) {
      addDiagnostic('warning', 'evaluation-aborted', 'Geometry Nodes evaluation was cancelled')
      return createEmptyResult(diagnostics, startedAt)
    }

    let processedSocketValueCount = 0
    const normaliseProcessedSocketValue = (value, socket) => {
      processedSocketValueCount += 1
      reserveSharedWork(
        'remainingSocketValues',
        1,
        'Geometry Nodes batch exceeded the safe socket-value processing limit',
      )
      if (processedSocketValueCount > this.limits.maxProcessedSocketValues) {
        throw new RangeError('Geometry Nodes evaluation exceeded the safe socket-value processing limit')
      }
      return normaliseSocketValue(value, socket)
    }

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
    Object.assign(graphInputs, suppliedInputs)
    // `geometry` is the canonical source owned by the modifier. Serialized
    // exposed-input values must never replace it with an arbitrary GeometrySet
    // payload that bypasses the SVG import boundary.
    if (hasOwn(options, 'geometry')) graphInputs.geometry = options.geometry

    const interfaceInputs = graph.interface && Array.isArray(graph.interface.inputs)
      ? graph.interface.inputs
      : []
    try {
      interfaceInputs.forEach(socket => {
        const value = hasOwn(graphInputs, socket.id)
          ? graphInputs[socket.id]
          : socket.defaultValue
        graphInputs[socket.id] = normaliseProcessedSocketValue(value, socket)
      })
    } catch (error) {
      addDiagnostic('error', 'evaluation-socket-budget-exhausted', error.message)
      return createEmptyResult(diagnostics, startedAt)
    }

    const nodeState = new Map()
    const nodeOutputs = new Map()
    const remainingConsumers = new Map()
    const timingRows = []
    const timingByNode = {}
    const chargedGeometrySets = new WeakSet()
    let evaluatedNodeCount = 0
    let materializedItemCount = 0
    let materializedValueNodeCount = 0

    links.forEach((link) => {
      remainingConsumers.set(link.fromNode, (remainingConsumers.get(link.fromNode) || 0) + 1)
    })

    const reserveNodeEvaluation = () => {
      evaluatedNodeCount += 1
      reserveSharedWork(
        'remainingEvaluatedNodes',
        1,
        'Geometry Nodes batch exceeded the safe node-evaluation limit',
      )
      if (evaluatedNodeCount > this.limits.maxEvaluatedNodes) {
        throw new RangeError('Geometry Nodes evaluation exceeded the safe node-evaluation limit')
      }
    }

    const chargeGeometrySet = (geometry) => {
      if (!(geometry instanceof GeometrySet2D) || chargedGeometrySets.has(geometry)) return
      chargedGeometrySets.add(geometry)
      const itemCount = geometry.size
      const valueNodeCount = geometry.complexity && Number.isFinite(geometry.complexity.valueNodes)
        ? geometry.complexity.valueNodes
        : itemCount
      materializedItemCount += itemCount
      materializedValueNodeCount += valueNodeCount
      reserveSharedWork(
        'remainingMaterializedItems',
        itemCount,
        'Geometry Nodes batch exceeded the safe geometry-materialization limit',
      )
      reserveSharedWork(
        'remainingMaterializedValueNodes',
        valueNodeCount,
        'Geometry Nodes batch exceeded the safe geometry-complexity limit',
      )
      if (materializedItemCount > this.limits.maxMaterializedItems) {
        throw new RangeError('Geometry Nodes evaluation exceeded the safe geometry-materialization limit')
      }
      if (materializedValueNodeCount > this.limits.maxMaterializedValueNodes) {
        throw new RangeError('Geometry Nodes evaluation exceeded the safe geometry-complexity limit')
      }
    }

    const consumeLink = (link, inputSocket) => {
      const sourceOutputs = evaluateNode(link.fromNode)
      const value = normaliseProcessedSocketValue(sourceOutputs[link.fromSocket], inputSocket)
      const remaining = (remainingConsumers.get(link.fromNode) || 0) - 1
      remainingConsumers.set(link.fromNode, remaining)
      if (remaining <= 0) nodeOutputs.delete(link.fromNode)
      return value
    }

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

      reserveNodeEvaluation()

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
            inputs[inputSocket.id] = incomingLinks.map(link => consumeLink(link, inputSocket))
            return
          }

          if (incomingLinks.length > 0) {
            const link = incomingLinks[incomingLinks.length - 1]
            inputs[inputSocket.id] = consumeLink(link, inputSocket)
            return
          }

          const value = hasOwn(node.values, inputSocket.id)
            ? node.values[inputSocket.id]
            : inputSocket.defaultValue
          inputs[inputSocket.id] = normaliseProcessedSocketValue(value, inputSocket)
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
          outputs[outputSocket.id] = normaliseProcessedSocketValue(value, outputSocket)
        })
        Object.values(outputs).forEach(chargeGeometrySet)
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
  DEFAULT_EVALUATION_LIMITS,
  GraphEvaluator,
  evaluateGraph,
}

export default GraphEvaluator
