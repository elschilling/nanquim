import GeometrySet2D, { cloneValue } from './GeometrySet2D.js'
import { createId } from './ids.js'
import {
  composeTransform,
  finiteNumber,
  multiplyMatrices,
  rotationMatrix,
  translationMatrix,
} from './matrix.js'

const SOCKET_TYPES = Object.freeze({
  ANY: 'any',
  BOOLEAN: 'boolean',
  COLOR: 'color',
  FLOAT: 'float',
  GEOMETRY: 'geometry',
  INTEGER: 'integer',
  STRING: 'string',
  VECTOR2: 'vector2',
})

function normaliseSocket(socket, index = 0) {
  const id = String(socket && (socket.id || socket.name) || `socket-${index}`)
  return {
    ...socket,
    id,
    name: String(socket && socket.name || id),
    type: String(socket && socket.type || SOCKET_TYPES.ANY),
    defaultValue: cloneValue(socket && (
      Object.prototype.hasOwnProperty.call(socket, 'defaultValue')
        ? socket.defaultValue
        : socket.default
    )),
    multi: Boolean(socket && socket.multi),
  }
}

function socketTypesCompatible(outputType, inputType) {
  if (outputType === SOCKET_TYPES.ANY || inputType === SOCKET_TYPES.ANY) return true
  if (outputType === inputType) return true
  return outputType === SOCKET_TYPES.INTEGER && inputType === SOCKET_TYPES.FLOAT
}

function vector2(value, fallback = { x: 0, y: 0 }) {
  if (Array.isArray(value)) {
    return {
      x: finiteNumber(value[0], finiteNumber(fallback.x)),
      y: finiteNumber(value[1], finiteNumber(fallback.y)),
    }
  }

  if (value && typeof value === 'object') {
    return {
      x: finiteNumber(value.x, finiteNumber(fallback.x)),
      y: finiteNumber(value.y, finiteNumber(fallback.y)),
    }
  }

  return {
    x: finiteNumber(fallback.x),
    y: finiteNumber(fallback.y),
  }
}

function geometry(value) {
  try {
    return GeometrySet2D.from(value)
  } catch (error) {
    return GeometrySet2D.empty()
  }
}

function interfaceSockets(graph, direction) {
  const graphInterface = graph && graph.interface && typeof graph.interface === 'object'
    ? graph.interface
    : {}
  const sockets = Array.isArray(graphInterface[direction]) ? graphInterface[direction] : []
  return sockets.map(normaliseSocket)
}

class NodeRegistry {
  constructor() {
    this.definitions = new Map()
  }

  register(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('Node definition must be an object')
    }
    if (!definition.type) throw new TypeError('Node definition requires a type')
    if (typeof definition.evaluate !== 'function') {
      throw new TypeError(`Node definition "${definition.type}" requires evaluate()`)
    }

    const type = String(definition.type)
    if (this.definitions.has(type)) {
      throw new Error(`Node type "${type}" is already registered`)
    }

    this.definitions.set(type, {
      category: 'Utilities',
      label: type,
      inputs: [],
      outputs: [],
      ...definition,
      type,
    })
    return this
  }

  unregister(type) {
    return this.definitions.delete(String(type))
  }

  has(type) {
    return this.definitions.has(String(type))
  }

  get(type) {
    return this.definitions.get(String(type)) || null
  }

  list() {
    return Array.from(this.definitions.values())
  }

  getInputs(nodeOrType, graph) {
    return this.#getSockets(nodeOrType, graph, 'inputs')
  }

  getOutputs(nodeOrType, graph) {
    return this.#getSockets(nodeOrType, graph, 'outputs')
  }

  createNode(type, options = {}) {
    const definition = this.get(type)
    if (!definition) throw new Error(`Unknown node type "${type}"`)

    const node = {
      id: String(options.id || createId('node')),
      type: definition.type,
      x: finiteNumber(options.x),
      y: finiteNumber(options.y),
      values: cloneValue(options.values || {}),
    }

    this.getInputs(node, options.graph).forEach(socket => {
      if (!Object.prototype.hasOwnProperty.call(node.values, socket.id)) {
        node.values[socket.id] = cloneValue(socket.defaultValue)
      }
    })

    return node
  }

  #getSockets(nodeOrType, graph, direction) {
    const node = typeof nodeOrType === 'string'
      ? { type: nodeOrType }
      : nodeOrType
    const definition = node && this.get(node.type)
    if (!definition) return []

    const source = typeof definition[direction] === 'function'
      ? definition[direction](node, graph)
      : definition[direction]
    return (Array.isArray(source) ? source : []).map(normaliseSocket)
  }
}

function socket(id, name, type, defaultValue, options = {}) {
  return { id, name, type, defaultValue, ...options }
}

function shapeItem(context, suffix, svg, style = {}) {
  return {
    id: context && typeof context.createItemId === 'function'
      ? context.createItemId(suffix)
      : createId('geometry'),
    svg,
    matrix: [1, 0, 0, 1, 0, 0],
    style,
  }
}

function registerInterfaceNodes(registry) {
  registry.register({
    type: 'groupInput',
    label: 'Group Input',
    category: 'Interface',
    hidden: true,
    outputs: (node, graph) => interfaceSockets(graph, 'inputs'),
    evaluate: ({ context }) => ({ ...context.graphInputs }),
  })

  registry.register({
    type: 'groupOutput',
    label: 'Group Output',
    category: 'Interface',
    hidden: true,
    inputs: (node, graph) => interfaceSockets(graph, 'outputs'),
    evaluate: ({ inputs }) => ({ ...inputs }),
  })
}

function registerValueNodes(registry) {
  registry.register({
    type: 'float',
    label: 'Float',
    category: 'Input',
    outputs: [socket('value', 'Value', SOCKET_TYPES.FLOAT, 0)],
    evaluate: ({ node }) => ({ value: finiteNumber(node.values.value) }),
  })

  registry.register({
    type: 'integer',
    label: 'Integer',
    category: 'Input',
    outputs: [socket('value', 'Value', SOCKET_TYPES.INTEGER, 0)],
    evaluate: ({ node }) => ({ value: Math.trunc(finiteNumber(node.values.value)) }),
  })

  registry.register({
    type: 'boolean',
    label: 'Boolean',
    category: 'Input',
    outputs: [socket('value', 'Value', SOCKET_TYPES.BOOLEAN, false)],
    evaluate: ({ node }) => ({ value: Boolean(node.values.value) }),
  })

  registry.register({
    type: 'vector2',
    label: 'Vector 2D',
    category: 'Input',
    inputs: [
      socket('x', 'X', SOCKET_TYPES.FLOAT, 0),
      socket('y', 'Y', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('vector', 'Vector', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 })],
    evaluate: ({ inputs }) => ({
      vector: { x: finiteNumber(inputs.x), y: finiteNumber(inputs.y) },
    }),
  })

  registry.register({
    type: 'color',
    label: 'Color',
    category: 'Input',
    outputs: [socket('value', 'Color', SOCKET_TYPES.COLOR, '#ffffff')],
    evaluate: ({ node }) => ({ value: cloneValue(node.values.value ?? '#ffffff') }),
  })
}

function evaluateMath(operation, a, b, context) {
  switch (operation) {
    case 'subtract': return a - b
    case 'multiply': return a * b
    case 'divide':
      if (b === 0) {
        context.warn('Division by zero produced 0', 'division-by-zero')
        return 0
      }
      return a / b
    case 'modulo':
      if (b === 0) {
        context.warn('Modulo by zero produced 0', 'division-by-zero')
        return 0
      }
      return a % b
    case 'power': return Math.pow(a, b)
    case 'minimum':
    case 'min': return Math.min(a, b)
    case 'maximum':
    case 'max': return Math.max(a, b)
    case 'absolute': return Math.abs(a)
    case 'squareRoot':
    case 'sqrt': return Math.sqrt(Math.max(0, a))
    case 'sine':
    case 'sin': return Math.sin(a)
    case 'cosine':
    case 'cos': return Math.cos(a)
    case 'tangent':
    case 'tan': return Math.tan(a)
    case 'add':
    default: return a + b
  }
}

function registerMathNodes(registry) {
  registry.register({
    type: 'math',
    label: 'Math',
    category: 'Utilities',
    options: [{
      id: 'operation',
      name: 'Operation',
      type: 'enum',
      defaultValue: 'add',
      options: [
        'add', 'subtract', 'multiply', 'divide', 'modulo', 'power',
        'minimum', 'maximum', 'absolute', 'squareRoot', 'sine',
        'cosine', 'tangent',
      ],
    }],
    inputs: [
      socket('a', 'A', SOCKET_TYPES.FLOAT, 0),
      socket('b', 'B', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('value', 'Value', SOCKET_TYPES.FLOAT, 0)],
    evaluate: ({ inputs, node, context }) => ({
      value: evaluateMath(
        String(node.values.operation || 'add'),
        finiteNumber(inputs.a),
        finiteNumber(inputs.b),
        context,
      ),
    }),
  })

  registry.register({
    type: 'vectorMath',
    label: 'Vector Math',
    category: 'Utilities',
    options: [{
      id: 'operation',
      name: 'Operation',
      type: 'enum',
      defaultValue: 'add',
      options: [
        'add', 'subtract', 'multiply', 'divide', 'scale', 'dot',
        'distance', 'length', 'normalize',
      ],
    }],
    inputs: [
      socket('a', 'A', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('b', 'B', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('scale', 'Scale', SOCKET_TYPES.FLOAT, 1),
    ],
    outputs: [
      socket('vector', 'Vector', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('value', 'Value', SOCKET_TYPES.FLOAT, 0),
    ],
    evaluate: ({ inputs, node, context }) => {
      const a = vector2(inputs.a)
      const b = vector2(inputs.b)
      const scale = finiteNumber(inputs.scale, 1)
      const operation = String(node.values.operation || 'add')
      let vector = { x: 0, y: 0 }
      let value = 0

      switch (operation) {
        case 'subtract':
          vector = { x: a.x - b.x, y: a.y - b.y }
          break
        case 'multiply':
          vector = { x: a.x * b.x, y: a.y * b.y }
          break
        case 'divide':
          if (b.x === 0 || b.y === 0) context.warn('Vector division by zero produced 0', 'division-by-zero')
          vector = { x: b.x === 0 ? 0 : a.x / b.x, y: b.y === 0 ? 0 : a.y / b.y }
          break
        case 'scale':
          vector = { x: a.x * scale, y: a.y * scale }
          break
        case 'dot':
          value = a.x * b.x + a.y * b.y
          break
        case 'distance':
          value = Math.hypot(a.x - b.x, a.y - b.y)
          break
        case 'length':
          value = Math.hypot(a.x, a.y)
          break
        case 'normalize': {
          const length = Math.hypot(a.x, a.y)
          vector = length === 0 ? { x: 0, y: 0 } : { x: a.x / length, y: a.y / length }
          break
        }
        case 'add':
        default:
          vector = { x: a.x + b.x, y: a.y + b.y }
      }

      return { vector, value }
    },
  })

  registry.register({
    type: 'combineXY',
    label: 'Combine XY',
    category: 'Utilities',
    inputs: [
      socket('x', 'X', SOCKET_TYPES.FLOAT, 0),
      socket('y', 'Y', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('vector', 'Vector', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 })],
    evaluate: ({ inputs }) => ({ vector: { x: finiteNumber(inputs.x), y: finiteNumber(inputs.y) } }),
  })

  registry.register({
    type: 'separateXY',
    label: 'Separate XY',
    category: 'Utilities',
    inputs: [socket('vector', 'Vector', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 })],
    outputs: [
      socket('x', 'X', SOCKET_TYPES.FLOAT, 0),
      socket('y', 'Y', SOCKET_TYPES.FLOAT, 0),
    ],
    evaluate: ({ inputs }) => {
      const value = vector2(inputs.vector)
      return { x: value.x, y: value.y }
    },
  })
}

function registerGeometryNodes(registry) {
  registry.register({
    type: 'joinGeometry',
    label: 'Join Geometry',
    category: 'Geometry',
    inputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null, { multi: true })],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs }) => {
      const values = Array.isArray(inputs.geometry) ? inputs.geometry : [inputs.geometry]
      return { geometry: GeometrySet2D.join(...values.filter(value => value !== null && value !== undefined)) }
    },
  })

  registry.register({
    type: 'transformGeometry',
    label: 'Transform Geometry',
    category: 'Geometry',
    inputs: [
      socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null),
      socket('translationX', 'Translation X', SOCKET_TYPES.FLOAT, 0),
      socket('translationY', 'Translation Y', SOCKET_TYPES.FLOAT, 0),
      socket('rotation', 'Rotation', SOCKET_TYPES.FLOAT, 0),
      socket('scaleX', 'Scale X', SOCKET_TYPES.FLOAT, 1),
      socket('scaleY', 'Scale Y', SOCKET_TYPES.FLOAT, 1),
      socket('pivotX', 'Pivot X', SOCKET_TYPES.FLOAT, 0),
      socket('pivotY', 'Pivot Y', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs }) => ({
      geometry: geometry(inputs.geometry).transformed(composeTransform({
        translationX: inputs.translationX,
        translationY: inputs.translationY,
        rotation: inputs.rotation,
        scaleX: inputs.scaleX,
        scaleY: inputs.scaleY,
        pivotX: inputs.pivotX,
        pivotY: inputs.pivotY,
      })),
    }),
  })

  registry.register({
    type: 'line',
    label: 'Line',
    category: 'Primitives',
    inputs: [
      socket('start', 'Start', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('end', 'End', SOCKET_TYPES.VECTOR2, { x: 100, y: 0 }),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs, context }) => {
      const start = vector2(inputs.start)
      const end = vector2(inputs.end, { x: 100, y: 0 })
      return {
        geometry: new GeometrySet2D([shapeItem(context, 'line', {
          tag: 'line',
          attrs: { x1: start.x, y1: start.y, x2: end.x, y2: end.y },
        }, { stroke: '#ffffff', fill: 'none', 'stroke-width': 1 })]),
      }
    },
  })

  registry.register({
    type: 'circle',
    label: 'Circle',
    category: 'Primitives',
    inputs: [
      socket('center', 'Center', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('radius', 'Radius', SOCKET_TYPES.FLOAT, 50),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs, context }) => {
      const center = vector2(inputs.center)
      const radius = Math.max(0, finiteNumber(inputs.radius, 50))
      return {
        geometry: new GeometrySet2D([shapeItem(context, 'circle', {
          tag: 'circle',
          attrs: { cx: center.x, cy: center.y, r: radius },
        }, { stroke: '#ffffff', fill: 'none', 'stroke-width': 1 })]),
      }
    },
  })

  registry.register({
    type: 'rectangle',
    label: 'Rectangle',
    category: 'Primitives',
    inputs: [
      socket('position', 'Position', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('size', 'Size', SOCKET_TYPES.VECTOR2, { x: 100, y: 100 }),
      socket('cornerRadius', 'Corner Radius', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs, context }) => {
      const position = vector2(inputs.position)
      const size = vector2(inputs.size, { x: 100, y: 100 })
      const width = Math.abs(size.x)
      const height = Math.abs(size.y)
      const radius = Math.max(0, Math.min(finiteNumber(inputs.cornerRadius), width / 2, height / 2))
      const attrs = {
        x: size.x < 0 ? position.x + size.x : position.x,
        y: size.y < 0 ? position.y + size.y : position.y,
        width,
        height,
      }
      if (radius > 0) Object.assign(attrs, { rx: radius, ry: radius })

      return {
        geometry: new GeometrySet2D([shapeItem(context, 'rectangle', {
          tag: 'rect',
          attrs,
        }, { stroke: '#ffffff', fill: 'none', 'stroke-width': 1 })]),
      }
    },
  })

  registry.register({
    type: 'text',
    label: 'Text',
    category: 'Primitives',
    inputs: [
      socket('text', 'Text', SOCKET_TYPES.STRING, 'Text'),
      socket('position', 'Position', SOCKET_TYPES.VECTOR2, { x: 0, y: 0 }),
      socket('fontSize', 'Font Size', SOCKET_TYPES.FLOAT, 24),
      socket('fontFamily', 'Font Family', SOCKET_TYPES.STRING, 'sans-serif'),
      socket('fontWeight', 'Font Weight', SOCKET_TYPES.STRING, '400', {
        options: ['normal', '400', '500', '600', '700', 'bold'],
      }),
      socket('anchor', 'Anchor', SOCKET_TYPES.STRING, 'start', {
        options: ['start', 'middle', 'end'],
      }),
      socket('fill', 'Fill', SOCKET_TYPES.COLOR, '#ffffff'),
      socket('opacity', 'Opacity', SOCKET_TYPES.FLOAT, 1),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs, context }) => {
      const position = vector2(inputs.position)
      const requestedAnchor = String(inputs.anchor ?? 'start')
      const anchor = ['start', 'middle', 'end'].includes(requestedAnchor)
        ? requestedAnchor
        : 'start'
      const fontFamily = String(inputs.fontFamily ?? '').trim() || 'sans-serif'
      const fontWeight = String(inputs.fontWeight ?? '').trim() || '400'

      return {
        geometry: new GeometrySet2D([shapeItem(context, 'text', {
          tag: 'text',
          attrs: {
            x: position.x,
            y: position.y,
            'font-size': Math.max(0, finiteNumber(inputs.fontSize, 24)),
            'font-family': fontFamily,
            'font-weight': fontWeight,
            'text-anchor': anchor,
          },
          text: String(inputs.text ?? ''),
        }, {
          fill: cloneValue(inputs.fill ?? '#ffffff'),
          opacity: Math.max(0, Math.min(1, finiteNumber(inputs.opacity, 1))),
        })]),
      }
    },
  })

  registry.register({
    type: 'linearArray',
    label: 'Linear Array',
    category: 'Geometry',
    inputs: [
      socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null),
      socket('count', 'Count', SOCKET_TYPES.INTEGER, 2),
      socket('offsetX', 'Offset X', SOCKET_TYPES.FLOAT, 100),
      socket('offsetY', 'Offset Y', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs, context }) => {
      const source = geometry(inputs.geometry)
      const requested = Math.max(0, Math.trunc(finiteNumber(inputs.count, 2)))
      const maxCopies = source.size === 0 ? 10000 : Math.max(1, Math.floor(10000 / source.size))
      const count = Math.min(requested, maxCopies)
      if (requested > count) context.warn('Linear Array output was limited to 10,000 SVG items', 'array-limit')
      const items = []

      for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
        const transform = translationMatrix(
          finiteNumber(inputs.offsetX, 100) * copyIndex,
          finiteNumber(inputs.offsetY) * copyIndex,
        )
        source.items.forEach((item, itemIndex) => {
          items.push({
            ...item,
            id: context.createItemId('linear', item.sourceId || item.id, itemIndex, copyIndex),
            matrix: multiplyMatrices(transform, item.matrix),
          })
        })
      }

      return { geometry: new GeometrySet2D(items) }
    },
  })

  registry.register({
    type: 'polarArray',
    label: 'Polar Array',
    category: 'Geometry',
    inputs: [
      socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null),
      socket('count', 'Count', SOCKET_TYPES.INTEGER, 6),
      socket('angle', 'Total Angle', SOCKET_TYPES.FLOAT, 360),
      socket('startAngle', 'Start Angle', SOCKET_TYPES.FLOAT, 0),
      socket('pivotX', 'Pivot X', SOCKET_TYPES.FLOAT, 0),
      socket('pivotY', 'Pivot Y', SOCKET_TYPES.FLOAT, 0),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs, context }) => {
      const source = geometry(inputs.geometry)
      const requested = Math.max(0, Math.trunc(finiteNumber(inputs.count, 6)))
      const maxCopies = source.size === 0 ? 10000 : Math.max(1, Math.floor(10000 / source.size))
      const count = Math.min(requested, maxCopies)
      if (requested > count) context.warn('Polar Array output was limited to 10,000 SVG items', 'array-limit')
      if (count === 0) return { geometry: GeometrySet2D.empty() }

      const totalAngle = finiteNumber(inputs.angle, 360)
      const startAngle = finiteNumber(inputs.startAngle)
      const pivotX = finiteNumber(inputs.pivotX)
      const pivotY = finiteNumber(inputs.pivotY)
      const angleStep = totalAngle / count
      const items = []

      for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
        let transform = translationMatrix(-pivotX, -pivotY)
        transform = multiplyMatrices(rotationMatrix(startAngle + angleStep * copyIndex), transform)
        transform = multiplyMatrices(translationMatrix(pivotX, pivotY), transform)

        source.items.forEach((item, itemIndex) => {
          items.push({
            ...item,
            id: context.createItemId('polar', item.sourceId || item.id, itemIndex, copyIndex),
            matrix: multiplyMatrices(transform, item.matrix),
          })
        })
      }

      return { geometry: new GeometrySet2D(items) }
    },
  })

  registry.register({
    type: 'setStyle',
    label: 'Set Style',
    category: 'Style',
    inputs: [
      socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null),
      socket('stroke', 'Stroke', SOCKET_TYPES.COLOR, '#ffffff'),
      socket('fill', 'Fill', SOCKET_TYPES.COLOR, 'none'),
      socket('strokeWidth', 'Stroke Width', SOCKET_TYPES.FLOAT, 1),
      socket('opacity', 'Opacity', SOCKET_TYPES.FLOAT, 1),
    ],
    outputs: [socket('geometry', 'Geometry', SOCKET_TYPES.GEOMETRY, null)],
    evaluate: ({ inputs }) => ({
      geometry: geometry(inputs.geometry).withStyle({
        stroke: cloneValue(inputs.stroke),
        fill: cloneValue(inputs.fill),
        'stroke-width': Math.max(0, finiteNumber(inputs.strokeWidth, 1)),
        opacity: Math.max(0, Math.min(1, finiteNumber(inputs.opacity, 1))),
      }),
    }),
  })
}

function createBuiltinRegistry() {
  const registry = new NodeRegistry()
  registerInterfaceNodes(registry)
  registerValueNodes(registry)
  registerMathNodes(registry)
  registerGeometryNodes(registry)
  return registry
}

const createDefaultRegistry = createBuiltinRegistry
const builtinRegistry = createBuiltinRegistry()
const registry = builtinRegistry

export {
  NodeRegistry,
  SOCKET_TYPES,
  builtinRegistry,
  createBuiltinRegistry,
  createDefaultRegistry,
  normaliseSocket,
  registry,
  socketTypesCompatible,
  vector2,
}

export default NodeRegistry
