import { Element, SVG, registerWindow } from '@svgdotjs/svg.js'
import { expect, vi } from 'vitest'

import { History } from '../../src/js/History.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

const INTERACTION_KEYS = [
  'isDrawing',
  'isInteracting',
  'isSelecting',
  'selectSingleElement',
  'isEditingVertex',
  'isTypingText',
  'suppressPolarTracking',
]

let drawHarnessUsers = 0
let originalDrawDescriptor
let svgGeometryHarnessUsers = 0
let originalGetBBoxDescriptor

function captureProperty(target, key) {
  return {
    hadOwn: Object.hasOwn(target, key),
    descriptor: Object.getOwnPropertyDescriptor(target, key),
  }
}

function restoreProperty(target, key, captured) {
  if (captured.hadOwn) Object.defineProperty(target, key, captured.descriptor)
  else delete target[key]
}

function listenerCapture(options) {
  return typeof options === 'boolean' ? options : options?.capture === true
}

function callEventListener(listener, target, event) {
  if (typeof listener === 'function') return listener.call(target, event)
  return listener?.handleEvent?.call(listener, event)
}

function installSvgDrawHarness() {
  if (drawHarnessUsers === 0) {
    originalDrawDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'draw')
    Object.defineProperty(Element.prototype, 'draw', {
      configurable: true,
      writable: true,
      value(commandOrOptions = {}) {
        if (commandOrOptions === 'cancel') {
          this.fire('drawcancel', { element: this })
          this.remove()
          return this
        }

        const options = commandOrOptions && typeof commandOrOptions === 'object'
          ? commandOrOptions
          : {}
        this.remember('_paintHandler', {
          options,
          startPoint: options.startPoint || null,
        })
        return this
      },
    })
  }

  drawHarnessUsers += 1
  let disposed = false

  return () => {
    if (disposed) return
    disposed = true
    drawHarnessUsers -= 1
    if (drawHarnessUsers > 0) return

    if (originalDrawDescriptor) {
      Object.defineProperty(Element.prototype, 'draw', originalDrawDescriptor)
    } else {
      delete Element.prototype.draw
    }
    originalDrawDescriptor = undefined
  }
}

function numberAttribute(node, name, fallback = 0) {
  const value = Number.parseFloat(node.getAttribute?.(name))
  return Number.isFinite(value) ? value : fallback
}

function deterministicBBox(node) {
  const name = node.localName
  if (name === 'line') {
    const x1 = numberAttribute(node, 'x1')
    const y1 = numberAttribute(node, 'y1')
    const x2 = numberAttribute(node, 'x2')
    const y2 = numberAttribute(node, 'y2')
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    }
  }
  if (name === 'circle' || name === 'ellipse') {
    const rx = name === 'circle' ? numberAttribute(node, 'r') : numberAttribute(node, 'rx')
    const ry = name === 'circle' ? rx : numberAttribute(node, 'ry')
    const cx = numberAttribute(node, 'cx')
    const cy = numberAttribute(node, 'cy')
    return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }
  }
  if (name === 'text' || name === 'tspan') {
    const fontSize = numberAttribute(node, 'font-size', 1)
    const x = numberAttribute(node, 'x')
    const y = numberAttribute(node, 'y') - fontSize
    return {
      x,
      y,
      width: (node.textContent || '').length * fontSize * 0.6,
      height: fontSize,
    }
  }
  if (name === 'g' || name === 'svg') {
    const boxes = [...node.children].map(deterministicBBox)
    if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    const right = Math.max(...boxes.map((box) => box.x + box.width))
    const bottom = Math.max(...boxes.map((box) => box.y + box.height))
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  return {
    x: numberAttribute(node, 'x'),
    y: numberAttribute(node, 'y'),
    width: numberAttribute(node, 'width'),
    height: numberAttribute(node, 'height'),
  }
}

function installSvgGeometryHarness() {
  if (svgGeometryHarnessUsers === 0) {
    originalGetBBoxDescriptor = Object.getOwnPropertyDescriptor(
      window.SVGElement.prototype,
      'getBBox',
    )
    Object.defineProperty(window.SVGElement.prototype, 'getBBox', {
      configurable: true,
      value() {
        return deterministicBBox(this)
      },
      writable: true,
    })
  }

  svgGeometryHarnessUsers += 1
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    svgGeometryHarnessUsers -= 1
    if (svgGeometryHarnessUsers > 0) return

    if (originalGetBBoxDescriptor) {
      Object.defineProperty(
        window.SVGElement.prototype,
        'getBBox',
        originalGetBBoxDescriptor,
      )
    } else {
      delete window.SVGElement.prototype.getBBox
    }
    originalGetBBoxDescriptor = undefined
  }
}

class DeterministicSignal {
  constructor(name = 'anonymous') {
    this.name = name
    this.bindings = []
    this.add = vi.fn(this._add.bind(this, false))
    this.addOnce = vi.fn(this._add.bind(this, true))
    this.remove = vi.fn(this._remove.bind(this))
    this.removeAll = vi.fn(this._removeAll.bind(this))
    this.dispatch = vi.fn(this._dispatch.bind(this))
  }

  _add(once, listener, context) {
    if (typeof listener !== 'function') {
      throw new TypeError(`${this.name}.add requires a function`)
    }

    const existing = this.bindings.find((binding) => (
      binding.listener === listener && binding.context === context
    ))
    if (existing) return existing.publicBinding

    const binding = {
      context,
      listener,
      once,
      publicBinding: null,
    }
    binding.publicBinding = {
      detach: () => this._remove(listener, context),
      getListener: () => listener,
      getSignal: () => this,
      isBound: () => this.bindings.includes(binding),
      isOnce: () => once,
    }
    this.bindings.push(binding)
    return binding.publicBinding
  }

  _remove(listener, context) {
    const binding = this.bindings.find((candidate) => (
      candidate.listener === listener
      && (context === undefined || candidate.context === context)
    ))
    if (!binding) return null
    this.bindings.splice(this.bindings.indexOf(binding), 1)
    return listener
  }

  _removeAll() {
    this.bindings.length = 0
  }

  _dispatch(...args) {
    for (const binding of [...this.bindings]) {
      if (!this.bindings.includes(binding)) continue
      if (binding.once) this._remove(binding.listener, binding.context)
      binding.listener.apply(binding.context, args)
    }
  }

  getNumListeners() {
    return this.bindings.length
  }
}

function createSignalHarness(initialNames = []) {
  const registry = new Map()

  const get = (name) => {
    if (!registry.has(name)) registry.set(name, new DeterministicSignal(name))
    return registry.get(name)
  }

  initialNames.forEach(get)

  const signals = new Proxy({}, {
    get(_target, key) {
      if (typeof key === 'symbol') return undefined
      return get(key)
    },
    has(_target, key) {
      return registry.has(key)
    },
    ownKeys() {
      return [...registry.keys()]
    },
    getOwnPropertyDescriptor(_target, key) {
      if (!registry.has(key)) return undefined
      return { configurable: true, enumerable: true, value: registry.get(key) }
    },
  })

  return {
    signals,
    get,
    snapshot() {
      return Object.fromEntries(
        [...registry.entries()]
          .map(([name, signal]) => [name, signal.getNumListeners()])
          .filter(([, listenerCount]) => listenerCount > 0)
          .sort(([left], [right]) => left.localeCompare(right)),
      )
    },
    clearDispatchHistory() {
      registry.forEach((signal) => signal.dispatch.mockClear())
    },
    dispose() {
      registry.forEach((signal) => signal._removeAll())
      registry.clear()
    },
  }
}

function createTerminalFixture(parent = document.body) {
  const terminal = document.createElement('div')
  terminal.className = 'terminal'
  terminal.innerHTML = `
    <div id="terminalLog"></div>
    <input id="terminalInput" type="text" aria-label="Command input">
    <div id="terminalAutocomplete"></div>
  `
  parent.appendChild(terminal)

  return {
    terminal,
    input: terminal.querySelector('#terminalInput'),
    log: terminal.querySelector('#terminalLog'),
    autocomplete: terminal.querySelector('#terminalAutocomplete'),
  }
}

function createDocumentStateStub(signalHarness) {
  let trackingDepth = 0
  const state = {
    isDirty: false,
    markChanged: vi.fn(function (reason = 'test-mutation') {
      if (trackingDepth > 0) return false
      this.isDirty = true
      this.revision += 1
      signalHarness.get('documentStateChanged').dispatch({
        dirty: true,
        reason,
        revision: this.revision,
      })
      return true
    }),
    markClean: vi.fn(function () {
      this.isDirty = false
      signalHarness.get('documentStateChanged').dispatch({
        dirty: false,
        revision: this.revision,
      })
    }),
    revision: 0,
    runWithoutTracking: vi.fn((operation) => {
      trackingDepth += 1
      try {
        return operation()
      } finally {
        trackingDepth -= 1
      }
    }),
    replaceSession: vi.fn(function ({ dirty = false } = {}) {
      this.isDirty = dirty
      this.revision = 0
    }),
    flushObservedMutations: vi.fn(),
    disconnect: vi.fn(),
  }
  return state
}

function createDeterministicEditorFixture({
  collectionId = 'collection-test',
  coordinates = { x: 120, y: 120 },
  mode = 'model',
} = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('createDeterministicEditorFixture requires a jsdom environment')
  }

  registerWindow(window, document)
  const restoreDrawHarness = installSvgDrawHarness()
  const restoreGeometryHarness = installSvgGeometryHarness()
  const svgGlobal = captureProperty(globalThis, 'SVG')
  globalThis.SVG = SVG

  const host = document.createElement('div')
  host.id = `canvas-${collectionId}`
  document.body.appendChild(host)
  const terminal = createTerminalFixture(host)

  const svg = SVG().addTo(host).attr('data-test-editor', 'model')
  const overlays = svg.group().attr('id', 'Overlays')
  const snap = svg.group().attr('id', 'Snap')
  const drawing = svg.group().attr('id', 'Collection')
  const handlers = svg.group().attr('id', 'Handlers')
  const activeCollection = drawing.group().attr({
    id: collectionId,
    name: 'Test collection',
    'data-collection': 'true',
  })

  const paperHost = document.createElement('div')
  paperHost.id = `paper-${collectionId}`
  document.body.appendChild(paperHost)
  const paperSvg = SVG().addTo(paperHost).attr('data-test-editor', 'paper')
  const paperDrawing = paperSvg.group().attr('id', 'PaperAnnotations')

  svg.point = vi.fn((x, y) => ({ x: Number(x), y: Number(y) }))
  paperSvg.point = vi.fn((x, y) => ({ x: Number(x), y: Number(y) }))

  const signalHarness = createSignalHarness([
    'commandCancelled',
    'coordinateInput',
    'inputValue',
    'pointCaptured',
    'terminalLogged',
    'toogledSelect',
    'updatedCoordinates',
    'updatedOutliner',
    'updatedProperties',
    'updatedSelection',
  ])

  const collectionStyle = {
    fill: 'transparent',
    opacity: 1,
    stroke: '#ffffff',
    'stroke-width': 0.25,
  }

  const editor = {
    activeCollection,
    activeEditor: 'canvas',
    blockDefinitions: new Map(),
    canvas: host,
    cmdParams: { filletRadius: 0 },
    collections: new Map([[
      collectionId,
      { group: activeCollection, name: 'Test collection', style: collectionStyle },
    ]]),
    coordinates: { ...coordinates },
    drawing,
    editingBlock: null,
    editingVertices: [],
    elementIndex: 1,
    extensionHovers: [],
    fullSpatialIndex: { clear: vi.fn(), markDirty: vi.fn(), rebuild: vi.fn() },
    handlers,
    history: null,
    inputCoord: null,
    inputCoordMode: 'absolute',
    isDrawing: false,
    isEditingVertex: false,
    isInteracting: false,
    isSelecting: false,
    isSnapping: false,
    isTypingText: false,
    lastClick: null,
    lastCommand: null,
    length: null,
    mode,
    offsetDX: null,
    offsetDY: null,
    orthomode: true,
    overlays,
    paperDrawing,
    paperEditor: {
      createViewport: vi.fn(),
      removeViewport: vi.fn(),
      viewports: new Map(),
    },
    paperSvg,
    polarTracking: false,
    previousSelection: [],
    selected: [],
    selectSingleElement: false,
    signals: signalHarness.signals,
    snap,
    snapPoint: null,
    spatialIndex: { clear: vi.fn(), markDirty: vi.fn(), rebuild: vi.fn() },
    suppressPolarTracking: false,
    svg,
  }

  editor.documentState = createDocumentStateStub(signalHarness)
  editor.dimensionManager = {
    getStyle: vi.fn(() => null),
    styles: new Map(),
    toJSON: vi.fn(() => ({})),
  }
  const standardTextStyle = {
    id: 'Standard',
    name: 'Standard',
    properties: {
      dominantBaseline: 'auto',
      fill: '#ffffff',
      fontFamily: 'Inter',
      fontSize: 0.15,
      fontStyle: 'normal',
      fontWeight: 'normal',
      letterSpacing: 0,
      textAnchor: 'start',
      textDecoration: 'none',
    },
  }
  editor.textStyleManager = {
    activeStyleId: 'Standard',
    getActiveStyle: vi.fn(() => standardTextStyle),
    getStyle: vi.fn(() => standardTextStyle),
    styles: new Map([['Standard', standardTextStyle]]),
    toJSON: vi.fn(() => ({})),
  }
  editor.geometryNodes = {
    graphs: new Map(),
    instances: new Map(),
    serialize: vi.fn(() => ({ version: 1, graphs: [], instances: [] })),
  }
  editor.history = new History(editor)
  editor.execute = (command) => editor.history.execute(command)
  editor.setIsDrawing = (value) => {
    if (value && !editor.isDrawing) editor.lastClick = null
    editor.isDrawing = value
  }
  editor.addElement = (element, parent = editor.activeCollection) => {
    editor.documentState.runWithoutTracking(() => element.putIn(parent))
    editor.spatialIndex.markDirty()
    editor.fullSpatialIndex.markDirty()
    editor.signals.updatedOutliner.dispatch()
    editor.documentState.markChanged('element-added')
  }
  editor.removeElement = (element) => {
    editor.documentState.runWithoutTracking(() => element.remove())
    editor.spatialIndex.markDirty()
    editor.fullSpatialIndex.markDirty()
    editor.signals.updatedOutliner.dispatch()
    editor.documentState.markChanged('element-removed')
  }

  let disposed = false
  return {
    activeCollection,
    editor,
    host,
    paperHost,
    signalHarness,
    terminal,
    fireDraw(element, type, detail = {}) {
      element.fire(type, detail)
    },
    dispose() {
      if (disposed) return
      disposed = true
      signalHarness.dispose()
      host.remove()
      paperHost.remove()
      restoreDrawHarness()
      restoreGeometryHarness()
      restoreProperty(globalThis, 'SVG', svgGlobal)
    },
  }
}

function installDomListenerTracker() {
  const prototype = globalThis.EventTarget?.prototype
  if (!prototype) throw new Error('installDomListenerTracker requires EventTarget')

  const originalAdd = prototype.addEventListener
  const originalRemove = prototype.removeEventListener
  const active = []
  const targetIds = new WeakMap()
  const listenerIds = new WeakMap()
  let nextTargetId = 1
  let nextListenerId = 1

  const getTargetId = (target) => {
    if (!targetIds.has(target)) targetIds.set(target, nextTargetId++)
    return targetIds.get(target)
  }
  const getListenerId = (listener) => {
    if (!listenerIds.has(listener)) listenerIds.set(listener, nextListenerId++)
    return listenerIds.get(listener)
  }
  const removeRecord = (record) => {
    const index = active.indexOf(record)
    if (index !== -1) active.splice(index, 1)
    if (record.abortSignal && record.abortListener) {
      record.abortSignal.removeEventListener('abort', record.abortListener)
    }
  }

  const addSpy = vi.spyOn(prototype, 'addEventListener').mockImplementation(function (
    type,
    listener,
    options,
  ) {
    if (!listener || options?.signal?.aborted) {
      return originalAdd.call(this, type, listener, options)
    }

    const capture = listenerCapture(options)
    const existing = active.find((record) => (
      record.target === this
      && record.type === type
      && record.listener === listener
      && record.capture === capture
    ))
    if (existing) return undefined

    const record = {
      abortListener: null,
      abortSignal: options?.signal || null,
      capture,
      listener,
      once: typeof options === 'object' && options?.once === true,
      target: this,
      type,
      wrapped: null,
    }
    record.wrapped = (event) => {
      if (record.once) removeRecord(record)
      return callEventListener(listener, this, event)
    }
    if (record.abortSignal) {
      record.abortListener = () => removeRecord(record)
      record.abortSignal.addEventListener('abort', record.abortListener, { once: true })
    }

    active.push(record)
    return originalAdd.call(this, type, record.wrapped, options)
  })

  const removeSpy = vi.spyOn(prototype, 'removeEventListener').mockImplementation(function (
    type,
    listener,
    options,
  ) {
    const capture = listenerCapture(options)
    const record = active.find((candidate) => (
      candidate.target === this
      && candidate.type === type
      && candidate.listener === listener
      && candidate.capture === capture
    ))
    if (!record) return originalRemove.call(this, type, listener, options)
    removeRecord(record)
    return originalRemove.call(this, type, record.wrapped, options)
  })

  const snapshot = () => active
    .filter((record) => !(
      record.target instanceof Node
      && record.target !== document
      && record.target !== window
      && !record.target.isConnected
    ))
    .map((record) => [
      getTargetId(record.target),
      record.type,
      getListenerId(record.listener),
      record.capture ? 'capture' : 'bubble',
    ].join(':'))
    .sort()

  return {
    snapshot,
    expectStable(baseline = []) {
      expect(snapshot()).toEqual(baseline)
    },
    get size() {
      return snapshot().length
    },
    dispose() {
      for (const record of [...active]) {
        removeRecord(record)
        originalRemove.call(record.target, record.type, record.wrapped, record.capture)
      }
      removeSpy.mockRestore()
      addSpy.mockRestore()
    },
  }
}

function installClockHarness({ frameDuration = 16, now = 0 } = {}) {
  const globalRaf = captureProperty(globalThis, 'requestAnimationFrame')
  const globalCancelRaf = captureProperty(globalThis, 'cancelAnimationFrame')
  const windowRaf = typeof window === 'undefined' ? null : captureProperty(window, 'requestAnimationFrame')
  const windowCancelRaf = typeof window === 'undefined' ? null : captureProperty(window, 'cancelAnimationFrame')

  vi.useFakeTimers({ now })
  const requestAnimationFrame = vi.fn((callback) => (
    setTimeout(() => callback(performance.now()), frameDuration)
  ))
  const cancelAnimationFrame = vi.fn((id) => clearTimeout(id))
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: requestAnimationFrame,
    writable: true,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: cancelAnimationFrame,
    writable: true,
  })
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame = requestAnimationFrame
    window.cancelAnimationFrame = cancelAnimationFrame
  }

  let disposed = false
  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    advance(milliseconds) {
      return vi.advanceTimersByTimeAsync(milliseconds)
    },
    advanceFrame() {
      return vi.advanceTimersByTimeAsync(frameDuration)
    },
    runAll() {
      return vi.runAllTimersAsync()
    },
    get pendingCount() {
      return vi.getTimerCount()
    },
    expectNoPendingTimers() {
      expect(vi.getTimerCount()).toBe(0)
    },
    dispose() {
      if (disposed) return
      disposed = true
      vi.clearAllTimers()
      vi.useRealTimers()
      restoreProperty(globalThis, 'requestAnimationFrame', globalRaf)
      restoreProperty(globalThis, 'cancelAnimationFrame', globalCancelRaf)
      if (typeof window !== 'undefined') {
        restoreProperty(window, 'requestAnimationFrame', windowRaf)
        restoreProperty(window, 'cancelAnimationFrame', windowCancelRaf)
      }
    },
  }
}

function createClipboardData(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    clearData(type) {
      if (type) values.delete(type)
      else values.clear()
    },
    getData(type) {
      return values.get(type) || ''
    },
    setData(type, value) {
      values.set(type, String(value))
    },
    get types() {
      return [...values.keys()]
    },
  }
}

function installClipboardHarness({ text = '' } = {}) {
  const captured = captureProperty(navigator, 'clipboard')
  let clipboardText = String(text)
  const clipboard = {
    read: vi.fn(async () => []),
    readText: vi.fn(async () => clipboardText),
    write: vi.fn(async () => undefined),
    writeText: vi.fn(async (value) => {
      clipboardText = String(value)
    }),
  }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })

  return {
    clipboard,
    get text() {
      return clipboardText
    },
    set text(value) {
      clipboardText = String(value)
    },
    dispose() {
      restoreProperty(navigator, 'clipboard', captured)
    },
  }
}

function createMemoryFileHandle({
  contents = '',
  name = 'drawing.svg',
  writable = true,
} = {}) {
  let committedContents = String(contents)
  let closeError = null

  const handle = {
    kind: 'file',
    name,
    createWritable: vi.fn(async ({ keepExistingData = false } = {}) => {
      if (!writable) throw new DOMException('Write permission denied', 'NotAllowedError')
      let draft = keepExistingData ? committedContents : ''
      let closed = false

      return {
        write: vi.fn(async (value) => {
          if (closed) throw new TypeError('Writable stream is closed')
          const data = value?.type === 'write' ? value.data : value
          if (data instanceof Blob) draft = await data.text()
          else draft = String(data ?? '')
        }),
        close: vi.fn(async () => {
          if (closed) return
          if (closeError) throw closeError
          committedContents = draft
          closed = true
        }),
        abort: vi.fn(async () => {
          closed = true
        }),
      }
    }),
    getFile: vi.fn(async () => new File([committedContents], name, {
      type: name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream',
    })),
    isSameEntry: vi.fn(async (other) => other === handle),
    queryPermission: vi.fn(async () => (writable ? 'granted' : 'denied')),
    requestPermission: vi.fn(async () => (writable ? 'granted' : 'denied')),
  }

  return {
    handle,
    get contents() {
      return committedContents
    },
    failClose(error = new DOMException('Close failed', 'InvalidStateError')) {
      closeError = error
    },
  }
}

function installFileApiHarness({
  openHandles = [createMemoryFileHandle().handle],
  saveHandle = createMemoryFileHandle().handle,
} = {}) {
  if (typeof window === 'undefined') {
    throw new Error('installFileApiHarness requires a jsdom environment')
  }

  const openPicker = captureProperty(window, 'showOpenFilePicker')
  const savePicker = captureProperty(window, 'showSaveFilePicker')
  const showOpenFilePicker = vi.fn(async () => openHandles)
  const showSaveFilePicker = vi.fn(async () => saveHandle)

  Object.defineProperty(window, 'showOpenFilePicker', {
    configurable: true,
    value: showOpenFilePicker,
  })
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: showSaveFilePicker,
  })

  return {
    showOpenFilePicker,
    showSaveFilePicker,
    dispose() {
      restoreProperty(window, 'showOpenFilePicker', openPicker)
      restoreProperty(window, 'showSaveFilePicker', savePicker)
    },
  }
}

function helperCounts(editor) {
  const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
  return {
    handlers: editor.handlers?.node?.childElementCount || 0,
    overlays: editor.overlays?.node?.childElementCount || 0,
    previews: activeSvg?.node?.querySelectorAll(
      '[data-nanquim-transient], [data-rectangle-preview], [data-command-preview], .ghost, [class*="ghost-"]',
    ).length || 0,
    snap: editor.snap?.node?.childElementCount || 0,
  }
}

function snapshotInteractionState(editor, {
  clock = null,
  includeElementIndex = false,
  listenerTracker = null,
  signalHarness = null,
} = {}) {
  return {
    flags: Object.fromEntries(INTERACTION_KEYS.map((key) => [key, Boolean(editor[key])])),
    ...(includeElementIndex ? { elementIndex: editor.elementIndex } : {}),
    helpers: helperCounts(editor),
    listeners: listenerTracker?.snapshot() || [],
    signals: signalHarness?.snapshot() || {},
    timers: clock?.pendingCount || 0,
  }
}

function expectNoInteractionLeaks(editor, baseline, harnesses = {}) {
  expect(snapshotInteractionState(editor, harnesses)).toEqual(baseline)
}

export {
  DeterministicSignal,
  SVG_NS,
  createClipboardData,
  createDeterministicEditorFixture,
  createMemoryFileHandle,
  createSignalHarness,
  createTerminalFixture,
  expectNoInteractionLeaks,
  installClipboardHarness,
  installClockHarness,
  installDomListenerTracker,
  installFileApiHarness,
  snapshotInteractionState,
}
