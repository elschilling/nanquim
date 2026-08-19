const SVG_NS = 'http://www.w3.org/2000/svg'

const CATEGORY_COLORS = {
  geometry: '#27b997',
  input: '#4f75cf',
  output: '#c46b53',
  converter: '#54a9d3',
  utility: '#8a8a8a',
  style: '#b078c7',
  instance: '#d0924d',
  default: '#737373',
}

const SOCKET_COLORS = {
  geometry: '#20caa0',
  geometry2d: '#20caa0',
  boolean: '#b995c7',
  bool: '#b995c7',
  integer: '#4fa469',
  int: '#4fa469',
  float: '#98bb96',
  number: '#98bb96',
  string: '#d7c787',
  vec2: '#8585d6',
  vector2: '#8585d6',
  vector: '#8585d6',
  color: '#c5b83d',
  rgba: '#c5b83d',
  transform2d: '#d58855',
  transform: '#d58855',
  paint: '#d873a6',
  any: '#999',
}

function asArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (value instanceof Map) return Array.from(value.values())
  if (typeof value.values === 'function') {
    try { return Array.from(value.values()) } catch (_) { /* object fallback */ }
  }
  return typeof value === 'object' ? Object.values(value) : []
}

function idOf(value) {
  return value && (value.graphId ?? value.id ?? value.nodeId)
}

function socketId(socket, index) {
  return String(socket?.id ?? socket?.key ?? socket?.name ?? index)
}

function displayName(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function stopEvent(event) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * DOM-based Geometry Nodes editor for Nanquim.
 *
 * The manager remains the source of truth. This class only stores view state
 * (selection, pan and zoom) and asks the manager to perform graph mutations.
 */
class GeometryNodeEditor {
  constructor(editor) {
    this.editor = editor
    this.root = document.getElementById('geometry-nodes-dock')
    this.host = this.root?.closest('.geometry-nodes-host') || null
    this.stage = document.getElementById('geometry-nodes-stage')
    this.world = document.getElementById('geometry-nodes-world')
    this.nodesLayer = document.getElementById('geometry-nodes-nodes')
    this.wiresLayer = document.getElementById('geometry-nodes-wires')
    this.empty = document.getElementById('geometry-nodes-empty')
    this.status = document.getElementById('geometry-nodes-status')
    this.title = document.getElementById('geometry-nodes-title')
    this.addButton = document.getElementById('geometry-nodes-add')
    this.fitButton = document.getElementById('geometry-nodes-fit')
    this.closeButton = document.getElementById('geometry-nodes-close')
    this.collapseButton = document.getElementById('geometry-nodes-collapse')
    this.resizer = document.getElementById('geometry-nodes-resize')
    this.palette = document.getElementById('geometry-nodes-palette')
    this.paletteSearch = document.getElementById('geometry-nodes-search')
    this.paletteResults = document.getElementById('geometry-nodes-results')

    this.graphId = null
    this.selectedNodes = new Set()
    this.selectedLinks = new Set()
    this.socketElements = new Map()
    this.pan = { x: 80, y: 42 }
    this.zoom = 1
    this.spaceDown = false
    this.dragState = null
    this.panState = null
    this.resizeState = null
    this.connecting = null
    this.palettePoint = null
    this.paletteItems = []
    this.paletteIndex = 0
    this._statusTimer = null
    this._wireFrame = null

    if (!this.root || !this.stage || !this.nodesLayer || !this.wiresLayer) return

    this._bindToolbar()
    this._bindStage()
    this._bindKeyboard()
    this._bindSignals()
    this._bindCanvasFocus()
    this._restoreHeight()
    this._applyTransform()
    this.render()

    // Properties uses this stable reference to open the current modifier.
    editor.geometryNodeEditor = this
  }

  get manager() {
    return this.editor && this.editor.geometryNodes
  }

  get isOpen() {
    return Boolean(this.root && this.root.classList.contains('is-open'))
  }

  open(graphOrId = null) {
    if (!this.root) return
    const explicitId = typeof graphOrId === 'string' ? graphOrId : idOf(graphOrId)
    const active = this._activeInstance()
    this.graphId = explicitId || active?.graphId || this.graphId
    this.root.classList.add('is-open')
    this.root.classList.remove('is-collapsed')
    this.root.setAttribute('aria-hidden', 'false')
    this.host?.classList.add('is-geometry-nodes-open')
    this._setActiveEditor('geometry-nodes')
    this.render()
    requestAnimationFrame(() => {
      this.stage?.focus({ preventScroll: true })
      if (this._graph() && this.nodesLayer.children.length && !this._hasViewForGraph(this.graphId)) {
        this.fit()
      }
    })
  }

  close() {
    if (!this.root) return
    this._closePalette()
    this._cancelConnection()
    this.root.classList.remove('is-open', 'is-collapsed')
    this.root.setAttribute('aria-hidden', 'true')
    this.host?.classList.remove('is-geometry-nodes-open')
    this._setActiveEditor('canvas')
  }

  toggleCollapsed() {
    if (!this.root) return
    const collapsed = this.root.classList.toggle('is-collapsed')
    this.collapseButton?.setAttribute('title', collapsed ? 'Expand Geometry Nodes' : 'Collapse Geometry Nodes')
    if (!collapsed) requestAnimationFrame(() => this._scheduleWires())
  }

  render() {
    if (!this.root || !this.nodesLayer || !this.wiresLayer) return

    const active = this._activeInstance()
    if (!this.graphId && active?.graphId) this.graphId = active.graphId
    let graph = this._graph()
    if (!graph && active?.graphId) {
      this.graphId = active.graphId
      graph = this._graph()
    }

    this.nodesLayer.replaceChildren()
    this.wiresLayer.replaceChildren()
    this.socketElements.clear()

    if (!graph) {
      this.title.textContent = 'No active graph'
      this.empty.hidden = false
      this.addButton.disabled = true
      this.fitButton.disabled = true
      this._applyTransform()
      return
    }

    this.title.textContent = graph.name || 'Geometry Nodes'
    this.empty.hidden = true
    this.addButton.disabled = false
    this.fitButton.disabled = false

    const nodes = this._nodes(graph)
    const validIds = new Set(nodes.map((node) => String(node.id)))
    this.selectedNodes.forEach((id) => { if (!validIds.has(String(id))) this.selectedNodes.delete(id) })

    nodes.forEach((node) => this.nodesLayer.appendChild(this._renderNode(graph, node)))
    this._applyTransform()
    this._scheduleWires()
  }

  fit() {
    const graph = this._graph()
    const nodes = graph ? this._nodes(graph) : []
    if (!this.stage || !nodes.length) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    nodes.forEach((node) => {
      const element = this._nodeElement(node.id)
      const width = element?.offsetWidth || 218
      const height = element?.offsetHeight || 120
      const x = Number(node.x) || 0
      const y = Number(node.y) || 0
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + width)
      maxY = Math.max(maxY, y + height)
    })

    const rect = this.stage.getBoundingClientRect()
    const padding = 55
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    this.zoom = clamp(Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height), 0.25, 1.5)
    this.pan.x = (rect.width - width * this.zoom) / 2 - minX * this.zoom
    this.pan.y = (rect.height - height * this.zoom) / 2 - minY * this.zoom
    this._rememberView()
    this._applyTransform()
  }

  _bindToolbar() {
    this.closeButton?.addEventListener('click', () => this.close())
    this.collapseButton?.addEventListener('click', () => this.toggleCollapsed())
    this.fitButton?.addEventListener('click', () => this.fit())
    this.addButton?.addEventListener('click', (event) => {
      stopEvent(event)
      this.palettePoint = null
      this.palette.hidden ? this._openPalette() : this._closePalette()
    })

    this.paletteSearch?.addEventListener('input', () => this._renderPalette())
    this.paletteSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        stopEvent(event)
        this.paletteIndex = Math.min(this.paletteItems.length - 1, this.paletteIndex + 1)
        this._highlightPaletteItem()
      } else if (event.key === 'ArrowUp') {
        stopEvent(event)
        this.paletteIndex = Math.max(0, this.paletteIndex - 1)
        this._highlightPaletteItem()
      } else if (event.key === 'Enter') {
        stopEvent(event)
        const definition = this.paletteItems[this.paletteIndex]
        if (definition) this._addNode(definition.type)
      } else if (event.key === 'Escape') {
        stopEvent(event)
        this._closePalette()
        this.stage?.focus({ preventScroll: true })
      }
    })

    document.addEventListener('pointerdown', (event) => {
      if (!this.palette?.hidden && !this.palette.contains(event.target) && event.target !== this.addButton) this._closePalette()
    }, true)

    this.resizer?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.root.classList.contains('is-collapsed')) return
      stopEvent(event)
      this.resizeState = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: this.root.getBoundingClientRect().height,
      }
      this.resizer.classList.add('is-resizing')
      this.resizer.setPointerCapture?.(event.pointerId)
    })

    window.addEventListener('pointermove', (event) => {
      if (!this.resizeState || event.pointerId !== this.resizeState.pointerId) return
      const viewportHeight = this.root.parentElement?.getBoundingClientRect().height || window.innerHeight
      const max = Math.max(150, Math.min(viewportHeight * 0.75, viewportHeight - 145))
      const height = clamp(this.resizeState.startHeight + this.resizeState.startY - event.clientY, 150, max)
      this.root.style.setProperty('--gn-panel-height', `${height}px`)
      this._scheduleWires()
    })

    window.addEventListener('pointerup', (event) => {
      if (!this.resizeState || event.pointerId !== this.resizeState.pointerId) return
      const height = this.root.getBoundingClientRect().height
      this.resizeState = null
      this.resizer.classList.remove('is-resizing')
      try { localStorage.setItem('nanquim.geometryNodes.height', String(Math.round(height))) } catch (_) { /* storage is optional */ }
    })
  }

  _bindStage() {
    this.stage.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.gn-live-node')) return
      stopEvent(event)
      this.palettePoint = this._clientToWorld(event.clientX, event.clientY)
      this._openPalette()
    })

    this.stage.addEventListener('pointerdown', (event) => {
      this._setActiveEditor('geometry-nodes')
      if (event.target.closest('.gn-live-node') || event.target.closest('.gn-wire-hit')) return
      if (event.button !== 0 && event.button !== 1) return
      if (this.connecting) {
        this._cancelConnection()
        if (event.button === 0) return
      }
      stopEvent(event)
      this._closePalette()
      this.panState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panX: this.pan.x,
        panY: this.pan.y,
        moved: false,
      }
      this.stage.classList.add('is-panning')
      this.stage.setPointerCapture?.(event.pointerId)
    })

    this.stage.addEventListener('wheel', (event) => {
      stopEvent(event)
      this._setActiveEditor('geometry-nodes')
      const rect = this.stage.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      const worldX = (cx - this.pan.x) / this.zoom
      const worldY = (cy - this.pan.y) / this.zoom
      const factor = Math.exp(-event.deltaY * 0.0012)
      const next = clamp(this.zoom * factor, 0.2, 2.5)
      this.pan.x = cx - worldX * next
      this.pan.y = cy - worldY * next
      this.zoom = next
      this._rememberView()
      this._applyTransform()
    }, { passive: false })

    window.addEventListener('pointermove', (event) => {
      if (this.panState && event.pointerId === this.panState.pointerId) {
        const dx = event.clientX - this.panState.startX
        const dy = event.clientY - this.panState.startY
        if (Math.abs(dx) + Math.abs(dy) > 2) this.panState.moved = true
        this.pan.x = this.panState.panX + dx
        this.pan.y = this.panState.panY + dy
        this._applyTransform()
      }
      if (this.dragState && event.pointerId === this.dragState.pointerId) this._moveNodes(event)
      if (this.connecting) {
        this.connecting.cursor = this._clientToStage(event.clientX, event.clientY)
        if (Math.hypot(event.clientX - this.connecting.startClient.x, event.clientY - this.connecting.startClient.y) > 4) {
          this.connecting.moved = true
        }
        this._scheduleWires()
      }
    })

    window.addEventListener('pointerup', (event) => {
      if (this.panState && event.pointerId === this.panState.pointerId) {
        const moved = this.panState.moved
        this.panState = null
        this.stage.classList.remove('is-panning')
        this._rememberView()
        if (!moved && event.button === 0) {
          this.selectedNodes.clear()
          this.selectedLinks.clear()
          this._syncSelectionClasses()
          this._dispatchNodeSelection()
        }
      }
      if (this.dragState && event.pointerId === this.dragState.pointerId) this._finishNodeDrag(event)
      if (this.connecting && event.pointerId === this.connecting.pointerId) {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.gn-socket')
        if (target && target !== this.connecting.element) {
          this._completeConnection(target)
        } else if (this.connecting.moved) {
          this._cancelConnection()
        } else {
          // A click leaves the first socket armed; clicking a second socket
          // completes the link, matching Blender's click-or-drag interaction.
          this.connecting.pointerId = null
        }
      }
    })
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      const inside = this.root?.contains(event.target)
      const active = this.editor.activeEditor === 'geometry-nodes'
      if (!this.isOpen || (!inside && !active)) return

      if (event.key === ' ') this.spaceDown = true
      if (event.key === 'Escape') {
        if (this.connecting || !this.palette.hidden) {
          stopEvent(event)
          event.stopImmediatePropagation()
          this._cancelConnection()
          this._closePalette()
        }
        return
      }

      const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable
      if (editing) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        stopEvent(event)
        event.stopImmediatePropagation()
        if (event.shiftKey) this.editor.redo?.()
        else this.editor.undo?.()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        stopEvent(event)
        event.stopImmediatePropagation()
        this.editor.redo?.()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        stopEvent(event)
        event.stopImmediatePropagation()
        this._deleteSelection()
      } else if (
        event.key.toLowerCase() === 'a' &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat
      ) {
        stopEvent(event)
        event.stopImmediatePropagation()
        this.palettePoint = null
        this._openPalette()
      } else if (event.key === 'Home') {
        stopEvent(event)
        event.stopImmediatePropagation()
        this.fit()
      }
    }, true)

    document.addEventListener('keyup', (event) => {
      if (event.key === ' ') this.spaceDown = false
    }, true)
  }

  _bindSignals() {
    const listen = (name, callback) => {
      const signal = this.editor.signals?.[name]
      if (signal && typeof signal.add === 'function') signal.add(callback)
    }

    listen('nodeGraphChanged', (graphId) => {
      if (!graphId || String(graphId) === String(this.graphId)) this.render()
    })
    listen('activeNodeGraphChanged', (instanceOrGraphId) => {
      const active = this._activeInstance()
      const incoming = typeof instanceOrGraphId === 'string'
        ? instanceOrGraphId
        : instanceOrGraphId?.graphId
      this.graphId = active?.graphId || incoming || null
      this.selectedNodes.clear()
      this.selectedLinks.clear()
      this._loadRememberedView()
      this.render()
    })
    listen('nodeEvaluationFailed', (...args) => {
      const error = args.find((arg) => arg instanceof Error || typeof arg === 'string' || arg?.error)
      if (error) this._showStatus(error.message || error.error || String(error), true)
      this.render()
    })
    listen('nodeEvaluationCompleted', () => this.render())
    listen('geometryNodesChanged', () => this.render())
  }

  _bindCanvasFocus() {
    const canvasEditor = document.querySelector('.canvas-editor')
    canvasEditor?.addEventListener('pointerdown', () => this._setActiveEditor('canvas'), true)
  }

  _setActiveEditor(value) {
    if (!this.editor || this.editor.activeEditor === value) return
    if (value === 'geometry-nodes') {
      // Active CAD commands own global capture listeners. Cancel them before
      // transferring focus so right-click and keyboard input belong to the
      // graph editor rather than the canvas command state machine.
      this.editor.signals?.commandCancelled?.dispatch()
    }
    this.editor.activeEditor = value
    this.editor.signals?.activeEditorChanged?.dispatch(value)
  }

  _activeInstance() {
    const manager = this.manager
    if (!manager) return null
    try {
      return typeof manager.getActiveInstance === 'function'
        ? manager.getActiveInstance()
        : manager.activeInstance || null
    } catch (_) {
      return null
    }
  }

  _graph() {
    const manager = this.manager
    if (!manager || !this.graphId) return null
    try {
      if (typeof manager.getGraph === 'function') return manager.getGraph(this.graphId) || null
      if (manager.graphs instanceof Map) return manager.graphs.get(this.graphId) || null
      return asArray(manager.graphs).find((graph) => String(graph.id) === String(this.graphId)) || null
    } catch (_) {
      return null
    }
  }

  _nodes(graph) {
    return asArray(graph?.nodes)
  }

  _links(graph) {
    return asArray(graph?.links)
  }

  _definition(node) {
    const registry = this.manager?.registry
    if (!registry) return null
    try {
      return typeof registry.get === 'function'
        ? registry.get(node.type)
        : asArray(registry.definitions || registry).find((definition) => definition.type === node.type)
    } catch (_) {
      return null
    }
  }

  _sockets(graph, node, direction) {
    const registry = this.manager?.registry
    const definition = this._definition(node)
    try {
      if (direction === 'input' && typeof registry?.getInputs === 'function') return asArray(registry.getInputs(node, graph))
      if (direction === 'output' && typeof registry?.getOutputs === 'function') return asArray(registry.getOutputs(node, graph))
    } catch (_) { /* fall back to the static schema */ }
    return asArray(direction === 'input' ? definition?.inputs : definition?.outputs)
  }

  _renderNode(graph, node) {
    const definition = this._definition(node)
    const element = document.createElement('section')
    element.className = 'gn-live-node'
    element.dataset.nodeId = node.id
    element.style.transform = `translate(${Number(node.x) || 0}px, ${Number(node.y) || 0}px)`
    element.style.setProperty('--gn-node-accent', this._categoryColor(definition?.category))
    if (this.selectedNodes.has(String(node.id))) element.classList.add('is-selected')
    if (node.error || node.diagnostic?.severity === 'error') element.classList.add('has-error')

    const header = document.createElement('header')
    header.className = 'gn-live-node-header'
    const dot = document.createElement('span')
    dot.className = 'gn-node-category-dot'
    const label = document.createElement('span')
    label.className = 'gn-node-title'
    label.textContent = definition?.label || definition?.name || displayName(node.type) || 'Unknown Node'
    header.append(dot, label)
    if (!definition) {
      const warning = document.createElement('span')
      warning.className = 'gn-node-warning'
      warning.title = `Missing node type: ${node.type}`
      warning.textContent = '⚠'
      header.appendChild(warning)
    }
    element.appendChild(header)

    const body = document.createElement('div')
    body.className = 'gn-node-body'
    this._sockets(graph, node, 'output').forEach((socket, index) => {
      body.appendChild(this._renderSocketRow(graph, node, socket, index, 'output'))
    })
    asArray(definition?.options).forEach((option, index) => {
      body.appendChild(this._renderNodeOption(node, option, index))
    })
    this._sockets(graph, node, 'input').forEach((socket, index) => {
      body.appendChild(this._renderSocketRow(graph, node, socket, index, 'input'))
    })
    if (!body.children.length) {
      const row = document.createElement('div')
      row.className = 'gn-socket-row'
      const text = document.createElement('span')
      text.className = 'gn-socket-label'
      text.textContent = definition ? 'No sockets' : `Unknown: ${node.type}`
      row.appendChild(text)
      body.appendChild(row)
    }
    element.appendChild(body)

    element.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.gn-socket, .gn-node-input')) return
      this._selectNode(node.id, event.shiftKey || event.ctrlKey || event.metaKey)
    })
    header.addEventListener('pointerdown', (event) => this._startNodeDrag(event, node.id))
    return element
  }

  _renderSocketRow(graph, node, socket, index, direction) {
    const id = socketId(socket, index)
    const row = document.createElement('div')
    row.className = `gn-socket-row${direction === 'output' ? ' is-output' : ''}`

    const socketElement = document.createElement('span')
    socketElement.className = `gn-socket${direction === 'output' ? ' is-output' : ''}`
    socketElement.dataset.nodeId = node.id
    socketElement.dataset.socketId = id
    socketElement.dataset.direction = direction
    socketElement.dataset.socketType = socket.type || 'any'
    socketElement.title = `${socket.name || displayName(id)} · ${displayName(socket.type || 'any')}`
    socketElement.style.setProperty('--gn-socket-color', this._socketColor(socket.type))
    if (this._isSocketLinked(graph, node.id, id, direction)) socketElement.classList.add('is-linked')
    socketElement.addEventListener('pointerdown', (event) => this._startConnection(event, socketElement))
    socketElement.addEventListener('click', stopEvent)

    const label = document.createElement('span')
    label.className = 'gn-socket-label'
    label.textContent = socket.name || displayName(id)

    if (direction === 'output') {
      const hasNoInputs = this._sockets(graph, node, 'input').length === 0
      const editableConstant = hasNoInputs && socket.defaultValue !== null && socket.defaultValue !== undefined
      if (editableConstant) {
        const control = this._createValueControl(node, socket, id)
        if (control) row.appendChild(control)
      }
      row.append(label, socketElement)
    } else {
      row.append(socketElement, label)
      if (!this._isSocketLinked(graph, node.id, id, direction) && socket.hideValue !== true) {
        const control = this._createValueControl(node, socket, id)
        if (control) row.appendChild(control)
      }
    }

    this.socketElements.set(this._socketKey(node.id, id, direction), socketElement)
    return row
  }

  _renderNodeOption(node, option, index) {
    const id = socketId(option, index)
    const row = document.createElement('div')
    row.className = 'gn-socket-row gn-node-option-row'
    const label = document.createElement('span')
    label.className = 'gn-socket-label'
    label.textContent = option.name || displayName(id)
    row.appendChild(label)
    const control = this._createValueControl(node, option, id)
    if (control) row.appendChild(control)
    return row
  }

  _createValueControl(node, socket, id) {
    const value = this._nodeValue(node, id, socket.defaultValue)
    const type = String(socket.type || '').toLowerCase()

    if (type === 'geometry' || type === 'geometry2d') return null

    if (socket.options || socket.enum) {
      const select = document.createElement('select')
      select.className = 'gn-node-input'
      asArray(socket.options || socket.enum).forEach((option) => {
        const element = document.createElement('option')
        const optionValue = typeof option === 'object' ? (option.value ?? option.id) : option
        element.value = optionValue
        element.textContent = typeof option === 'object' ? (option.label || option.name || optionValue) : option
        element.selected = String(optionValue) === String(value)
        select.appendChild(element)
      })
      this._bindValueControl(select, node.id, id, () => select.value)
      return select
    }

    if (type === 'boolean' || type === 'bool') {
      const input = document.createElement('input')
      input.className = 'gn-node-input'
      input.type = 'checkbox'
      input.checked = Boolean(value)
      this._bindValueControl(input, node.id, id, () => input.checked)
      return input
    }

    if (type === 'vec2' || type === 'vector2' || type === 'vector') {
      const wrapper = document.createElement('span')
      wrapper.className = 'gn-vector-inputs'
      const vector = Array.isArray(value)
        ? value
        : [value?.x ?? 0, value?.y ?? 0]
      const controls = [0, 1].map((component) => {
        const input = document.createElement('input')
        input.className = 'gn-node-input'
        input.type = 'number'
        input.step = 'any'
        input.value = Number(vector[component]) || 0
        wrapper.appendChild(input)
        return input
      })
      const commit = () => this._setNodeValue(node.id, id, controls.map((input) => Number(input.value) || 0))
      controls.forEach((input) => {
        input.addEventListener('pointerdown', (event) => event.stopPropagation())
        input.addEventListener('change', commit)
        input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { commit(); input.blur() } })
      })
      return wrapper
    }

    const input = document.createElement('input')
    input.className = 'gn-node-input'
    if (type === 'color' || type === 'rgba') {
      input.type = 'color'
      input.value = this._toHex(value)
    } else if (['float', 'number', 'integer', 'int'].includes(type)) {
      input.type = 'number'
      input.step = type === 'integer' || type === 'int' ? '1' : 'any'
      input.value = Number(value ?? 0)
    } else {
      input.type = 'text'
      input.value = value ?? ''
    }

    this._bindValueControl(input, node.id, id, () => {
      if (input.type === 'number') return Number(input.value)
      return input.value
    })
    return input
  }

  _bindValueControl(control, nodeId, socketIdValue, getValue) {
    control.addEventListener('pointerdown', (event) => event.stopPropagation())
    control.addEventListener('change', () => this._setNodeValue(nodeId, socketIdValue, getValue()))
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this._setNodeValue(nodeId, socketIdValue, getValue())
        control.blur()
      }
    })
  }

  _nodeValue(node, id, fallback) {
    if (node.values instanceof Map) return node.values.has(id) ? node.values.get(id) : fallback
    if (node.values && Object.prototype.hasOwnProperty.call(node.values, id)) return node.values[id]
    return fallback
  }

  _setNodeValue(nodeId, socketIdValue, value) {
    const graph = this._graph()
    const manager = this.manager
    if (!graph || typeof manager?.setNodeValue !== 'function') return
    try {
      const result = manager.setNodeValue(graph.id, nodeId, socketIdValue, value)
      if (result?.catch) result.catch((error) => this._showStatus(error.message, true))
    } catch (error) {
      this._showStatus(error.message, true)
    }
  }

  _startNodeDrag(event, nodeId) {
    if (event.button !== 0) return
    stopEvent(event)
    this._setActiveEditor('geometry-nodes')
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    if (!this.selectedNodes.has(String(nodeId))) this._selectNode(nodeId, additive)
    const graph = this._graph()
    if (!graph) return
    const selected = this._nodes(graph).filter((node) => this.selectedNodes.has(String(node.id)))
    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      positions: selected.map((node) => ({ id: node.id, x: Number(node.x) || 0, y: Number(node.y) || 0 })),
      latest: new Map(),
      wireTarget: null,
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  _moveNodes(event) {
    const dx = (event.clientX - this.dragState.startX) / this.zoom
    const dy = (event.clientY - this.dragState.startY) / this.zoom
    if (Math.hypot(event.clientX - this.dragState.startX, event.clientY - this.dragState.startY) > 2) {
      this.dragState.moved = true
    }
    this.dragState.positions.forEach((position) => {
      const x = position.x + dx
      const y = position.y + dy
      this.dragState.latest.set(String(position.id), { x, y })
      const element = this._nodeElement(position.id)
      if (element) element.style.transform = `translate(${x}px, ${y}px)`
    })
    this._updateWireDropTarget()
    this._scheduleWires()
  }

  _updateWireDropTarget() {
    const state = this.dragState
    if (!state || state.positions.length !== 1) return
    const nodeId = state.positions[0].id
    const nodeElement = this._nodeElement(nodeId)
    if (!nodeElement) return

    const previousId = state.wireTarget?.linkId || null
    this._clearWireInsertionPreview()
    state.wireTarget = this._findWireDropTarget(nodeId, nodeElement.getBoundingClientRect())
    const nextId = state.wireTarget?.linkId || null
    nodeElement.classList.toggle('is-wire-insert-target', Boolean(nextId))

    if (state.wireTarget) {
      this.socketElements
        .get(this._socketKey(nodeId, state.wireTarget.inputSocket.id, 'input'))
        ?.classList.add('is-insert-input')
      this.socketElements
        .get(this._socketKey(nodeId, state.wireTarget.outputSocket.id, 'output'))
        ?.classList.add('is-insert-output')
    }

    if (nextId && nextId !== previousId) {
      const inputName = state.wireTarget.inputSocket?.name || displayName(state.wireTarget.inputSocket?.id)
      const outputName = state.wireTarget.outputSocket?.name || displayName(state.wireTarget.outputSocket?.id)
      this._showStatus(`Drop to insert via ${inputName} → ${outputName}`)
    } else if (previousId && !nextId) {
      this._showStatus('')
    }
  }

  _clearWireInsertionPreview() {
    this.nodesLayer.querySelectorAll('.is-wire-insert-target').forEach((element) => {
      element.classList.remove('is-wire-insert-target')
    })
    this.nodesLayer.querySelectorAll('.gn-socket.is-insert-input, .gn-socket.is-insert-output').forEach((element) => {
      element.classList.remove('is-insert-input', 'is-insert-output')
    })
  }

  _findWireDropTarget(nodeId, nodeRect) {
    const graph = this._graph()
    if (!graph || !nodeRect || nodeRect.width <= 0 || nodeRect.height <= 0) return null
    let best = null

    this.wiresLayer.querySelectorAll('.gn-wire-hit[data-link-id]').forEach((path) => {
      const linkId = path.dataset.linkId
      const plan = this._planWireInsertion(graph, nodeId, linkId)
      if (!plan) return
      const score = this._wireIntersectionScore(path, nodeRect)
      if (score === null || (best && score >= best.score)) return
      best = { ...plan, linkId, score }
    })

    return best
  }

  _planWireInsertion(graph, nodeId, linkId) {
    const manager = this.manager
    if (typeof manager?.getLinkInsertionPlan === 'function') {
      try {
        return manager.getLinkInsertionPlan(graph.id, nodeId, linkId)
      } catch (_) {
        return null
      }
    }

    const link = this._links(graph).find((candidate) => String(candidate.id) === String(linkId))
    const node = this._nodes(graph).find((candidate) => String(candidate.id) === String(nodeId))
    if (!link || !node || node.type === 'groupInput' || node.type === 'groupOutput') return null
    if (String(link.fromNode) === String(nodeId) || String(link.toNode) === String(nodeId)) return null
    if (this._links(graph).some((candidate) => (
      String(candidate.fromNode) === String(nodeId) || String(candidate.toNode) === String(nodeId)
    ))) return null

    const sourceNode = this._nodes(graph).find((candidate) => String(candidate.id) === String(link.fromNode))
    const targetNode = this._nodes(graph).find((candidate) => String(candidate.id) === String(link.toNode))
    const sourceSocket = sourceNode && this._sockets(graph, sourceNode, 'output')
      .find((socket, index) => socketId(socket, index) === String(link.fromSocket))
    const targetSocket = targetNode && this._sockets(graph, targetNode, 'input')
      .find((socket, index) => socketId(socket, index) === String(link.toSocket))
    if (!sourceSocket || !targetSocket) return null

    const inputs = this._sockets(graph, node, 'input')
      .filter((socket) => this._typesCompatible(sourceSocket.type, socket.type))
    const outputs = this._sockets(graph, node, 'output')
      .filter((socket) => this._typesCompatible(socket.type, targetSocket.type))
    if (!inputs.length || !outputs.length) return null

    const rank = (socket, expectedType) => {
      const id = String(socket.id || '').toLowerCase()
      const type = String(socket.type || 'any').toLowerCase()
      const expected = String(expectedType || 'any').toLowerCase()
      return (id === 'geometry' ? -20 : 0) + (type === expected ? -10 : 0) + (type === 'any' ? 10 : 0)
    }
    inputs.sort((a, b) => rank(a, sourceSocket.type) - rank(b, sourceSocket.type))
    outputs.sort((a, b) => rank(a, targetSocket.type) - rank(b, targetSocket.type))
    return { link, inputSocket: inputs[0], outputSocket: outputs[0] }
  }

  _wireIntersectionScore(path, rect) {
    const padding = 6
    const left = rect.left - padding
    const right = rect.right + padding
    const top = rect.top - padding
    const bottom = rect.bottom + padding
    const centerX = (rect.left + rect.right) / 2
    const centerY = (rect.top + rect.bottom) / 2

    try {
      const bounds = path.getBoundingClientRect()
      if (bounds.right < left || bounds.left > right || bounds.bottom < top || bounds.top > bottom) return null
      const length = path.getTotalLength()
      const matrix = path.getScreenCTM()
      if (!Number.isFinite(length) || length <= 0 || !matrix) return null
      const steps = Math.min(192, Math.max(12, Math.ceil(length / 8)))
      let closest = null
      for (let index = 0; index <= steps; index += 1) {
        const point = path.getPointAtLength(length * index / steps)
        const x = matrix.a * point.x + matrix.c * point.y + matrix.e
        const y = matrix.b * point.x + matrix.d * point.y + matrix.f
        if (x < left || x > right || y < top || y > bottom) continue
        const distance = (x - centerX) ** 2 + (y - centerY) ** 2
        if (closest === null || distance < closest) closest = distance
      }
      return closest
    } catch (_) {
      const bounds = path.getBoundingClientRect?.()
      if (!bounds || bounds.right < left || bounds.left > right || bounds.bottom < top || bounds.top > bottom) return null
      return (bounds.left + bounds.width / 2 - centerX) ** 2 + (bounds.top + bounds.height / 2 - centerY) ** 2
    }
  }

  _finishNodeDrag(event) {
    // Pointer-up can carry a final position for which the browser did not emit
    // a pointer-move. Apply it before hit testing so the visible drop and the
    // committed node position always agree.
    if (event) this._moveNodes(event)
    else this._updateWireDropTarget()
    const state = this.dragState
    this.dragState = null
    this._clearWireInsertionPreview()
    const graph = this._graph()
    const manager = this.manager
    if (!graph || typeof manager?.setNodePosition !== 'function') return
    const allPositions = state.positions.map((position) => {
      const next = state.latest.get(String(position.id)) || position
      return { id: position.id, x: next.x, y: next.y }
    })

    if (state.moved && state.wireTarget && allPositions.length === 1 && typeof manager.insertNodeOnLink === 'function') {
      try {
        const position = allPositions[0]
        const inserted = manager.insertNodeOnLink(
          graph.id,
          position.id,
          state.wireTarget.linkId,
          { x: position.x, y: position.y },
        )
        if (inserted) {
          this.selectedLinks.clear()
          this._dispatchNodeSelection()
          this._showStatus('Node inserted into connection.')
          return
        }
      } catch (error) {
        this._showStatus(error.message, true)
      }
    }

    const positions = allPositions.filter((position, index) => (
      position.x !== state.positions[index].x || position.y !== state.positions[index].y
    ))
    if (positions.length === 0) return

    if (typeof manager.setNodePositions === 'function') {
      try {
        const result = manager.setNodePositions(graph.id, positions)
        if (result?.catch) result.catch((error) => this._showStatus(error.message, true))
      } catch (error) {
        this._showStatus(error.message, true)
      }
      return
    }
    positions.forEach((position) => {
      try {
        manager.setNodePosition(graph.id, position.id, position.x, position.y)
      } catch (error) {
        this._showStatus(error.message, true)
      }
    })
  }

  _selectNode(nodeId, additive = false) {
    const id = String(nodeId)
    if (!additive) {
      this.selectedNodes.clear()
      this.selectedLinks.clear()
      this.selectedNodes.add(id)
    } else if (this.selectedNodes.has(id)) {
      this.selectedNodes.delete(id)
    } else {
      this.selectedNodes.add(id)
    }
    this._syncSelectionClasses()
    this._dispatchNodeSelection()
  }

  _selectLink(linkId, additive = false) {
    const id = String(linkId)
    if (!additive) {
      this.selectedNodes.clear()
      this.selectedLinks.clear()
      this.selectedLinks.add(id)
    } else if (this.selectedLinks.has(id)) {
      this.selectedLinks.delete(id)
    } else {
      this.selectedLinks.add(id)
    }
    this._syncSelectionClasses()
    this._scheduleWires()
    this._dispatchNodeSelection()
  }

  _syncSelectionClasses() {
    this.nodesLayer.querySelectorAll('.gn-live-node').forEach((element) => {
      element.classList.toggle('is-selected', this.selectedNodes.has(String(element.dataset.nodeId)))
    })
  }

  _dispatchNodeSelection() {
    this.editor.signals?.nodeSelectionChanged?.dispatch({
      graphId: this.graphId,
      nodes: Array.from(this.selectedNodes),
      links: Array.from(this.selectedLinks),
    })
  }

  _deleteSelection() {
    const graph = this._graph()
    const manager = this.manager
    if (!graph || !manager) return
    const nodeIds = Array.from(this.selectedNodes)
    const linkIds = Array.from(this.selectedLinks)
    this.selectedNodes.clear()
    this.selectedLinks.clear()
    try {
      if (typeof manager.deleteSelection === 'function') {
        manager.deleteSelection(graph.id, nodeIds, linkIds)
      } else {
        if (nodeIds.length && typeof manager.removeNodes === 'function') manager.removeNodes(graph.id, nodeIds)
        if (typeof manager.removeLink === 'function') linkIds.forEach((id) => manager.removeLink(graph.id, id))
      }
    } catch (error) {
      this._showStatus(error.message, true)
    }
    this.render()
  }

  _startConnection(event, element) {
    if (event.button !== 0) return
    stopEvent(event)
    event.stopImmediatePropagation()
    this._setActiveEditor('geometry-nodes')
    if (this.connecting) {
      if (this.connecting.element === element) {
        this._cancelConnection()
      } else {
        this._completeConnection(element)
      }
      return
    }

    this.connecting = {
      element,
      nodeId: element.dataset.nodeId,
      socketId: element.dataset.socketId,
      direction: element.dataset.direction,
      type: element.dataset.socketType,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      cursor: this._clientToStage(event.clientX, event.clientY),
      moved: false,
    }
    element.classList.add('is-connecting')
    element.setPointerCapture?.(event.pointerId)
    this._scheduleWires()
  }

  _completeConnection(target) {
    const source = this.connecting
    if (!source) return
    const targetData = {
      nodeId: target.dataset.nodeId,
      socketId: target.dataset.socketId,
      direction: target.dataset.direction,
      type: target.dataset.socketType,
    }
    if (source.direction === targetData.direction) {
      this._showStatus('Connect an output socket to an input socket.', true)
      this._cancelConnection()
      return
    }
    const from = source.direction === 'output' ? source : targetData
    const to = source.direction === 'input' ? source : targetData
    if (!this._typesCompatible(from.type, to.type)) {
      this._showStatus(`Socket types do not match: ${displayName(from.type)} → ${displayName(to.type)}`, true)
      this._cancelConnection()
      return
    }
    const graph = this._graph()
    const manager = this.manager
    this._cancelConnection()
    if (!graph || typeof manager?.connect !== 'function') return
    try {
      const result = manager.connect(graph.id, from.nodeId, from.socketId, to.nodeId, to.socketId)
      if (result?.catch) result.catch((error) => this._showStatus(error.message, true))
    } catch (error) {
      this._showStatus(error.message, true)
    }
  }

  _cancelConnection() {
    this.connecting?.element?.classList.remove('is-connecting')
    this.connecting = null
    this._scheduleWires()
  }

  _typesCompatible(a, b) {
    const left = String(a || 'any').toLowerCase()
    const right = String(b || 'any').toLowerCase()
    if (left === 'any' || right === 'any' || left === right) return true
    const aliases = {
      geometry2d: 'geometry',
      bool: 'boolean',
      int: 'integer',
      number: 'float',
      vector2: 'vec2',
      vector: 'vec2',
      rgba: 'color',
      transform: 'transform2d',
    }
    const normalizedLeft = aliases[left] || left
    const normalizedRight = aliases[right] || right
    return normalizedLeft === normalizedRight || (normalizedLeft === 'integer' && normalizedRight === 'float')
  }

  _scheduleWires() {
    if (this._wireFrame) cancelAnimationFrame(this._wireFrame)
    this._wireFrame = requestAnimationFrame(() => {
      this._wireFrame = null
      this._drawWires()
    })
  }

  _drawWires() {
    const graph = this._graph()
    if (!graph || !this.isOpen || this.root.classList.contains('is-collapsed')) return
    this.wiresLayer.replaceChildren()

    this._links(graph).forEach((link) => {
      const from = this.socketElements.get(this._socketKey(link.fromNode, link.fromSocket, 'output'))
      const to = this.socketElements.get(this._socketKey(link.toNode, link.toSocket, 'input'))
      if (!from || !to) return
      const start = this._socketPosition(from)
      const end = this._socketPosition(to)
      const d = this._wirePath(start, end)
      const color = this._socketColor(from.dataset.socketType)
      const isDropTarget = String(this.dragState?.wireTarget?.linkId) === String(link.id)

      const visible = document.createElementNS(SVG_NS, 'path')
      visible.setAttribute('d', d)
      visible.setAttribute('class', `gn-wire${this.selectedLinks.has(String(link.id)) ? ' is-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}`)
      visible.style.setProperty('--gn-wire-color', color)

      const hit = document.createElementNS(SVG_NS, 'path')
      hit.setAttribute('d', d)
      hit.setAttribute('class', `gn-wire-hit${isDropTarget ? ' is-drop-target' : ''}`)
      hit.dataset.linkId = link.id
      hit.addEventListener('pointerdown', (event) => {
        stopEvent(event)
        this._setActiveEditor('geometry-nodes')
        this._selectLink(link.id, event.shiftKey || event.ctrlKey || event.metaKey)
      })
      hit.addEventListener('dblclick', (event) => {
        stopEvent(event)
        try { this.manager?.removeLink?.(graph.id, link.id) } catch (error) { this._showStatus(error.message, true) }
      })
      this.wiresLayer.append(visible, hit)
    })

    if (this.connecting) {
      const fixed = this._socketPosition(this.connecting.element)
      const start = this.connecting.direction === 'output' ? fixed : this.connecting.cursor
      const end = this.connecting.direction === 'output' ? this.connecting.cursor : fixed
      const preview = document.createElementNS(SVG_NS, 'path')
      preview.setAttribute('d', this._wirePath(start, end))
      preview.setAttribute('class', 'gn-wire-preview')
      this.wiresLayer.appendChild(preview)
    }
  }

  _wirePath(start, end) {
    const curve = Math.max(38, Math.abs(end.x - start.x) * 0.48)
    return `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`
  }

  _socketPosition(element) {
    const rect = element.getBoundingClientRect()
    const stage = this.stage.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2 - stage.left,
      y: rect.top + rect.height / 2 - stage.top,
    }
  }

  _isSocketLinked(graph, nodeId, id, direction) {
    return this._links(graph).some((link) => direction === 'input'
      ? String(link.toNode) === String(nodeId) && String(link.toSocket) === String(id)
      : String(link.fromNode) === String(nodeId) && String(link.fromSocket) === String(id))
  }

  _socketKey(nodeId, id, direction) {
    return `${direction}:${String(nodeId)}:${String(id)}`
  }

  _nodeElement(nodeId) {
    return Array.from(this.nodesLayer.children).find((element) => String(element.dataset.nodeId) === String(nodeId)) || null
  }

  _clientToWorld(clientX, clientY) {
    const rect = this.stage.getBoundingClientRect()
    return {
      x: (clientX - rect.left - this.pan.x) / this.zoom,
      y: (clientY - rect.top - this.pan.y) / this.zoom,
    }
  }

  _clientToStage(clientX, clientY) {
    const rect = this.stage.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  _applyTransform() {
    if (!this.world || !this.stage) return
    this.world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`
    this.stage.style.setProperty('--gn-grid-size', `${24 * this.zoom}px`)
    this.stage.style.setProperty('--gn-grid-x', `${this.pan.x % (24 * this.zoom)}px`)
    this.stage.style.setProperty('--gn-grid-y', `${this.pan.y % (24 * this.zoom)}px`)
    this._scheduleWires()
  }

  _openPalette() {
    if (!this._graph() || !this.palette) return
    this.palette.hidden = false
    this.addButton.setAttribute('aria-expanded', 'true')
    this.paletteSearch.value = ''
    this.paletteIndex = 0
    this._renderPalette()
    requestAnimationFrame(() => this.paletteSearch.focus())
  }

  _closePalette() {
    if (!this.palette) return
    this.palette.hidden = true
    this.addButton?.setAttribute('aria-expanded', 'false')
  }

  _registryDefinitions() {
    const registry = this.manager?.registry
    if (!registry) return []
    let definitions = []
    try {
      definitions = typeof registry.list === 'function' ? asArray(registry.list()) : asArray(registry.definitions || registry)
    } catch (_) { return [] }
    return definitions
      .map((definition) => typeof definition === 'string' ? registry.get?.(definition) : definition)
      .filter((definition) => definition?.type && definition.hidden !== true)
  }

  _renderPalette() {
    if (!this.paletteResults) return
    const query = this.paletteSearch.value.trim().toLowerCase()
    this.paletteItems = this._registryDefinitions()
      .filter((definition) => !query || `${definition.label || definition.name || ''} ${definition.type} ${definition.category || ''}`.toLowerCase().includes(query))
      .sort((a, b) => `${a.category || ''}\0${a.label || a.type}`.localeCompare(`${b.category || ''}\0${b.label || b.type}`))
    this.paletteIndex = clamp(this.paletteIndex, 0, Math.max(0, this.paletteItems.length - 1))
    this.paletteResults.replaceChildren()

    if (!this.paletteItems.length) {
      const empty = document.createElement('div')
      empty.className = 'gn-palette-empty'
      empty.textContent = 'No matching nodes'
      this.paletteResults.appendChild(empty)
      return
    }

    let category = null
    this.paletteItems.forEach((definition, index) => {
      const nextCategory = definition.category || 'General'
      if (nextCategory !== category) {
        category = nextCategory
        const heading = document.createElement('div')
        heading.className = 'gn-palette-category'
        heading.textContent = displayName(category)
        this.paletteResults.appendChild(heading)
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `gn-palette-item${index === this.paletteIndex ? ' is-highlighted' : ''}`
      button.dataset.paletteIndex = index
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', index === this.paletteIndex ? 'true' : 'false')
      const dot = document.createElement('span')
      dot.className = 'gn-palette-dot'
      dot.style.setProperty('--gn-category-color', this._categoryColor(definition.category))
      const text = document.createElement('span')
      text.textContent = definition.label || definition.name || displayName(definition.type)
      button.append(dot, text)
      button.addEventListener('pointermove', () => {
        this.paletteIndex = index
        this._highlightPaletteItem()
      })
      button.addEventListener('click', () => this._addNode(definition.type))
      this.paletteResults.appendChild(button)
    })
  }

  _highlightPaletteItem() {
    this.paletteResults.querySelectorAll('.gn-palette-item').forEach((element) => {
      const selected = Number(element.dataset.paletteIndex) === this.paletteIndex
      element.classList.toggle('is-highlighted', selected)
      element.setAttribute('aria-selected', selected ? 'true' : 'false')
      if (selected) element.scrollIntoView({ block: 'nearest' })
    })
  }

  _addNode(type) {
    const graph = this._graph()
    const manager = this.manager
    if (!graph || typeof manager?.addNode !== 'function') return
    const rect = this.stage.getBoundingClientRect()
    const point = this.palettePoint || this._clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
    this._closePalette()
    try {
      const result = manager.addNode(graph.id, type, point.x - 109, point.y - 30)
      if (result?.then) {
        result.then((node) => {
          if (node?.id) this._selectNode(node.id)
          this.render()
        }).catch((error) => this._showStatus(error.message, true))
      } else {
        if (result?.id) this._selectNode(result.id)
        this.render()
      }
    } catch (error) {
      this._showStatus(error.message, true)
    }
  }

  _categoryColor(category) {
    const key = String(category || 'default').toLowerCase()
    return CATEGORY_COLORS[key] || CATEGORY_COLORS.default
  }

  _socketColor(type) {
    return SOCKET_COLORS[String(type || 'any').toLowerCase()] || SOCKET_COLORS.any
  }

  _toHex(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value
    if (Array.isArray(value)) {
      const channels = value.slice(0, 3).map((channel) => clamp(Math.round(Number(channel) * (Number(channel) <= 1 ? 255 : 1)), 0, 255))
      return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    }
    return '#ffffff'
  }

  _showStatus(message, isError = false) {
    if (!this.status) return
    clearTimeout(this._statusTimer)
    this.status.textContent = message || ''
    this.status.classList.toggle('is-error', isError)
    this._statusTimer = setTimeout(() => {
      this.status.textContent = ''
      this.status.classList.remove('is-error')
    }, isError ? 5000 : 2500)
  }

  _rememberView() {
    if (!this.graphId) return
    if (!this._views) this._views = new Map()
    this._views.set(String(this.graphId), { x: this.pan.x, y: this.pan.y, zoom: this.zoom })
  }

  _hasViewForGraph(graphId) {
    return Boolean(this._views?.has(String(graphId)))
  }

  _loadRememberedView() {
    const view = this._views?.get(String(this.graphId))
    if (view) {
      this.pan = { x: view.x, y: view.y }
      this.zoom = view.zoom
    } else {
      this.pan = { x: 80, y: 42 }
      this.zoom = 1
    }
    this._applyTransform()
  }

  _restoreHeight() {
    try {
      const height = Number(localStorage.getItem('nanquim.geometryNodes.height'))
      if (Number.isFinite(height) && height >= 150) this.root.style.setProperty('--gn-panel-height', `${height}px`)
    } catch (_) { /* storage is optional */ }
  }
}

export { GeometryNodeEditor }
