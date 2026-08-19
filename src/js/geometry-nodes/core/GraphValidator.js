import { builtinRegistry, socketTypesCompatible } from './NodeRegistry.js'

function diagnostic(level, code, message, details = {}) {
  return {
    level,
    severity: level,
    code,
    message,
    ...details,
  }
}

function graphArrays(graph) {
  return {
    nodes: graph && Array.isArray(graph.nodes) ? graph.nodes : [],
    links: graph && Array.isArray(graph.links) ? graph.links : [],
  }
}

function collectReachableNodeIds(graph) {
  const { nodes, links } = graphArrays(graph)
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const incoming = new Map()

  links.forEach(link => {
    if (!incoming.has(link.toNode)) incoming.set(link.toNode, [])
    incoming.get(link.toNode).push(link)
  })

  const reachable = new Set()
  const stack = nodes
    .filter(node => node.type === 'groupOutput')
    .map(node => node.id)

  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)

    ;(incoming.get(nodeId) || []).forEach(link => {
      if (nodeMap.has(link.fromNode) && !reachable.has(link.fromNode)) {
        stack.push(link.fromNode)
      }
    })
  }

  return reachable
}

function findCycles(nodes, links, includedNodeIds) {
  const dependencies = new Map()
  nodes.forEach(node => dependencies.set(node.id, []))
  links.forEach(link => {
    if (!dependencies.has(link.toNode) || !dependencies.has(link.fromNode)) return
    dependencies.get(link.toNode).push(link.fromNode)
  })

  const state = new Map()
  const stack = []
  const cycles = []
  const cycleKeys = new Set()

  function visit(nodeId) {
    if (includedNodeIds && !includedNodeIds.has(nodeId)) return
    const status = state.get(nodeId)
    if (status === 'done') return
    if (status === 'visiting') {
      const start = stack.lastIndexOf(nodeId)
      const cycle = [...stack.slice(Math.max(0, start)), nodeId]
      const key = [...new Set(cycle)].sort().join('|')
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key)
        cycles.push(cycle)
      }
      return
    }

    state.set(nodeId, 'visiting')
    stack.push(nodeId)
    ;(dependencies.get(nodeId) || []).forEach(visit)
    stack.pop()
    state.set(nodeId, 'done')
  }

  nodes.forEach(node => visit(node.id))
  return cycles
}

class GraphValidator {
  constructor(registry = builtinRegistry) {
    this.registry = registry
  }

  validate(graph, { reachableOnly = false } = {}) {
    const diagnostics = []
    const { nodes, links } = graphArrays(graph)
    const reachableNodeIds = collectReachableNodeIds(graph)
    const includedNodeIds = reachableOnly ? reachableNodeIds : null
    const relevantNode = node => !includedNodeIds || includedNodeIds.has(node.id)
    const relevantLink = link => (
      !includedNodeIds ||
      includedNodeIds.has(link.fromNode) ||
      includedNodeIds.has(link.toNode)
    )

    if (!graph || typeof graph !== 'object') {
      diagnostics.push(diagnostic('error', 'invalid-graph', 'Graph must be an object'))
      return { valid: false, diagnostics, reachableNodeIds }
    }

    const nodeMap = new Map()
    nodes.forEach(node => {
      if (!node || typeof node !== 'object') {
        diagnostics.push(diagnostic('error', 'invalid-node', 'Graph contains an invalid node'))
        return
      }
      if (nodeMap.has(node.id)) {
        diagnostics.push(diagnostic('error', 'duplicate-node-id', `Duplicate node id "${node.id}"`, {
          nodeId: node.id,
        }))
      } else {
        nodeMap.set(node.id, node)
      }
    })

    const outputNodes = nodes.filter(node => node.type === 'groupOutput')
    if (outputNodes.length === 0) {
      diagnostics.push(diagnostic('error', 'missing-group-output', 'Graph requires a Group Output node'))
    } else if (outputNodes.length > 1) {
      diagnostics.push(diagnostic('warning', 'multiple-group-outputs', 'Only the first Group Output node is evaluated', {
        nodeId: outputNodes[0].id,
      }))
    }

    if (!nodes.some(node => node.type === 'groupInput')) {
      diagnostics.push(diagnostic('warning', 'missing-group-input', 'Graph has no Group Input node'))
    }

    nodes.filter(relevantNode).forEach(node => {
      if (!node.id) {
        diagnostics.push(diagnostic('error', 'missing-node-id', 'Node requires an id'))
      }
      if (!this.registry.has(node.type)) {
        diagnostics.push(diagnostic('error', 'unknown-node-type', `Unknown node type "${node.type}"`, {
          nodeId: node.id,
          nodeType: node.type,
        }))
      }
    })

    const linkIds = new Set()
    const incomingBySocket = new Map()
    links.filter(relevantLink).forEach(link => {
      if (linkIds.has(link.id)) {
        diagnostics.push(diagnostic('error', 'duplicate-link-id', `Duplicate link id "${link.id}"`, {
          linkId: link.id,
        }))
      }
      linkIds.add(link.id)

      const fromNode = nodeMap.get(link.fromNode)
      const toNode = nodeMap.get(link.toNode)
      if (!fromNode) {
        diagnostics.push(diagnostic('error', 'missing-source-node', `Link source node "${link.fromNode}" does not exist`, {
          linkId: link.id,
          nodeId: link.fromNode,
        }))
      }
      if (!toNode) {
        diagnostics.push(diagnostic('error', 'missing-target-node', `Link target node "${link.toNode}" does not exist`, {
          linkId: link.id,
          nodeId: link.toNode,
        }))
      }
      if (!fromNode || !toNode) return

      const outputSocket = this.registry
        .getOutputs(fromNode, graph)
        .find(socket => socket.id === link.fromSocket)
      const inputSocket = this.registry
        .getInputs(toNode, graph)
        .find(socket => socket.id === link.toSocket)

      if (!outputSocket) {
        diagnostics.push(diagnostic('error', 'missing-output-socket', `Output socket "${link.fromSocket}" does not exist`, {
          linkId: link.id,
          nodeId: fromNode.id,
          socketId: link.fromSocket,
        }))
      }
      if (!inputSocket) {
        diagnostics.push(diagnostic('error', 'missing-input-socket', `Input socket "${link.toSocket}" does not exist`, {
          linkId: link.id,
          nodeId: toNode.id,
          socketId: link.toSocket,
        }))
      }
      if (!outputSocket || !inputSocket) return

      if (!socketTypesCompatible(outputSocket.type, inputSocket.type)) {
        diagnostics.push(diagnostic('error', 'incompatible-sockets', `Cannot connect ${outputSocket.type} to ${inputSocket.type}`, {
          linkId: link.id,
          fromNodeId: fromNode.id,
          fromSocket: outputSocket.id,
          toNodeId: toNode.id,
          toSocket: inputSocket.id,
        }))
      }

      const inputKey = `${toNode.id}\u001f${inputSocket.id}`
      if (!incomingBySocket.has(inputKey)) incomingBySocket.set(inputKey, [])
      incomingBySocket.get(inputKey).push(link)
      if (!inputSocket.multi && incomingBySocket.get(inputKey).length > 1) {
        diagnostics.push(diagnostic('error', 'multiple-input-links', `Input "${inputSocket.name}" only accepts one link`, {
          linkId: link.id,
          nodeId: toNode.id,
          socketId: inputSocket.id,
        }))
      }
    })

    findCycles(nodes, links, includedNodeIds).forEach(cycle => {
      diagnostics.push(diagnostic('error', 'cycle', `Node cycle detected: ${cycle.join(' -> ')}`, {
        nodeId: cycle[0],
        nodeIds: cycle,
      }))
    })

    const interfaceDefinition = graph.interface && typeof graph.interface === 'object'
      ? graph.interface
      : {}
    ;['inputs', 'outputs'].forEach(direction => {
      const socketIds = new Set()
      const sockets = Array.isArray(interfaceDefinition[direction])
        ? interfaceDefinition[direction]
        : []
      sockets.forEach(socket => {
        if (socketIds.has(socket.id)) {
          diagnostics.push(diagnostic('error', 'duplicate-interface-socket', `Duplicate graph ${direction} socket "${socket.id}"`, {
            socketId: socket.id,
          }))
        }
        socketIds.add(socket.id)
      })
    })

    return {
      valid: !diagnostics.some(item => item.level === 'error'),
      diagnostics,
      reachableNodeIds,
    }
  }
}

function validateGraph(graph, registry = builtinRegistry, options) {
  return new GraphValidator(registry).validate(graph, options)
}

export {
  GraphValidator,
  collectReachableNodeIds,
  diagnostic,
  findCycles,
  validateGraph,
}

export default GraphValidator
