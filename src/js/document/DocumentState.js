const TRANSIENT_ATTRIBUTE_NAMES = new Set([
  'aria-activedescendant',
  'aria-selected',
  'class',
  'data-collapsed',
  'data-nanquim-orig-fill',
  'data-nanquim-orig-stroke',
  'selected',
])

const TRANSIENT_NODE_SELECTOR = [
  '[data-nanquim-transient="true"]',
  '[data-block-edit="true"]',
  '[data-block-ghost="true"]',
  '[data-rectangle-preview="true"]',
  '.ghostLine',
  '.mirror-axis-helper',
  '.measure-ghost',
  '.measure-ghost-group',
  '.selectionRectangle',
  '.selection-handler',
  '.vertex-handler',
  '.vp-handle',
].join(',')

function domNode(value) {
  return value && (value.node || value)
}

function isElement(value) {
  return Boolean(value && value.nodeType === 1)
}

function isTransientNode(value) {
  const node = value && value.nodeType === 3 ? value.parentElement : value
  if (!isElement(node)) return false
  if (node.matches(TRANSIENT_NODE_SELECTOR)) return true
  return Boolean(node.closest(TRANSIENT_NODE_SELECTOR))
}

function isPersistentMutation(record) {
  if (record.type === 'attributes') {
    if (TRANSIENT_ATTRIBUTE_NAMES.has(record.attributeName)) return false
    return !isTransientNode(record.target)
  }

  if (record.type === 'characterData') return !isTransientNode(record.target)
  if (record.type !== 'childList') return false
  if (isTransientNode(record.target)) return false

  const changedNodes = [...record.addedNodes, ...record.removedNodes]
  if (changedNodes.length === 0) return false
  return changedNodes.some((node) => !isTransientNode(node))
}

class DocumentState {
  constructor(editor, options = {}) {
    this.editor = editor
    this.sessionId = 1
    this.revision = 0
    this.savedRevision = 0
    this.name = Object.hasOwn(options, 'name') ? options.name : (editor.currentFileName ?? null)
    this.handle = Object.hasOwn(options, 'handle') ? options.handle : (editor.currentFileHandle ?? null)
    this._trackingDepth = 0
    this._observers = new Map()
    this._signalListeners = []

    this._syncEditorFileState()

    if (options.observe !== false) {
      this.observePersistentRoot(editor.drawing)

      // Definitions are editable document content too. Creating the SVG.js
      // defs wrapper here is intentional: it happens before observation begins
      // and lets later block, hatch, and imported-definition changes be seen.
      if (editor.svg && typeof editor.svg.defs === 'function') {
        this.observePersistentRoot(editor.svg.defs())
      }
      this.observePersistentRoot(editor.paperAnnotations)
    }

    // Geometry Nodes graphs are persisted as metadata and can change without
    // changing the model DOM (for example, moving or rewiring graph nodes).
    this._listenToSignal('geometryNodesChanged', () => {
      if (!this.flushObservedMutations()) this.markChanged('geometry-nodes')
    })
  }

  get isDirty() {
    return this.revision !== this.savedRevision
  }

  get fileName() {
    return this.name
  }

  get fileHandle() {
    return this.handle
  }

  snapshot(reason = null) {
    return {
      sessionId: this.sessionId,
      revision: this.revision,
      savedRevision: this.savedRevision,
      isDirty: this.isDirty,
      name: this.name,
      handle: this.handle,
      reason,
    }
  }

  markChanged(reason = 'document') {
    if (this._trackingDepth > 0) return false
    this.revision += 1
    this._dispatch(reason)
    return true
  }

  createSaveToken() {
    this.flushObservedMutations()
    return Object.freeze({
      sessionId: this.sessionId,
      revision: this.revision,
      name: this.name,
      handle: this.handle,
    })
  }

  markSaved(token) {
    return this.commitSave(token)
  }

  commitSave(token, association = {}) {
    // A DOM mutation can be queued without its MutationObserver callback
    // having run yet. Flush it before comparing the save token so a synchronous
    // completion cannot briefly mark newer content clean.
    this.flushObservedMutations()
    if (
      !token
      || token.sessionId !== this.sessionId
      || token.revision !== this.revision
      || token.name !== this.name
      || token.handle !== this.handle
    ) return false

    if (Object.hasOwn(association, 'name')) this.name = association.name
    if (Object.hasOwn(association, 'handle')) this.handle = association.handle
    this.savedRevision = this.revision
    this._syncEditorFileState()
    this._dispatch('saved')
    return true
  }

  replaceSession({ name = null, handle = null, dirty = false } = {}) {
    this.sessionId += 1
    this.revision = dirty ? 1 : 0
    this.savedRevision = 0
    this.name = name
    this.handle = handle
    this._syncEditorFileState()
    this._discardObservedMutations()
    this._dispatch('session-replaced')
    return this.snapshot('session-replaced')
  }

  runWithoutTracking(callback) {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.')
    if (this._trackingDepth === 0) this.flushObservedMutations()
    this._trackingDepth += 1

    const finish = () => {
      this._discardObservedMutations()
      this._trackingDepth = Math.max(0, this._trackingDepth - 1)
    }

    try {
      const result = callback()
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then(
          (value) => {
            finish()
            return value
          },
          (error) => {
            finish()
            throw error
          },
        )
      }
      finish()
      return result
    } catch (error) {
      finish()
      throw error
    }
  }

  observePersistentRoot(value) {
    const root = domNode(value)
    if (!root || typeof MutationObserver === 'undefined') return null
    if (this._observers.has(root)) return this._observers.get(root)

    const observer = new MutationObserver((records) => {
      if (this._trackingDepth > 0) return
      if (records.some(isPersistentMutation)) this.markChanged('dom')
    })
    observer.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
    this._observers.set(root, observer)
    return observer
  }

  refreshPersistentRoots() {
    this.observePersistentRoot(this.editor.drawing)
    this.observePersistentRoot(this.editor.paperAnnotations)
    if (this.editor.svg && typeof this.editor.svg.defs === 'function') {
      this.observePersistentRoot(this.editor.svg.defs())
    }
  }

  unobservePersistentRoot(value) {
    const root = domNode(value)
    const observer = root && this._observers.get(root)
    if (!observer) return false
    observer.disconnect()
    this._observers.delete(root)
    return true
  }

  flushObservedMutations() {
    if (this._trackingDepth > 0) {
      this._discardObservedMutations()
      return false
    }

    let changed = false
    this._observers.forEach((observer) => {
      if (observer.takeRecords().some(isPersistentMutation)) changed = true
    })
    if (changed) this.markChanged('dom')
    return changed
  }

  disconnect() {
    this._observers.forEach((observer) => observer.disconnect())
    this._observers.clear()
    this._signalListeners.forEach(({ signal, listener }) => {
      if (typeof signal.remove === 'function') signal.remove(listener)
    })
    this._signalListeners = []
  }

  _discardObservedMutations() {
    this._observers.forEach((observer) => observer.takeRecords())
  }

  _syncEditorFileState() {
    this.editor.currentFileName = this.name
    this.editor.currentFileHandle = this.handle
  }

  _listenToSignal(name, listener) {
    const signal = this.editor.signals && this.editor.signals[name]
    if (!signal || typeof signal.add !== 'function') return
    signal.add(listener)
    this._signalListeners.push({ signal, listener })
  }

  _dispatch(reason) {
    const signal = this.editor.signals && this.editor.signals.documentStateChanged
    if (signal && typeof signal.dispatch === 'function') {
      try {
        signal.dispatch(this.snapshot(reason))
      } catch (error) {
        console.error('[DocumentState] A document-state listener failed:', error)
      }
    }
  }
}

export {
  DocumentState,
  TRANSIENT_ATTRIBUTE_NAMES,
  TRANSIENT_NODE_SELECTOR,
  isPersistentMutation,
}
