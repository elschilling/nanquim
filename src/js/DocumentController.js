import { addRecentFile as rememberRecentFile } from './WelcomeScreen.js'
import {
  DOCUMENT_SCHEMA_VERSION,
  serializeNativeDocument,
} from './document/DocumentSerializer.js'

const NATIVE_SVG_TYPES = Object.freeze([{
  description: 'Nanquim SVG document',
  accept: { 'image/svg+xml': ['.svg'] },
}])

const OPEN_DOCUMENT_TYPES = Object.freeze([{
  description: 'Nanquim drawings',
  accept: {
    'image/svg+xml': ['.svg'],
    'image/vnd.dxf': ['.dxf'],
  },
}])

const BLANK_DOCUMENT_SOURCE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 10 10" data-nanquim-version="${DOCUMENT_SCHEMA_VERSION}"/>`,
  '',
].join('\n')

function isWhitePresentationColor(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '')
  return normalized === '#fff'
    || normalized === '#ffffff'
    || normalized === 'white'
    || normalized === 'rgb(255,255,255)'
    || normalized === 'var(--editor-text-color)'
}

function createPresentationSvg(source, options = {}) {
  const Parser = options.DOMParser || globalThis.DOMParser
  const Serializer = options.XMLSerializer || globalThis.XMLSerializer
  if (typeof Parser !== 'function' || typeof Serializer !== 'function') {
    throw new TypeError('SVG export requires XML parsing support.')
  }

  const documentRef = new Parser().parseFromString(source, 'image/svg+xml')
  if (documentRef.querySelector('parsererror')) {
    throw new TypeError('The editable document could not be prepared for export.')
  }
  const root = documentRef.documentElement

  // An exported SVG is a presentation/interchange copy, not a native project
  // file. Remove session metadata and the separately edited Paper layer so it
  // cannot be mistaken for a lossless document when opened again.
  Array.from(root.attributes).forEach((attribute) => {
    if (attribute.name.startsWith('data-')) root.removeAttributeNode(attribute)
  })
  Array.from(root.children).forEach((child) => {
    if (
      child.localName.toLowerCase() === 'metadata'
      || child.getAttribute('data-nanquim-paper-annotations') === 'true'
    ) child.remove()
  })

  if (options.convertWhiteToBlack !== false) {
    root.querySelectorAll('*').forEach((element) => {
      for (const property of ['stroke', 'fill']) {
        if (isWhitePresentationColor(element.getAttribute(property))) {
          element.setAttribute(property, '#000000')
        }
        const inlineValue = element.style?.getPropertyValue(property)
        if (isWhitePresentationColor(inlineValue)) {
          element.style.setProperty(property, '#000000')
        }
      }
    })
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new Serializer().serializeToString(root)}\n`
}

function isAbortError(error) {
  return error && error.name === 'AbortError'
}

function permissionError() {
  const error = new Error('Write permission was not granted for this file.')
  error.name = 'NotAllowedError'
  return error
}

function nativeSvgName(value, fallback = 'drawing.svg') {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) return fallback
  if (/\.svg$/i.test(name)) return name
  const stem = name.replace(/\.[^.]*$/, '') || 'drawing'
  return `${stem}.svg`
}

function isDxfFile(file) {
  const name = String(file?.name || '')
  const type = String(file?.type || '').toLowerCase()
  return /\.dxf$/i.test(name) || [
    'application/dxf',
    'application/x-dxf',
    'image/vnd.dxf',
    'image/x-dxf',
  ].includes(type)
}

class DocumentController {
  constructor(editor, options = {}) {
    if (!editor) throw new TypeError('An editor is required.')

    this.editor = editor
    this.window = options.window || options.windowRef || globalThis.window
    this.document = options.document || options.documentRef || globalThis.document
    this.addRecentFile = options.addRecentFile || rememberRecentFile
    this.serialize = options.serialize || serializeNativeDocument
    this._beforeUnload = this.handleBeforeUnload.bind(this)
    this._documentOperationId = 0
    this._writeQueue = Promise.resolve()

    if (options.attachBeforeUnload !== false) {
      this.window?.addEventListener?.('beforeunload', this._beforeUnload)
    }
  }

  dispose() {
    this._documentOperationId += 1
    this.window?.removeEventListener?.('beforeunload', this._beforeUnload)
  }

  handleBeforeUnload(event) {
    this.editor.documentState?.flushObservedMutations?.()
    if (!this.editor.documentState?.isDirty) return undefined
    event?.preventDefault?.()
    if (event) event.returnValue = ''
    return ''
  }

  async newDocument() {
    if (!this._confirmDiscard('create a new drawing')) return this._cancelled()
    const commitGuard = this._beginDocumentReplacement()
    try {
      return await this.editor.loader.loadSource(BLANK_DOCUMENT_SOURCE, {
        name: 'Untitled.svg',
        type: 'image/svg+xml',
        handle: null,
        commitGuard,
      })
    } catch (error) {
      this._reportError('Could not create a new drawing.', error)
      return { ok: false, error }
    }
  }

  async open() {
    if (!this._confirmDiscard('open another drawing')) return this._cancelled()
    const commitGuard = this._beginDocumentReplacement()

    const picker = this.window?.showOpenFilePicker
    if (typeof picker === 'function') {
      let handle
      try {
        ;[handle] = await picker.call(this.window, {
          multiple: false,
          types: OPEN_DOCUMENT_TYPES,
        })
        if (!handle) return this._cancelled()
        const file = await handle.getFile()
        return await this._loadFile(file, {
          handle: isDxfFile(file) ? null : handle,
          commitGuard,
        })
      } catch (error) {
        if (isAbortError(error)) return this._cancelled(error)
        this._reportError('Could not open the selected file.', error)
        return { ok: false, error }
      }
    }

    try {
      const file = await this._chooseUploadFile()
      if (!file) return this._cancelled()
      return await this._loadFile(file, { handle: null, commitGuard })
    } catch (error) {
      if (isAbortError(error)) return this._cancelled(error)
      this._reportError('Could not open the selected file.', error)
      return { ok: false, error }
    }
  }

  async openFile(file, { handle = null } = {}) {
    if (!this._confirmDiscard('open another drawing')) return this._cancelled()
    const commitGuard = this._beginDocumentReplacement()
    return this._loadFile(file, {
      handle: isDxfFile(file) ? null : handle,
      commitGuard,
    })
  }

  async save() {
    const state = this.editor.documentState
    const handle = state?.fileHandle
      ?? this.editor.currentFileHandle
      ?? null
    if (!handle) return this.saveAs()

    let captured
    try {
      captured = this._captureSave()
      const associationIsCurrent = this._captureAssociationGuard(captured.token)
      return await this._enqueueWrite(() => this._writeCapturedToHandle(captured, handle, {
        name: state?.fileName || handle.name,
        commitGuard: associationIsCurrent,
      }))
    } catch (error) {
      return this._saveFailure(error, 'Could not save the current drawing.')
    }
  }

  async saveAs({ suggestedName } = {}) {
    const invocationIsCurrent = this._captureSessionGuard()
    const filename = nativeSvgName(
      suggestedName || this.editor.documentState?.fileName || this.editor.currentFileName,
    )
    const picker = this.window?.showSaveFilePicker

    if (typeof picker === 'function') {
      let handle
      try {
        handle = await picker.call(this.window, {
          suggestedName: filename,
          types: NATIVE_SVG_TYPES,
        })
      } catch (error) {
        return this._saveFailure(error, 'Could not choose where to save the drawing.')
      }
      if (!handle) return this._cancelled()
      if (!invocationIsCurrent()) return this._staleCancellation()

      try {
        const captured = this._captureSave()
        return await this._enqueueWrite(() => {
          if (!invocationIsCurrent()) return this._staleCancellation()
          return this._writeCapturedToHandle(captured, handle, {
            name: handle.name || filename,
            remember: true,
            commitGuard: invocationIsCurrent,
          })
        })
      } catch (error) {
        return this._saveFailure(error, 'Could not save the drawing.')
      }
    }

    try {
      const captured = this._captureSave()
      this._download(captured.source, filename)
      this._reportSuccess(
        `Downloaded ${filename}. Keep this drawing open until the browser confirms the download.`,
      )
      return {
        ok: true,
        committed: false,
        unverified: true,
        method: 'download',
        name: filename,
      }
    } catch (error) {
      return this._saveFailure(error, 'Could not download the drawing.')
    }
  }

  async exportSvg({ filename = 'drawing-export.svg', convertWhiteToBlack = true } = {}) {
    const name = nativeSvgName(filename, 'drawing-export.svg')
    try {
      const source = createPresentationSvg(this.serialize(this.editor), {
        convertWhiteToBlack,
        DOMParser: this.window?.DOMParser,
        XMLSerializer: this.window?.XMLSerializer,
      })
      this._download(source, name)
      this._reportSuccess(`Exported ${name}.`)
      return { ok: true, method: 'download', name }
    } catch (error) {
      this._reportError('Could not export the drawing.', error)
      return { ok: false, error }
    }
  }

  exportSVG(options) {
    return this.exportSvg(options)
  }

  _confirmDiscard(action) {
    const state = this.editor.documentState
    state?.flushObservedMutations?.()
    if (!state?.isDirty) return true
    const confirm = this.window?.confirm
    if (typeof confirm !== 'function') return false
    return confirm.call(
      this.window,
      `This drawing has unsaved changes. Discard them and ${action}?`,
    )
  }

  async _loadFile(file, { handle, commitGuard }) {
    try {
      const result = await this.editor.loader.loadFile(file, { handle, commitGuard })
      if (!result?.ok) return result || { ok: false }

      if (result.kind === 'native' && handle) await this._remember(handle)
      return result
    } catch (error) {
      this._reportError('Could not open the selected file.', error)
      return { ok: false, error }
    }
  }

  _captureSave() {
    const state = this.editor.documentState
    if (!state) throw new TypeError('Document state is not initialized.')
    const token = state.createSaveToken()
    const source = this.serialize(this.editor)
    return { source, token }
  }

  _beginDocumentReplacement() {
    const operationId = ++this._documentOperationId
    const state = this.editor.documentState
    state?.flushObservedMutations?.()
    const expectedSessionId = state?.sessionId
    const expectedRevision = state?.revision

    return () => {
      if (operationId !== this._documentOperationId) return false
      state?.flushObservedMutations?.()
      return !state || (
        state.sessionId === expectedSessionId
        && state.revision === expectedRevision
      )
    }
  }

  _captureSessionGuard() {
    const state = this.editor.documentState
    state?.flushObservedMutations?.()
    if (!state) return () => true
    const expected = state.snapshot()

    return () => {
      state.flushObservedMutations?.()
      return state.sessionId === expected.sessionId
        && state.revision === expected.revision
        && state.name === expected.name
        && state.handle === expected.handle
    }
  }

  _captureAssociationGuard(token) {
    const state = this.editor.documentState
    if (!state || !token) return () => true

    return () => {
      state.flushObservedMutations?.()
      return state.sessionId === token.sessionId
        && state.name === token.name
        && state.handle === token.handle
    }
  }

  _enqueueWrite(callback) {
    const pending = this._writeQueue
      .catch(() => undefined)
      .then(callback)
    this._writeQueue = pending.catch(() => undefined)
    return pending
  }

  async _writeCapturedToHandle(captured, handle, options = {}) {
    if (options.commitGuard && !options.commitGuard()) return this._staleCancellation()
    await this._requireWritePermission(handle)
    if (options.commitGuard && !options.commitGuard()) return this._staleCancellation()
    const writable = await handle.createWritable()
    if (options.commitGuard && !options.commitGuard()) {
      try { await writable.abort?.() } catch (_) { /* best-effort cleanup */ }
      return this._staleCancellation()
    }
    try {
      await writable.write(captured.source)
      await writable.close()
    } catch (error) {
      try { await writable.abort?.() } catch (_) { /* best-effort cleanup */ }
      throw error
    }

    const name = nativeSvgName(options.name || handle.name)
    const committed = this.editor.documentState.commitSave(captured.token, {
      name,
      handle,
    })
    if (committed && options.remember) await this._remember(handle)
    if (committed) this._reportSuccess(`Saved ${name}.`)
    return {
      ok: true,
      committed,
      stale: !committed,
      method: 'handle',
      name,
    }
  }

  async _requireWritePermission(handle) {
    if (!handle || typeof handle.createWritable !== 'function') throw permissionError()
    if (typeof handle.queryPermission !== 'function') return

    let permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') return
    if (typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'readwrite' })
      if (permission === 'granted') return
    }
    throw permissionError()
  }

  async _remember(handle) {
    try {
      await this.addRecentFile?.(handle)
    } catch (error) {
      console.warn('[DocumentController] Could not update recent files.', error)
    }
  }

  _download(source, filename) {
    const BlobConstructor = this.window?.Blob || globalThis.Blob
    const URLRef = this.window?.URL || globalThis.URL
    if (!BlobConstructor || typeof URLRef?.createObjectURL !== 'function') {
      throw new TypeError('File downloads are not supported by this browser.')
    }

    const blob = new BlobConstructor([source], { type: 'image/svg+xml' })
    const url = URLRef.createObjectURL(blob)
    const anchor = this.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.hidden = true

    try {
      this.document.body.appendChild(anchor)
      anchor.click()
    } finally {
      anchor.remove()
      URLRef.revokeObjectURL(url)
    }
  }

  _chooseUploadFile() {
    return new Promise((resolve, reject) => {
      const input = this.document.createElement('input')
      input.type = 'file'
      input.accept = '.svg,.dxf,image/svg+xml,image/vnd.dxf'
      input.hidden = true

      const cleanup = () => {
        input.removeEventListener('change', changed)
        input.removeEventListener('cancel', cancelled)
        input.remove()
      }
      const changed = () => {
        const file = input.files?.[0] || null
        cleanup()
        resolve(file)
      }
      const cancelled = () => {
        cleanup()
        resolve(null)
      }

      input.addEventListener('change', changed)
      input.addEventListener('cancel', cancelled)
      this.document.body.appendChild(input)
      try {
        input.click()
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  _cancelled(error) {
    return { ok: false, cancelled: true, ...(error ? { error } : {}) }
  }

  _staleCancellation() {
    return { ok: false, cancelled: true, stale: true }
  }

  _saveFailure(error, message) {
    if (isAbortError(error)) return this._cancelled(error)
    this._reportError(message, error)
    return { ok: false, error }
  }

  _reportSuccess(message) {
    try {
      this.editor.signals?.terminalLogged?.dispatch({ type: 'span', msg: message })
    } catch (error) {
      console.error('[DocumentController] A terminal listener failed:', error)
    }
  }

  _reportError(message, error) {
    console.error('[DocumentController]', message, error)
    try {
      this.editor.signals?.terminalLogged?.dispatch({ msg: message })
    } catch (signalError) {
      console.error('[DocumentController] A terminal listener failed:', signalError)
    }
  }
}

export {
  BLANK_DOCUMENT_SOURCE,
  createPresentationSvg,
  DocumentController,
  NATIVE_SVG_TYPES,
  OPEN_DOCUMENT_TYPES,
  isDxfFile,
  nativeSvgName,
}
