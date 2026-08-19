import { describe, expect, test } from 'vitest'

import { GeometrySet2D } from '../../src/js/geometry-nodes/core/GeometrySet2D.js'
import { GraphEvaluator } from '../../src/js/geometry-nodes/core/GraphEvaluator.js'
import { GraphValidator } from '../../src/js/geometry-nodes/core/GraphValidator.js'
import { NodeGraph } from '../../src/js/geometry-nodes/core/NodeGraph.js'
import { createBuiltinRegistry } from '../../src/js/geometry-nodes/core/NodeRegistry.js'

function setup() {
  const registry = createBuiltinRegistry()
  return {
    registry,
    evaluator: new GraphEvaluator(registry),
    graph: NodeGraph.create({ id: 'test-graph' }),
  }
}

function interfaceNodes(graph) {
  return {
    input: graph.nodes.find((node) => node.type === 'groupInput'),
    output: graph.nodes.find((node) => node.type === 'groupOutput'),
  }
}

function sourceGeometry() {
  return new GeometrySet2D([{
    id: 'source-line',
    svg: { tag: 'line', attrs: { x1: 0, y1: 0, x2: 5, y2: 0 } },
    matrix: [1, 0, 0, 1, 0, 0],
    style: { stroke: '#ffffff' },
  }])
}

describe('Geometry Nodes core evaluator', () => {
  test('the default graph passes source SVG through unchanged', () => {
    const { evaluator, graph } = setup()
    const source = sourceGeometry()

    const result = evaluator.evaluate(graph, { geometry: source })

    expect(result.diagnostics.filter((item) => item.level === 'error')).toEqual([])
    expect(result.geometry.size).toBe(1)
    expect(result.geometry.items[0]).toEqual(source.items[0])
  })

  test('linear array composes deterministic item transforms', () => {
    const { registry, evaluator, graph } = setup()
    const { input, output } = interfaceNodes(graph)
    graph.links = []
    const array = registry.createNode('linearArray', {
      id: 'array',
      graph,
      values: { count: 3, offsetX: 12, offsetY: -4 },
    })
    graph.addNode(array)
    graph.addLink(input.id, 'geometry', array.id, 'geometry', { id: 'source-array' })
    graph.addLink(array.id, 'geometry', output.id, 'geometry', { id: 'array-output' })

    const first = evaluator.evaluate(graph, { geometry: sourceGeometry() })
    const second = evaluator.evaluate(graph, { geometry: sourceGeometry() })

    expect(first.geometry.items.map((item) => item.matrix)).toEqual([
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 12, -4],
      [1, 0, 0, 1, 24, -8],
    ])
    expect(first.geometry.items.map((item) => item.id)).toEqual(
      second.geometry.items.map((item) => item.id),
    )
  })

  test('primitive and style nodes produce ordinary serializable SVG data', () => {
    const { registry, evaluator, graph } = setup()
    const { output } = interfaceNodes(graph)
    graph.links = []
    const circle = registry.createNode('circle', {
      id: 'circle',
      graph,
      values: { center: { x: 8, y: 9 }, radius: 12 },
    })
    const style = registry.createNode('setStyle', {
      id: 'style',
      graph,
      values: { stroke: '#ff3366', fill: '#102030', strokeWidth: 2.5, opacity: 0.6 },
    })
    graph.addNode(circle)
    graph.addNode(style)
    graph.addLink(circle.id, 'geometry', style.id, 'geometry', { id: 'circle-style' })
    graph.addLink(style.id, 'geometry', output.id, 'geometry', { id: 'style-output' })

    const result = evaluator.evaluate(graph)
    const [item] = result.geometry.items

    expect(item.svg).toEqual({ tag: 'circle', attrs: { cx: 8, cy: 9, r: 12 } })
    expect(item.style).toMatchObject({
      stroke: '#ff3366',
      fill: '#102030',
      'stroke-width': 2.5,
      opacity: 0.6,
    })
    expect(() => JSON.stringify(result.geometry.toJSON())).not.toThrow()
  })

  test('text primitive exposes editable typography sockets and produces SVG text geometry', () => {
    const { registry, evaluator, graph } = setup()
    const { output } = interfaceNodes(graph)
    graph.links = []
    const definition = registry.get('text')
    const text = registry.createNode('text', {
      id: 'text',
      graph,
      values: {
        text: 'Nanquim & SVG',
        position: { x: 18, y: 32 },
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: '700',
        anchor: 'middle',
        fill: '#21c7a8',
        opacity: 0.75,
      },
    })
    graph.addNode(text)
    graph.addLink(text.id, 'geometry', output.id, 'geometry', { id: 'text-output' })

    expect(definition.category).toBe('Primitives')
    expect(registry.getInputs(text, graph).map((input) => input.id)).toEqual([
      'text',
      'position',
      'fontSize',
      'fontFamily',
      'fontWeight',
      'anchor',
      'fill',
      'opacity',
    ])
    expect(definition.inputs.find((input) => input.id === 'anchor').options).toEqual([
      'start',
      'middle',
      'end',
    ])

    const result = evaluator.evaluate(graph)
    const [item] = result.geometry.items

    expect(result.diagnostics.filter((diagnostic) => diagnostic.level === 'error')).toEqual([])
    expect(item.svg).toEqual({
      tag: 'text',
      attrs: {
        x: 18,
        y: 32,
        'font-size': 16,
        'font-family': 'Inter',
        'font-weight': '700',
        'text-anchor': 'middle',
      },
      text: 'Nanquim & SVG',
    })
    expect(item.style).toEqual({ fill: '#21c7a8', opacity: 0.75 })
    expect(() => JSON.stringify(result.geometry.toJSON())).not.toThrow()
  })

  test('text primitive normalises unsafe numeric and anchor values', () => {
    const { registry, evaluator, graph } = setup()
    const { output } = interfaceNodes(graph)
    graph.links = []
    const text = registry.createNode('text', {
      id: 'text',
      graph,
      values: {
        text: null,
        fontSize: -8,
        fontFamily: '',
        fontWeight: '',
        anchor: 'invalid',
        opacity: 4,
      },
    })
    graph.addNode(text)
    graph.addLink(text.id, 'geometry', output.id, 'geometry')

    const [item] = evaluator.evaluate(graph).geometry.items

    expect(item.svg).toMatchObject({
      attrs: {
        'font-size': 0,
        'font-family': 'sans-serif',
        'font-weight': '400',
        'text-anchor': 'start',
      },
      text: '',
    })
    expect(item.style.opacity).toBe(1)
  })

  test('cycles are diagnosed instead of recursing indefinitely', () => {
    const { registry, evaluator, graph } = setup()
    const { output } = interfaceNodes(graph)
    graph.links = []
    const first = registry.createNode('transformGeometry', { id: 'first', graph })
    const second = registry.createNode('transformGeometry', { id: 'second', graph })
    graph.addNode(first)
    graph.addNode(second)
    graph.addLink(first.id, 'geometry', second.id, 'geometry', { id: 'first-second' })
    graph.addLink(second.id, 'geometry', first.id, 'geometry', { id: 'second-first' })
    graph.addLink(second.id, 'geometry', output.id, 'geometry', { id: 'second-output' })

    const validation = new GraphValidator(registry).validate(graph, { reachableOnly: true })
    const result = evaluator.evaluate(graph, { geometry: sourceGeometry() })

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics.some((item) => item.code === 'cycle')).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'cycle')).toBe(true)
  })
})
