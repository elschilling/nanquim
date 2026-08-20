// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SVG, registerWindow } from '@svgdotjs/svg.js'

import {
  GeometryNodeManager,
  MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS,
  SERIALIZED_GEOMETRY_NODE_LIMITS,
} from '../../src/js/geometry-nodes/GeometryNodeManager.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

function createSignal(onDispatch) {
  return { dispatch: (...args) => onDispatch?.(...args) }
}

function createEditor() {
  const svgNode = document.createElementNS(SVG_NS, 'svg')
  const drawingNode = document.createElementNS(SVG_NS, 'g')
  drawingNode.setAttribute('id', 'Collection')
  const collectionNode = document.createElementNS(SVG_NS, 'g')
  collectionNode.setAttribute('id', 'collection-test')
  collectionNode.setAttribute('data-collection', 'true')
  drawingNode.appendChild(collectionNode)
  svgNode.appendChild(drawingNode)
  document.body.appendChild(svgNode)

  const editor = {
    elementIndex: 1,
    commands: [],
    drawing: SVG(drawingNode),
    activeCollection: SVG(collectionNode),
    selected: [],
    spatialIndex: { markDirty() {} },
    fullSpatialIndex: { markDirty() {} },
    signals: new Proxy({}, {
      get(target, key) {
        if (!target[key]) target[key] = createSignal()
        return target[key]
      },
    }),
    execute(command) {
      this.lastCommand = command
      this.commands.push(command)
      command.execute()
    },
  }
  return editor
}

describe('GeometryNodeManager lifecycle', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    registerWindow(window, document)
  })

  test('attaches source non-destructively, evaluates a graph, and serializes references', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const manager = new GeometryNodeManager(editor)

    const instance = manager.attachSelection([line], null, false)

    expect(instance.wrapper.attr('data-geometry-nodes')).toBe('true')
    expect(instance.source.attr('data-hidden')).toBe('true')
    expect(instance.source.node.contains(line.node)).toBe(true)
    expect(instance.output.node.children).toHaveLength(1)

    const graph = manager.getGraph(instance.graphId)
    const input = graph.nodes.find((node) => node.type === 'groupInput')
    const output = graph.nodes.find((node) => node.type === 'groupOutput')
    const array = manager.addNode(graph.id, 'linearArray', 0, 0)
    manager.setNodeValue(graph.id, array.id, 'count', 3)
    manager.setNodeValue(graph.id, array.id, 'offsetX', 20)
    manager.connect(graph.id, input.id, 'geometry', array.id, 'geometry')
    manager.connect(graph.id, array.id, 'geometry', output.id, 'geometry')

    expect(instance.status).toBe('ready')
    expect(instance.output.node.children).toHaveLength(3)
    expect(instance.output.node.querySelectorAll('[data-gn-derived="true"]').length).toBeGreaterThanOrEqual(3)

    const saved = manager.serialize()
    expect(saved.graphs).toHaveLength(1)
    expect(saved.instances).toEqual([expect.objectContaining({
      id: instance.id,
      objectId: instance.objectId,
      graphId: graph.id,
      enabled: true,
    })])
  })

  test('persists graph views only with dirty tracking and keeps active selection transient', () => {
    const editor = createEditor()
    editor.documentState = { markChanged: vi.fn() }
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const manager = new GeometryNodeManager(editor)
    const instance = manager.attachSelection([line], null, false)
    const graph = manager.getGraph(instance.graphId)

    const beforeView = JSON.stringify(manager.serialize())
    expect(manager.setGraphView(graph.id, { x: 24, y: -18, zoom: 1.4 })).toBe(true)
    expect(editor.documentState.markChanged).toHaveBeenCalledOnce()
    expect(editor.documentState.markChanged).toHaveBeenCalledWith('geometry-nodes-view')
    expect(manager.serialize().graphs[0].view).toEqual({ x: 24, y: -18, zoom: 1.4 })
    expect(JSON.stringify(manager.serialize())).not.toBe(beforeView)

    editor.documentState.markChanged.mockClear()
    const savedBytes = JSON.stringify(manager.serialize())
    expect(manager.setGraphView(graph.id, { x: 24, y: -18, zoom: 1.4 })).toBe(false)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
    expect(JSON.stringify(manager.serialize())).toBe(savedBytes)
    expect(() => manager.setGraphView(graph.id, { x: 0, y: 0, zoom: 2.6 })).toThrow(
      /outside the supported range/,
    )
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()
    expect(JSON.stringify(manager.serialize())).toBe(savedBytes)

    expect(manager.serialize()).not.toHaveProperty('activeObjectId')
    manager.setActiveByElement(null)
    expect(manager.activeObjectId).toBeNull()
    expect(JSON.stringify(manager.serialize())).toBe(savedBytes)
    expect(editor.documentState.markChanged).not.toHaveBeenCalled()

    const restored = new GeometryNodeManager(editor)
    restored.load({ ...manager.serialize(), activeObjectId: instance.objectId })
    expect(restored.activeObjectId).toBeNull()
    expect(restored.serialize()).not.toHaveProperty('activeObjectId')
  })

  test('apply is undoable and restores the procedural source/output pair', () => {
    const editor = createEditor()
    const circle = editor.activeCollection.circle(10).center(5, 5).stroke('#ffffff')
    const manager = new GeometryNodeManager(editor)
    const instance = manager.attachSelection([circle], null, false)

    manager.applyModifier(instance.id)

    expect(manager.instances.has(instance.id)).toBe(false)
    expect(instance.wrapper.attr('data-geometry-nodes')).toBeUndefined()
    expect(instance.wrapper.node.querySelector('[data-gn-source]')).toBeNull()

    editor.lastCommand.undo()

    expect(manager.instances.has(instance.id)).toBe(true)
    expect(instance.wrapper.attr('data-geometry-nodes')).toBe('true')
    expect(instance.wrapper.node.querySelector('[data-gn-source="true"]')).not.toBeNull()
    expect(instance.wrapper.node.querySelector('[data-gn-output="true"]')).not.toBeNull()
  })

  test('remove keeps wrapper placement and is undoable', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const manager = new GeometryNodeManager(editor)
    const instance = manager.attachSelection([line], null, false)
    instance.wrapper.attr('transform', 'matrix(1 0 0 1 35 -12)')

    manager.removeModifier(instance.id)

    expect(manager.instances.has(instance.id)).toBe(false)
    expect(instance.wrapper.attr('transform')).toBe('matrix(1 0 0 1 35 -12)')
    expect(instance.wrapper.attr('data-geometry-nodes')).toBeUndefined()
    expect(instance.wrapper.node.querySelector('line')).toBe(line.node)

    editor.lastCommand.undo()
    expect(manager.instances.has(instance.id)).toBe(true)
    expect(instance.wrapper.attr('data-geometry-nodes')).toBe('true')
    expect(instance.source.node.querySelector('line')).toBe(line.node)

    editor.lastCommand.execute()
    expect(manager.instances.has(instance.id)).toBe(false)
    expect(instance.wrapper.attr('transform')).toBe('matrix(1 0 0 1 35 -12)')
    expect(instance.wrapper.node.querySelector('line')).toBe(line.node)
  })

  test('a second manager restores persisted graphs against cached wrapper DOM', () => {
    const editor = createEditor()
    const rect = editor.activeCollection.rect(10, 20).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const instance = first.attachSelection([rect], null, false)
    const saved = first.serialize()

    const restored = new GeometryNodeManager(editor)
    restored.load(saved)

    expect(restored.instances.size).toBe(1)
    expect(restored.getGraph(instance.graphId)).not.toBeNull()
    expect(restored.instances.get(instance.id).status).toBe('ready')
    expect(restored.instances.get(instance.id).output.node.children).toHaveLength(1)
  })

  test('stops a load batch when attempted procedural work exhausts its shared budget', () => {
    const editor = createEditor()
    const firstLine = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const secondLine = editor.activeCollection.line(0, 10, 10, 10).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const firstInstance = first.attachSelection([firstLine], null, false)
    const secondInstance = first.attachSelection([secondLine], firstInstance.graphId, false)
    const secondCachedOutput = secondInstance.output.node.innerHTML
    const saved = first.serialize()

    const restored = new GeometryNodeManager(editor, {
      batchBudgetLimits: { remainingItems: 1 },
    })
    restored.load(saved)

    expect(restored.instances.get(firstInstance.id).status).toBe('ready')
    expect(restored.instances.get(secondInstance.id).status).toBe('error')
    expect(restored.instances.get(secondInstance.id).diagnostics).toEqual([
      expect.objectContaining({ code: 'load-evaluation-budget-exhausted' }),
    ])
    expect(secondInstance.output.node.innerHTML).toBe(secondCachedOutput)
  })

  test('validates a shared invalid graph once and bounds each instance diagnostic list', () => {
    const editor = createEditor()
    const firstLine = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const secondLine = editor.activeCollection.line(0, 10, 10, 10).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const firstInstance = first.attachSelection([firstLine], null, false)
    const secondInstance = first.attachSelection([secondLine], firstInstance.graphId, false)
    const saved = first.serialize()
    const savedGraph = saved.graphs.find((graph) => graph.id === firstInstance.graphId)
    const output = savedGraph.nodes.find((node) => node.type === 'groupOutput')
    for (let index = 0; index < 200; index += 1) {
      savedGraph.links.push({
        id: `invalid-link-${index}`,
        fromNode: `missing-node-${index}`,
        fromSocket: 'geometry',
        toNode: output.id,
        toSocket: 'geometry',
      })
    }

    const restored = new GeometryNodeManager(editor)
    const validate = vi.spyOn(restored.evaluator.validator, 'validate')
    restored.load(saved)

    const restoredFirst = restored.instances.get(firstInstance.id)
    const restoredSecond = restored.instances.get(secondInstance.id)
    expect(validate).toHaveBeenCalledTimes(1)
    expect(restoredFirst.status).toBe('error')
    expect(restoredSecond.status).toBe('error')
    expect(restoredFirst.diagnostics.length).toBeLessThanOrEqual(
      MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS,
    )
    expect(restoredSecond.diagnostics.length).toBeLessThanOrEqual(
      MAX_RETAINED_GEOMETRY_NODE_DIAGNOSTICS,
    )
    const firstMarker = restoredFirst.diagnostics.find(
      (item) => item.code === 'diagnostics-truncated',
    )
    const secondMarker = restoredSecond.diagnostics.find(
      (item) => item.code === 'diagnostics-truncated',
    )
    expect(firstMarker?.omittedCount).toBeGreaterThan(0)
    expect(secondMarker?.omittedCount).toBe(firstMarker.omittedCount)
  })

  test('ignores cached wrappers that have no matching serialized instance', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const instance = first.attachSelection([line], null, false)
    const saved = first.serialize()
    saved.instances = []

    const cachedOutput = instance.output.node.innerHTML
    const restored = new GeometryNodeManager(editor)
    restored.load(saved)

    expect(restored.instances.size).toBe(0)
    expect(instance.output.node.innerHTML).toBe(cachedOutput)
    expect(instance.wrapper.attr('data-geometry-nodes')).toBe('true')
  })

  test('does not bind a modifier when source and output roles are ambiguous', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const instance = first.attachSelection([line], null, false)
    const saved = first.serialize()
    instance.source.attr('data-gn-output', 'true')
    instance.output.node.removeAttribute('data-gn-output')

    const restored = new GeometryNodeManager(editor)
    restored.load(saved)

    expect(restored.instances.size).toBe(0)
    expect(instance.source.node.contains(line.node)).toBe(true)
  })

  test('uses canonical source geometry even when serialized inputs spoof geometry', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const instance = first.attachSelection([line], null, false)
    const saved = first.serialize()
    saved.instances[0].inputs = {
      geometry: [{
        id: 'spoofed',
        svg: '<image href="https://attacker.invalid/pixel.png" onload="globalThis.pwned=true"/>',
      }],
      exposedValue: 42,
    }

    const restored = new GeometryNodeManager(editor)
    restored.load(saved)
    const restoredInstance = restored.instances.get(instance.id)

    expect(restoredInstance.inputs).toEqual({ exposedValue: 42 })
    expect(restoredInstance.output.node.querySelector('line')).not.toBeNull()
    expect(restoredInstance.output.node.querySelector('image')).toBeNull()
    expect(restoredInstance.status).toBe('ready')
  })

  test('rejects excessive or duplicate DOM modifier wrappers before replacing state', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    const current = manager.createGraph('Current graph')
    const fragment = document.createDocumentFragment()
    for (let index = 0; index <= SERIALIZED_GEOMETRY_NODE_LIMITS.maxInstances; index += 1) {
      const wrapper = document.createElementNS(SVG_NS, 'g')
      wrapper.setAttribute('data-geometry-nodes', 'true')
      fragment.appendChild(wrapper)
    }
    editor.activeCollection.node.appendChild(fragment)

    expect(() => manager.load({ version: 1, graphs: [], instances: [] })).toThrow(/too many.*wrappers/i)
    expect(manager.getGraph(current.id)).toBe(current)

    editor.activeCollection.node.replaceChildren()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const instance = first.attachSelection([line], null, false)
    const saved = first.serialize()
    editor.activeCollection.node.appendChild(instance.wrapper.node.cloneNode(true))

    expect(() => manager.load(saved)).toThrow(/Duplicate Geometry Nodes wrapper id/)
    expect(manager.getGraph(current.id)).toBe(current)
  })

  test('rejects unsupported or oversized persisted graphs before replacing current state', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    const current = manager.createGraph('Current graph')

    expect(() => manager.load({ version: 2, graphs: [], instances: [] })).toThrow(/Unsupported/)
    expect(manager.getGraph(current.id)).toBe(current)

    expect(() => manager.load({
      version: 1,
      graphs: [],
      instances: [
        { id: 'instance-a', objectId: 'same-object', graphId: 'graph-a' },
        { id: 'instance-b', objectId: 'same-object', graphId: 'graph-a' },
      ],
    })).toThrow(/Duplicate Geometry Nodes object id/)
    expect(manager.getGraph(current.id)).toBe(current)

    const oversizedNodes = Array.from(
      { length: SERIALIZED_GEOMETRY_NODE_LIMITS.maxNodesPerGraph + 1 },
      (_, index) => ({ id: `node-${index}`, type: 'float', values: {} }),
    )
    expect(() => manager.load({
      version: 1,
      graphs: [{ id: 'too-large', nodes: oversizedNodes, links: [] }],
      instances: [],
    })).toThrow(/topology limit/)
    expect(manager.getGraph(current.id)).toBe(current)
  })

  test('persisted style values cannot reintroduce external SVG paint resources', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const first = new GeometryNodeManager(editor)
    const instance = first.attachSelection([line], null, false)
    const graph = first.getGraph(instance.graphId)
    const input = graph.nodes.find((node) => node.type === 'groupInput')
    const output = graph.nodes.find((node) => node.type === 'groupOutput')
    const style = first.addNode(graph.id, 'setStyle', 0, 0)
    first.setNodeValue(graph.id, style.id, 'stroke', 'url(https://example.test/paint.svg#x)')
    first.setNodeValue(graph.id, style.id, 'fill', 'image-set("https://example.test/fill.png" 1x)')
    first.connect(graph.id, input.id, 'geometry', style.id, 'geometry')
    first.connect(graph.id, style.id, 'geometry', output.id, 'geometry')

    const saved = first.serialize()
    const restored = new GeometryNodeManager(editor)
    restored.load(saved)

    const rendered = restored.instances.get(instance.id).output.node
    const renderedAttributeValues = Array.from(rendered.querySelectorAll('*')).flatMap((element) => (
      Array.from(element.attributes).map((attribute) => attribute.value)
    ))
    expect(renderedAttributeValues.join('\n')).not.toMatch(/example\.test|image-set/i)
    expect(restored.instances.get(instance.id).status).toBe('ready')
  })

  test('compound move and delete gestures each create one history command', () => {
    const editor = createEditor()
    const line = editor.activeCollection.line(0, 0, 10, 0).stroke('#ffffff')
    const manager = new GeometryNodeManager(editor)
    const instance = manager.attachSelection([line], null, false)
    const graph = manager.getGraph(instance.graphId)
    const [input, output] = graph.nodes
    const originalLink = graph.links[0]

    editor.commands.length = 0
    manager.setNodePositions(graph.id, [
      { id: input.id, x: -400, y: 10 },
      { id: output.id, x: 400, y: 20 },
    ])
    expect(editor.commands).toHaveLength(1)
    expect(manager.getGraph(graph.id).nodes.map((node) => [node.x, node.y])).toEqual([
      [-400, 10],
      [400, 20],
    ])
    editor.lastCommand.undo()
    expect(manager.getGraph(graph.id).nodes.map((node) => [node.x, node.y])).toEqual([
      [-240, 0],
      [240, 0],
    ])

    editor.commands.length = 0
    manager.deleteSelection(graph.id, [], [originalLink.id])
    expect(editor.commands).toHaveLength(1)
    expect(manager.getGraph(graph.id).links).toHaveLength(0)
    editor.lastCommand.undo()
    expect(manager.getGraph(graph.id).links).toHaveLength(1)
  })

  test('inserts an unconnected geometry node into a wire with move and rewire in one undo step', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    manager.registry.register({
      type: 'mixedGeometryPass',
      label: 'Mixed Geometry Pass',
      inputs: () => [
        { id: 'anyInput', name: 'Any Input', type: 'any' },
        { id: 'geometryInput', name: 'Geometry Input', type: 'geometry' },
      ],
      outputs: () => [
        { id: 'anyOutput', name: 'Any Output', type: 'any' },
        { id: 'geometryOutput', name: 'Geometry Output', type: 'geometry' },
      ],
      evaluate: ({ inputs }) => ({
        anyOutput: inputs.anyInput,
        geometryOutput: inputs.geometryInput,
      }),
    })
    const graph = manager.createGraph('Insert geometry')
    const graphId = graph.id
    const originalLink = graph.links[0]
    const passthrough = manager.addNode(graphId, 'mixedGeometryPass', 15, 25)

    editor.commands.length = 0
    const plan = manager.getLinkInsertionPlan(graphId, passthrough.id, originalLink.id)
    expect(plan).toEqual(expect.objectContaining({
      graphId,
      nodeId: passthrough.id,
      linkId: originalLink.id,
      inputSocket: expect.objectContaining({ id: 'geometryInput', type: 'geometry' }),
      outputSocket: expect.objectContaining({ id: 'geometryOutput', type: 'geometry' }),
    }))

    const result = manager.insertNodeOnLink(graphId, passthrough.id, originalLink.id, { x: 42, y: -18 })
    const insertedGraph = manager.getGraph(graphId)

    expect(editor.commands).toHaveLength(1)
    expect(editor.lastCommand.name).toBe('Insert Geometry Node')
    expect(result.links).toHaveLength(2)
    expect(result.position).toEqual({ x: 42, y: -18 })
    expect(insertedGraph.links).toHaveLength(2)
    expect(insertedGraph.links).not.toContainEqual(expect.objectContaining({ id: originalLink.id }))
    expect(insertedGraph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNode: originalLink.fromNode,
        fromSocket: originalLink.fromSocket,
        toNode: passthrough.id,
        toSocket: 'geometryInput',
      }),
      expect.objectContaining({
        fromNode: passthrough.id,
        fromSocket: 'geometryOutput',
        toNode: originalLink.toNode,
        toSocket: originalLink.toSocket,
      }),
    ]))

    editor.lastCommand.undo()
    const restoredGraph = manager.getGraph(graphId)
    expect(restoredGraph.links).toEqual([expect.objectContaining({ id: originalLink.id })])
    expect(restoredGraph.nodes.find((node) => node.id === passthrough.id)).toEqual(expect.objectContaining({
      x: 15,
      y: 25,
    }))
  })

  test('inserts and resolves multiple node positions in the same undo snapshot', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    const graph = manager.createGraph('Atomic insertion layout')
    const input = graph.nodes.find((node) => node.type === 'groupInput')
    const output = graph.nodes.find((node) => node.type === 'groupOutput')
    const originalLink = graph.links[0]
    const inserted = manager.addNode(graph.id, 'transformGeometry', 20, 140)
    const originalPositions = Object.fromEntries(
      manager.getGraph(graph.id).nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    )

    editor.commands.length = 0
    const nodePositions = [
      { id: input.id, x: -380, y: -45 },
      { id: inserted.id, x: 5, y: 25 },
      { id: output.id, x: 390, y: 55 },
    ]
    const result = manager.insertNodeOnLink(graph.id, inserted.id, originalLink.id, {
      nodePositions,
    })

    expect(editor.commands).toHaveLength(1)
    expect(result.position).toEqual({ x: 5, y: 25 })
    expect(result.nodePositions).toEqual(nodePositions)
    expect(result.positions).toEqual(nodePositions)
    expect(manager.getGraph(graph.id).nodes).toEqual(expect.arrayContaining(
      nodePositions.map((position) => expect.objectContaining(position)),
    ))
    expect(manager.getGraph(graph.id).links).toHaveLength(2)

    editor.lastCommand.undo()
    const restored = manager.getGraph(graph.id)
    expect(restored.links).toEqual([expect.objectContaining({ id: originalLink.id })])
    restored.nodes.forEach((node) => {
      expect({ x: node.x, y: node.y }).toEqual(originalPositions[node.id])
    })
  })

  test('rejects invalid insertion position batches before mutation or history', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    const graph = manager.createGraph('Invalid insertion layout')
    const input = graph.nodes.find((node) => node.type === 'groupInput')
    const originalLink = graph.links[0]
    const inserted = manager.addNode(graph.id, 'transformGeometry', 0, 120)
    const before = manager.getGraph(graph.id).toJSON()
    const invalidOptions = [
      { nodePositions: {} },
      { nodePositions: [{ id: 'missing-node', x: 1, y: 2 }] },
      { nodePositions: [{ id: input.id, x: Infinity, y: 2 }] },
      { nodePositions: [{ id: input.id, x: 1, y: '2' }] },
      { nodePositions: [
        { id: input.id, x: 1, y: 2 },
        { id: input.id, x: 3, y: 4 },
      ] },
    ]

    editor.commands.length = 0
    invalidOptions.forEach((options) => {
      expect(manager.insertNodeOnLink(graph.id, inserted.id, originalLink.id, options)).toBeNull()
      expect(manager.getGraph(graph.id).toJSON()).toEqual(before)
    })
    expect(editor.commands).toHaveLength(0)

    const result = manager.insertNodeOnLink(graph.id, inserted.id, originalLink.id, {
      x: 10,
      y: 15,
      nodePositions: [],
    })
    expect(result.nodePositions).toEqual([])
    expect(editor.commands).toHaveLength(1)
  })

  test('planner uses dynamic sockets and chooses exact numeric sockets before permissive any sockets', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    manager.registry.register({
      type: 'dynamicNumericPass',
      label: 'Dynamic Numeric Pass',
      inputs: () => [
        { id: 'anyInput', name: 'Any Input', type: 'any' },
        { id: 'numberInput', name: 'Number Input', type: 'float', defaultValue: 0 },
      ],
      outputs: () => [
        { id: 'anyOutput', name: 'Any Output', type: 'any' },
        { id: 'numberOutput', name: 'Number Output', type: 'float', defaultValue: 0 },
      ],
      evaluate: ({ inputs }) => ({
        anyOutput: inputs.anyInput,
        numberOutput: inputs.numberInput,
      }),
    })

    const graph = manager.createGraph('Numeric insertion', {
      id: 'numeric-insertion',
      nodes: [
        { id: 'source', type: 'float', x: -200, y: 0, values: { value: 1 } },
        { id: 'target', type: 'math', x: 200, y: 0, values: { operation: 'add' } },
        { id: 'inserted', type: 'dynamicNumericPass', x: 0, y: 100, values: {} },
      ],
      links: [{
        id: 'numeric-link',
        fromNode: 'source',
        fromSocket: 'value',
        toNode: 'target',
        toSocket: 'a',
      }],
    })

    const plan = manager.getLinkInsertionPlan(graph.id, 'inserted', 'numeric-link')
    expect(plan.inputSocket.id).toBe('numberInput')
    expect(plan.outputSocket.id).toBe('numberOutput')

    editor.commands.length = 0
    const result = manager.insertNodeOnLink(graph.id, 'inserted', 'numeric-link', {
      position: { x: -7, y: 91 },
    })
    expect(result.inputSocket.id).toBe('numberInput')
    expect(result.outputSocket.id).toBe('numberOutput')
    expect(result.position).toEqual({ x: -7, y: 91 })
    expect(editor.commands).toHaveLength(1)
  })

  test('refuses interface, connected, and incompatible nodes without adding history', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    const graph = manager.createGraph('Rejected insertions')
    const graphId = graph.id
    const originalLink = graph.links[0]
    const input = graph.nodes.find((node) => node.type === 'groupInput')
    const circle = manager.addNode(graphId, 'circle', 0, 0)
    const array = manager.addNode(graphId, 'linearArray', 0, 0)
    manager.connect(graphId, input.id, 'geometry', array.id, 'geometry')

    editor.commands.length = 0
    expect(manager.getLinkInsertionPlan(graphId, input.id, originalLink.id)).toBeNull()
    expect(manager.insertNodeOnLink(graphId, input.id, originalLink.id)).toBeNull()
    expect(manager.getLinkInsertionPlan(graphId, array.id, originalLink.id)).toBeNull()
    expect(manager.insertNodeOnLink(graphId, array.id, originalLink.id)).toBeNull()
    expect(editor.commands).toHaveLength(0)

    const numericGraph = manager.createGraph('Incompatible insertion', {
      id: 'incompatible-insertion',
      nodes: [
        { id: 'number-source', type: 'float', x: -200, y: 0, values: { value: 1 } },
        { id: 'number-target', type: 'math', x: 200, y: 0, values: { operation: 'add' } },
        { id: circle.id, type: 'circle', x: 0, y: 0, values: {} },
      ],
      links: [{
        id: 'number-link',
        fromNode: 'number-source',
        fromSocket: 'value',
        toNode: 'number-target',
        toSocket: 'a',
      }],
    })
    editor.commands.length = 0
    expect(manager.getLinkInsertionPlan(numericGraph.id, circle.id, 'number-link')).toBeNull()
    expect(manager.insertNodeOnLink(numericGraph.id, circle.id, 'number-link')).toBeNull()
    expect(editor.commands).toHaveLength(0)
    expect(manager.getGraph(numericGraph.id).links).toEqual([
      expect.objectContaining({ id: 'number-link' }),
    ])
  })

  test('adds and connects a searched node from an output in one undoable command', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    manager.registry.register({
      type: 'searchNumericTarget',
      label: 'Search Numeric Target',
      inputs: () => [
        { id: 'anything', name: 'Anything', type: 'any' },
        { id: 'first', name: 'First', type: 'float', defaultValue: 0 },
        { id: 'second', name: 'Second', type: 'float', defaultValue: 0 },
      ],
      outputs: [],
      evaluate: () => ({}),
    })
    const graph = manager.createGraph('Drag search output', {
      id: 'drag-search-output',
      nodes: [{ id: 'source', type: 'float', x: -100, y: 20, values: { value: 7 } }],
      links: [],
    })
    const origin = { nodeId: 'source', socketId: 'value', direction: 'output', type: 'float' }

    editor.commands.length = 0
    const plans = manager.getNodeConnectionPlans(graph.id, origin, 'searchNumericTarget')
    expect(plans.map((plan) => plan.connectionSocket.id)).toEqual(['first', 'second', 'anything'])
    expect(manager.getNodeConnectionPlan(graph.id, origin, 'searchNumericTarget')).toEqual(
      expect.objectContaining({
        direction: 'output',
        origin: expect.objectContaining(origin),
        connectionSocket: expect.objectContaining({ id: 'first', type: 'float' }),
      }),
    )
    expect(editor.commands).toHaveLength(0)

    const result = manager.addNodeConnectedToSocket(
      graph.id,
      origin,
      'searchNumericTarget',
      { position: { x: 45, y: -30 }, plan: plans[1] },
    )
    const connectedGraph = manager.getGraph(graph.id)

    expect(editor.commands).toHaveLength(1)
    expect(editor.lastCommand.name).toBe('Add Connected Search Numeric Target')
    expect(result.connectionSocket.id).toBe('second')
    expect(result.position).toEqual({ x: 45, y: -30 })
    expect(connectedGraph.nodes).toContainEqual(expect.objectContaining({
      id: result.node.id,
      type: 'searchNumericTarget',
      x: 45,
      y: -30,
    }))
    expect(connectedGraph.links).toEqual([
      expect.objectContaining({
        id: result.link.id,
        fromNode: 'source',
        fromSocket: 'value',
        toNode: result.node.id,
        toSocket: 'second',
      }),
    ])

    editor.lastCommand.undo()
    expect(manager.getGraph(graph.id).nodes).toEqual([
      expect.objectContaining({ id: 'source', type: 'float' }),
    ])
    expect(manager.getGraph(graph.id).links).toEqual([])
  })

  test('adding from a non-multi input replaces its inbound link and undo restores it', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    const graph = manager.createGraph('Drag search input')
    const output = graph.nodes.find((node) => node.type === 'groupOutput')
    const originalLink = graph.links[0]
    const origin = {
      nodeId: output.id,
      socketId: 'geometry',
      direction: 'input',
      type: 'geometry',
    }

    editor.commands.length = 0
    const plan = manager.getNodeConnectionPlan(graph.id, origin, 'linearArray')
    expect(plan).toEqual(expect.objectContaining({
      direction: 'input',
      connectionSocket: expect.objectContaining({ id: 'geometry', type: 'geometry' }),
      replacedLinks: [expect.objectContaining({ id: originalLink.id })],
    }))

    const result = manager.addNodeConnectedToSocket(graph.id, origin, 'linearArray', {
      position: { x: 80, y: 60 },
    })
    expect(editor.commands).toHaveLength(1)
    expect(result.replacedLinks).toEqual([expect.objectContaining({ id: originalLink.id })])
    expect(manager.getGraph(graph.id).links).toEqual([
      expect.objectContaining({
        fromNode: result.node.id,
        fromSocket: 'geometry',
        toNode: output.id,
        toSocket: 'geometry',
      }),
    ])

    editor.lastCommand.undo()
    expect(manager.getGraph(graph.id).nodes).toHaveLength(2)
    expect(manager.getGraph(graph.id).links).toEqual([
      expect.objectContaining({ id: originalLink.id }),
    ])
  })

  test('adding from a multi input preserves existing links', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    manager.registry.register({
      type: 'multiInputTarget',
      label: 'Multi Input Target',
      inputs: [{ id: 'values', name: 'Values', type: 'float', defaultValue: 0, multi: true }],
      outputs: [],
      evaluate: () => ({}),
    })
    const graph = manager.createGraph('Multi input drag search', {
      id: 'multi-input-drag-search',
      nodes: [
        { id: 'first-source', type: 'float', x: -200, y: 0, values: { value: 1 } },
        { id: 'target', type: 'multiInputTarget', x: 200, y: 0, values: {} },
      ],
      links: [{
        id: 'existing-multi-link',
        fromNode: 'first-source',
        fromSocket: 'value',
        toNode: 'target',
        toSocket: 'values',
      }],
    })
    const origin = { nodeId: 'target', socketId: 'values', direction: 'input', type: 'float' }

    editor.commands.length = 0
    const result = manager.addNodeConnectedToSocket(graph.id, origin, 'float', { x: 0, y: 0 })
    expect(result.replacedLinks).toEqual([])
    expect(editor.commands).toHaveLength(1)
    expect(manager.getGraph(graph.id).links).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'existing-multi-link' }),
      expect.objectContaining({
        fromNode: result.node.id,
        fromSocket: 'value',
        toNode: 'target',
        toSocket: 'values',
      }),
    ]))
  })

  test('drag search rejects hidden, unknown, stale, and incompatible choices without history', () => {
    const editor = createEditor()
    const manager = new GeometryNodeManager(editor)
    manager.registry.register({
      type: 'hiddenNumericTarget',
      label: 'Hidden Numeric Target',
      hidden: true,
      inputs: [{ id: 'value', name: 'Value', type: 'float', defaultValue: 0 }],
      outputs: [],
      evaluate: () => ({}),
    })
    const graph = manager.createGraph('Rejected drag search', {
      id: 'rejected-drag-search',
      nodes: [{ id: 'source', type: 'float', x: 0, y: 0, values: { value: 1 } }],
      links: [],
    })
    const origin = { nodeId: 'source', socketId: 'value', direction: 'output', type: 'float' }

    editor.commands.length = 0
    expect(manager.getNodeConnectionPlan(graph.id, origin, 'hiddenNumericTarget')).toBeNull()
    expect(manager.getNodeConnectionPlan(graph.id, origin, 'groupOutput')).toBeNull()
    expect(manager.getNodeConnectionPlan(graph.id, origin, 'missingType')).toBeNull()
    expect(manager.getNodeConnectionPlan(graph.id, origin, 'color')).toBeNull()
    expect(manager.getNodeConnectionPlan(graph.id, { ...origin, type: 'geometry' }, 'math')).toBeNull()
    expect(manager.addNodeConnectedToSocket(graph.id, origin, 'color', { x: 5, y: 6 })).toBeNull()
    expect(manager.addNodeConnectedToSocket(graph.id, origin, 'math', {
      x: 5,
      y: 6,
      connectionSocketId: 'missing-socket',
    })).toBeNull()
    expect(editor.commands).toHaveLength(0)
    expect(manager.getGraph(graph.id).nodes).toEqual([
      expect.objectContaining({ id: 'source', type: 'float' }),
    ])
    expect(manager.getGraph(graph.id).links).toEqual([])
  })
})
