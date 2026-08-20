// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  BLANK_DOCUMENT_SOURCE,
  DocumentController,
} from '../src/js/DocumentController.js'
import { DocumentState } from '../src/js/document/DocumentState.js'
import { DOCUMENT_SCHEMA_VERSION } from '../src/js/document/DocumentSerializer.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function untilCalled(mock) {
  for (let attempt = 0; attempt < 20 && mock.mock.calls.length === 0; attempt += 1) {
    await Promise.resolve()
  }
  expect(mock).toHaveBeenCalled()
}

function createHandle(name = 'drawing.svg', overrides = {}) {
  const writable = {
    abort: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    write: vi.fn(async () => {}),
    ...overrides.writable,
  }
  return {
    name,
    createWritable: vi.fn(async () => writable),
    queryPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    ...overrides,
    writable,
  }
}

function createBrowser(overrides = {}) {
  const blobs = []
  const listeners = new Map()
  class CapturedBlob {
    constructor(parts, options) {
      this.parts = parts
      this.type = options?.type
      blobs.push(this)
    }
  }
  return {
    Blob: CapturedBlob,
    URL: {
      createObjectURL: vi.fn(() => 'blob:nanquim-test'),
      revokeObjectURL: vi.fn(),
    },
    addEventListener: vi.fn((name, listener) => listeners.set(name, listener)),
    confirm: vi.fn(() => true),
    removeEventListener: vi.fn((name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name)
    }),
    blobs,
    listeners,
    ...overrides,
  }
}

function createEditor({ dirty = true, handle = null, name = 'drawing.svg' } = {}) {
  const editor = {
    currentFileHandle: handle,
    currentFileName: name,
    drawing: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
    loader: {
      loadFile: vi.fn(),
      loadSource: vi.fn(),
    },
    signals: {
      documentStateChanged: { dispatch: vi.fn() },
      terminalLogged: { dispatch: vi.fn() },
    },
  }
  editor.documentState = new DocumentState(editor, {
    handle,
    name,
    observe: false,
  })
  if (dirty) editor.documentState.markChanged('test-edit')
  return editor
}

const controllers = []
const states = []

function createController(editor, options = {}) {
  const controller = new DocumentController(editor, options)
  controllers.push(controller)
  states.push(editor.documentState)
  return controller
}

describe('DocumentController', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose())
    states.splice(0).forEach((state) => state.disconnect())
    vi.restoreAllMocks()
  })

  test('direct Save writes canonical bytes once and cleans only after close', async () => {
    const closed = deferred()
    const handle = createHandle('plan.svg', {
      writable: { close: vi.fn(() => closed.promise) },
    })
    const editor = createEditor({ handle, name: 'plan.svg' })
    const serialize = vi.fn(() => '<svg data-canonical="true"/>')
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize,
      window: createBrowser(),
      document,
    })

    const pending = controller.save()
    await untilCalled(handle.writable.close)

    expect(handle.writable.write).toHaveBeenCalledWith('<svg data-canonical="true"/>')
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(editor.documentState.isDirty).toBe(true)
    expect(editor.documentState.fileHandle).toBe(handle)

    closed.resolve()
    await expect(pending).resolves.toMatchObject({
      ok: true,
      committed: true,
      method: 'handle',
    })
    expect(editor.documentState.isDirty).toBe(false)
  })

  test('Save As retargets only after write and close complete', async () => {
    const oldHandle = createHandle('old.svg')
    const close = deferred()
    const nextHandle = createHandle('next.svg', {
      writable: { close: vi.fn(() => close.promise) },
    })
    const addRecentFile = vi.fn(async () => {})
    const browser = createBrowser({
      showSaveFilePicker: vi.fn(async () => nextHandle),
    })
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile,
      serialize: vi.fn(() => '<svg/>'),
      window: browser,
      document,
    })

    const pending = controller.saveAs()
    await untilCalled(nextHandle.writable.close)
    expect(editor.documentState.fileHandle).toBe(oldHandle)
    expect(editor.documentState.fileName).toBe('old.svg')

    close.resolve()
    await expect(pending).resolves.toMatchObject({ ok: true, committed: true })
    expect(editor.documentState.fileHandle).toBe(nextHandle)
    expect(editor.documentState.fileName).toBe('next.svg')
    expect(addRecentFile).toHaveBeenCalledWith(nextHandle)
  })

  test('edits made while Save As writes stay dirty and prevent retargeting', async () => {
    const oldHandle = createHandle('old.svg')
    const write = deferred()
    const nextHandle = createHandle('next.svg', {
      writable: { write: vi.fn(() => write.promise) },
    })
    const addRecentFile = vi.fn()
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile,
      serialize: vi.fn(() => '<svg/>'),
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => nextHandle) }),
      document,
    })

    const pending = controller.saveAs()
    await untilCalled(nextHandle.writable.write)
    editor.documentState.markChanged('edit-during-save')
    write.resolve()

    await expect(pending).resolves.toMatchObject({
      ok: true,
      committed: false,
      stale: true,
    })
    expect(editor.documentState.isDirty).toBe(true)
    expect(editor.documentState.fileHandle).toBe(oldHandle)
    expect(editor.documentState.fileName).toBe('old.svg')
    expect(addRecentFile).not.toHaveBeenCalled()
  })

  test.each([
    ['the document is replaced', (editor) => editor.documentState.replaceSession({
      name: 'replacement.svg',
      handle: createHandle('replacement.svg'),
      dirty: true,
    })],
    ['the current document is edited', (editor) => editor.documentState.markChanged('picker-edit')],
  ])('does not capture or write after a pending Save As picker when %s', async (_label, change) => {
    const picker = deferred()
    const nextHandle = createHandle('picked-for-old-session.svg')
    const oldHandle = createHandle('old.svg')
    const serialize = vi.fn(() => '<svg data-session="unexpected"/>')
    const addRecentFile = vi.fn()
    const browser = createBrowser({ showSaveFilePicker: vi.fn(() => picker.promise) })
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile,
      serialize,
      window: browser,
      document,
    })

    const pending = controller.saveAs()
    expect(browser.showSaveFilePicker).toHaveBeenCalledOnce()
    change(editor)
    const changed = editor.documentState.snapshot()
    picker.resolve(nextHandle)

    await expect(pending).resolves.toMatchObject({
      ok: false,
      cancelled: true,
      stale: true,
    })
    expect(serialize).not.toHaveBeenCalled()
    expect(nextHandle.createWritable).not.toHaveBeenCalled()
    expect(addRecentFile).not.toHaveBeenCalled()
    expect(editor.documentState.snapshot()).toEqual(changed)
  })

  test('rechecks Save As after an asynchronous permission prompt and before creating a writer', async () => {
    const permission = deferred()
    const nextHandle = createHandle('next.svg', {
      queryPermission: vi.fn(() => permission.promise),
    })
    const editor = createEditor({ handle: createHandle('old.svg'), name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(() => '<svg/>'),
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => nextHandle) }),
      document,
    })

    const pending = controller.saveAs()
    await untilCalled(nextHandle.queryPermission)
    editor.documentState.markChanged('permission-prompt-edit')
    permission.resolve('granted')

    await expect(pending).resolves.toMatchObject({
      ok: false,
      cancelled: true,
      stale: true,
    })
    expect(nextHandle.createWritable).not.toHaveBeenCalled()
    expect(editor.documentState.isDirty).toBe(true)
  })

  test('serializes concurrent writes so the clean revision is the last one on disk', async () => {
    const firstClose = deferred()
    let disk = null
    const writableFor = (gate = null) => {
      let buffered = null
      return {
        abort: vi.fn(async () => {}),
        write: vi.fn(async (source) => { buffered = source }),
        close: vi.fn(async () => {
          if (gate) await gate.promise
          disk = buffered
        }),
      }
    }
    const firstWritable = writableFor(firstClose)
    const secondWritable = writableFor()
    const handle = createHandle('shared.svg', {
      createWritable: vi.fn()
        .mockResolvedValueOnce(firstWritable)
        .mockResolvedValueOnce(secondWritable),
    })
    const editor = createEditor({ handle, name: 'shared.svg' })
    const serialize = vi.fn()
      .mockReturnValueOnce('<svg data-revision="first"/>')
      .mockReturnValueOnce('<svg data-revision="second"/>')
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize,
      window: createBrowser(),
      document,
    })

    const firstSave = controller.save()
    await untilCalled(firstWritable.close)
    editor.documentState.markChanged('edit-before-second-save')
    const secondSave = controller.save()

    await Promise.resolve()
    expect(handle.createWritable).toHaveBeenCalledTimes(1)
    firstClose.resolve()
    await expect(firstSave).resolves.toMatchObject({ ok: true, stale: true })
    await expect(secondSave).resolves.toMatchObject({ ok: true, committed: true })

    expect(disk).toBe('<svg data-revision="second"/>')
    expect(editor.documentState.isDirty).toBe(false)
  })

  test('a queued Save cannot write or restore an old association after Save As retargets the document', async () => {
    const saveAsClose = deferred()
    const oldHandle = createHandle('old.svg')
    const nextHandle = createHandle('next.svg', {
      writable: { close: vi.fn(() => saveAsClose.promise) },
    })
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(() => '<svg data-revision="same"/>'),
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => nextHandle) }),
      document,
    })

    const saveAs = controller.saveAs()
    await untilCalled(nextHandle.writable.close)
    const queuedSave = controller.save()
    saveAsClose.resolve()

    await expect(saveAs).resolves.toMatchObject({ committed: true })
    await expect(queuedSave).resolves.toMatchObject({
      ok: false,
      cancelled: true,
      stale: true,
    })
    expect(oldHandle.createWritable).not.toHaveBeenCalled()
    expect(oldHandle.writable.write).not.toHaveBeenCalled()
    expect(editor.documentState.snapshot()).toMatchObject({
      name: 'next.svg',
      handle: nextHandle,
      isDirty: false,
    })
  })

  test('a completed direct Save does not cancel a pending Save As for unchanged content', async () => {
    const directClose = deferred()
    const oldHandle = createHandle('old.svg', {
      writable: { close: vi.fn(() => directClose.promise) },
    })
    const nextHandle = createHandle('next.svg')
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(() => '<svg data-revision="same"/>'),
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => nextHandle) }),
      document,
    })

    const directSave = controller.save()
    await untilCalled(oldHandle.writable.close)
    const saveAs = controller.saveAs()
    directClose.resolve()

    await expect(directSave).resolves.toMatchObject({ ok: true, committed: true })
    await expect(saveAs).resolves.toMatchObject({ ok: true, committed: true })
    expect(nextHandle.writable.write).toHaveBeenCalledWith('<svg data-revision="same"/>')
    expect(editor.documentState.snapshot()).toMatchObject({
      name: 'next.svg',
      handle: nextHandle,
      isDirty: false,
    })
  })

  test('a completed save from an obsolete session cannot clean or retarget it', async () => {
    const write = deferred()
    const pickedHandle = createHandle('picked.svg', {
      writable: { write: vi.fn(() => write.promise) },
    })
    const replacementHandle = createHandle('replacement.svg')
    const editor = createEditor({ handle: createHandle('old.svg'), name: 'old.svg' })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(() => '<svg/>'),
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => pickedHandle) }),
      document,
    })

    const pending = controller.saveAs()
    await untilCalled(pickedHandle.writable.write)
    editor.documentState.replaceSession({
      name: 'replacement.svg',
      handle: replacementHandle,
      dirty: true,
    })
    write.resolve()

    await expect(pending).resolves.toMatchObject({ ok: true, stale: true })
    expect(editor.documentState.snapshot()).toMatchObject({
      name: 'replacement.svg',
      handle: replacementHandle,
      isDirty: true,
    })
  })

  test('picker cancellation does not serialize or change the current session', async () => {
    const abort = new Error('cancelled')
    abort.name = 'AbortError'
    const oldHandle = createHandle('old.svg')
    const browser = createBrowser({
      showSaveFilePicker: vi.fn(async () => { throw abort }),
    })
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const before = editor.documentState.snapshot()
    const serialize = vi.fn(() => '<svg/>')
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize,
      window: browser,
      document,
    })

    await expect(controller.saveAs()).resolves.toMatchObject({
      ok: false,
      cancelled: true,
    })
    expect(serialize).not.toHaveBeenCalled()
    expect(editor.documentState.snapshot()).toEqual(before)
  })

  test.each([
    ['permission denial', (handle) => {
      handle.queryPermission.mockResolvedValue('denied')
      handle.requestPermission.mockResolvedValue('denied')
    }],
    ['write failure', (handle) => {
      handle.writable.write.mockRejectedValue(new Error('write failed'))
    }],
    ['close failure', (handle) => {
      handle.writable.close.mockRejectedValue(new Error('close failed'))
    }],
  ])('%s preserves dirty state and the previous handle', async (_label, arrange) => {
    const oldHandle = createHandle('old.svg')
    const nextHandle = createHandle('next.svg')
    arrange(nextHandle)
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    const before = editor.documentState.snapshot()
    const serialize = vi.fn(() => '<svg/>')
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize,
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => nextHandle) }),
      document,
    })

    await expect(controller.saveAs()).resolves.toMatchObject({ ok: false })
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(editor.documentState.snapshot()).toEqual(before)
    expect(editor.documentState.fileHandle).toBe(oldHandle)
  })

  test('fallback Save downloads the same canonical bytes and retains no handle', async () => {
    const canonical = '<svg data-canonical="same"/>'
    const directHandle = createHandle('direct.svg')
    const directEditor = createEditor({ handle: directHandle, name: 'direct.svg' })
    const directSerialize = vi.fn(() => canonical)
    const directController = createController(directEditor, {
      addRecentFile: vi.fn(),
      serialize: directSerialize,
      window: createBrowser(),
      document,
    })
    await directController.save()

    const downloadBrowser = createBrowser()
    const fallbackEditor = createEditor({ handle: null, name: 'drawing.svg' })
    const fallbackSerialize = vi.fn(() => canonical)
    const fallbackController = createController(fallbackEditor, {
      addRecentFile: vi.fn(),
      serialize: fallbackSerialize,
      window: downloadBrowser,
      document,
    })
    await expect(fallbackController.save()).resolves.toMatchObject({
      ok: true,
      committed: false,
      unverified: true,
      method: 'download',
    })

    expect(directHandle.writable.write).toHaveBeenCalledWith(canonical)
    expect(downloadBrowser.blobs[0].parts).toEqual([canonical])
    expect(directSerialize).toHaveBeenCalledTimes(1)
    expect(fallbackSerialize).toHaveBeenCalledTimes(1)
    expect(fallbackEditor.documentState.fileHandle).toBeNull()
    expect(fallbackEditor.documentState.isDirty).toBe(true)
  })

  test('post-write UI listener failures cannot reclassify a committed Save As', async () => {
    const nextHandle = createHandle('next.svg')
    const editor = createEditor({ handle: createHandle('old.svg'), name: 'old.svg' })
    editor.signals.documentStateChanged.dispatch = vi.fn(() => {
      throw new Error('state listener failed')
    })
    editor.signals.terminalLogged.dispatch = vi.fn(() => {
      throw new Error('terminal listener failed')
    })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(() => '<svg data-canonical="true"/>'),
      window: createBrowser({ showSaveFilePicker: vi.fn(async () => nextHandle) }),
      document,
    })

    await expect(controller.saveAs()).resolves.toMatchObject({
      ok: true,
      committed: true,
      method: 'handle',
    })
    expect(nextHandle.writable.write).toHaveBeenCalledWith('<svg data-canonical="true"/>')
    expect(editor.documentState.snapshot()).toMatchObject({
      name: 'next.svg',
      handle: nextHandle,
      isDirty: false,
    })
  })

  test('SVG export downloads a copy without cleaning or replacing the document handle', async () => {
    const handle = createHandle('editable.svg')
    const editor = createEditor({ handle, name: 'editable.svg' })
    const before = editor.documentState.snapshot()
    const browser = createBrowser()
    const serialize = vi.fn(() => '<svg data-export="true"/>')
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize,
      window: browser,
      document,
    })

    await expect(controller.exportSvg()).resolves.toMatchObject({
      ok: true,
      method: 'download',
    })
    const exported = new DOMParser().parseFromString(browser.blobs[0].parts[0], 'image/svg+xml')
    expect(exported.querySelector('parsererror')).toBeNull()
    expect(exported.documentElement.hasAttribute('data-export')).toBe(false)
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(editor.documentState.snapshot()).toEqual(before)
  })

  test('SVG export creates a markerless presentation copy and converts white paint on the clone', async () => {
    const editor = createEditor()
    const before = editor.documentState.snapshot()
    const browser = createBrowser()
    const serialize = vi.fn(() => [
      '<svg xmlns="http://www.w3.org/2000/svg" data-nanquim-version="3" data-paper-config="{}">',
      '<metadata id="nanquim-geometry-nodes">{}</metadata>',
      '<g data-nanquim-paper-annotations="true"><text>Paper only</text></g>',
      '<g data-collection="true" style="stroke:white;fill:var(--editor-text-color)">',
      '<line stroke="#fff"/><circle fill="#112233"/>',
      '</g>',
      '</svg>',
    ].join(''))
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize,
      window: browser,
      document,
    })

    await expect(controller.exportSvg()).resolves.toMatchObject({ ok: true })
    const root = new DOMParser()
      .parseFromString(browser.blobs[0].parts[0], 'image/svg+xml')
      .documentElement
    expect(root.hasAttribute('data-nanquim-version')).toBe(false)
    expect(root.hasAttribute('data-paper-config')).toBe(false)
    expect(root.querySelector('metadata')).toBeNull()
    expect(root.querySelector('[data-nanquim-paper-annotations]')).toBeNull()
    expect(root.querySelector('[data-collection]').style.stroke).toBe('rgb(0, 0, 0)')
    expect(root.querySelector('[data-collection]').style.fill).toBe('rgb(0, 0, 0)')
    expect(root.querySelector('line').getAttribute('stroke')).toBe('#000000')
    expect(root.querySelector('circle').getAttribute('fill')).toBe('#112233')
    expect(editor.documentState.snapshot()).toEqual(before)
  })

  test('Open confirms dirty loss and delegates native/DXF association to the loader', async () => {
    const oldHandle = createHandle('old.svg')
    const dxfHandle = createHandle('import.dxf')
    const file = { name: 'import.dxf', type: 'image/vnd.dxf' }
    dxfHandle.getFile = vi.fn(async () => file)
    const browser = createBrowser({
      confirm: vi.fn(() => true),
      showOpenFilePicker: vi.fn(async () => [dxfHandle]),
    })
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    editor.loader.loadFile.mockImplementation(async (selected, { handle }) => {
      editor.documentState.replaceSession({ name: selected.name, handle, dirty: true })
      return { ok: true, kind: 'dxf', dirty: true }
    })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(),
      window: browser,
      document,
    })

    await expect(controller.open()).resolves.toMatchObject({ ok: true, kind: 'dxf' })
    expect(browser.confirm).toHaveBeenCalledTimes(1)
    expect(editor.loader.loadFile).toHaveBeenCalledWith(file, {
      handle: null,
      commitGuard: expect.any(Function),
    })
    expect(editor.documentState.fileHandle).toBeNull()
    expect(editor.documentState.fileName).toBe('import.dxf')
  })

  test('declining dirty Open leaves the loader and session untouched', async () => {
    const handle = createHandle('old.svg')
    const browser = createBrowser({ confirm: vi.fn(() => false) })
    const editor = createEditor({ handle, name: 'old.svg' })
    const before = editor.documentState.snapshot()
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(),
      window: browser,
      document,
    })

    await expect(controller.open()).resolves.toMatchObject({ cancelled: true })
    expect(editor.loader.loadFile).not.toHaveBeenCalled()
    expect(editor.documentState.snapshot()).toEqual(before)
  })

  test('New confirms dirty loss and delegates a clean schema-v3 source', async () => {
    const browser = createBrowser({ confirm: vi.fn(() => true) })
    const editor = createEditor({ handle: createHandle('old.svg'), name: 'old.svg' })
    editor.loader.loadSource.mockImplementation(async (_source, options) => {
      editor.documentState.replaceSession({ name: options.name, handle: options.handle })
      return { ok: true, kind: 'native', dirty: false }
    })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(),
      window: browser,
      document,
    })

    await expect(controller.newDocument()).resolves.toMatchObject({ ok: true })
    expect(editor.loader.loadSource).toHaveBeenCalledWith(
      BLANK_DOCUMENT_SOURCE,
      expect.objectContaining({
        handle: null,
        name: 'Untitled.svg',
        commitGuard: expect.any(Function),
      }),
    )
    const parsed = new DOMParser().parseFromString(BLANK_DOCUMENT_SOURCE, 'image/svg+xml')
    expect(parsed.documentElement.getAttribute('data-nanquim-version'))
      .toBe(String(DOCUMENT_SCHEMA_VERSION))
    expect(parsed.documentElement.getAttribute('viewBox')).toBe('-5 -5 10 10')
    expect(editor.documentState.snapshot()).toMatchObject({
      handle: null,
      isDirty: false,
      name: 'Untitled.svg',
    })
  })

  test('an edit during Open invalidates its commit before the loader mutates the session', async () => {
    const loading = deferred()
    const file = { name: 'incoming.svg', type: 'image/svg+xml' }
    const oldHandle = createHandle('old.svg')
    const editor = createEditor({ handle: oldHandle, name: 'old.svg' })
    editor.documentState.observePersistentRoot(editor.drawing)
    let pendingGuard = null
    editor.loader.loadFile.mockImplementation(async (selected, { handle, commitGuard }) => {
      pendingGuard = commitGuard
      await loading.promise
      if (!commitGuard()) return { ok: false, cancelled: true, stale: true }
      editor.documentState.replaceSession({ name: selected.name, handle, dirty: false })
      return { ok: true, kind: 'native', dirty: false }
    })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(),
      window: createBrowser({ confirm: vi.fn(() => true) }),
      document,
    })

    const pending = controller.openFile(file, { handle: createHandle('incoming.svg') })
    await untilCalled(editor.loader.loadFile)
    editor.drawing.appendChild(document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    ))
    expect(pendingGuard()).toBe(false)
    loading.resolve()

    await expect(pending).resolves.toMatchObject({ ok: false, stale: true })
    expect(editor.documentState.snapshot()).toMatchObject({
      name: 'old.svg',
      handle: oldHandle,
      isDirty: true,
    })
  })

  test('only the latest overlapping Open may commit even when the older one resolves first', async () => {
    const firstReady = deferred()
    const secondReady = deferred()
    const firstFile = { name: 'first.svg', type: 'image/svg+xml' }
    const secondFile = { name: 'second.svg', type: 'image/svg+xml' }
    const secondHandle = createHandle('second.svg')
    const editor = createEditor({ handle: createHandle('old.svg'), name: 'old.svg' })
    editor.loader.loadFile.mockImplementation(async (selected, { handle, commitGuard }) => {
      await (selected === firstFile ? firstReady.promise : secondReady.promise)
      if (!commitGuard()) return { ok: false, cancelled: true, stale: true }
      editor.documentState.replaceSession({ name: selected.name, handle, dirty: false })
      return { ok: true, kind: 'native', dirty: false }
    })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(),
      window: createBrowser({ confirm: vi.fn(() => true) }),
      document,
    })

    const firstOpen = controller.openFile(firstFile, { handle: createHandle('first.svg') })
    const secondOpen = controller.openFile(secondFile, { handle: secondHandle })
    firstReady.resolve()
    await expect(firstOpen).resolves.toMatchObject({ ok: false, stale: true })
    secondReady.resolve()
    await expect(secondOpen).resolves.toMatchObject({ ok: true })

    expect(editor.documentState.snapshot()).toMatchObject({
      name: 'second.svg',
      handle: secondHandle,
      isDirty: false,
    })
  })

  test('beforeunload is conditional on dirty state and is removed on dispose', () => {
    const browser = createBrowser()
    const editor = createEditor({ dirty: false })
    const controller = createController(editor, {
      addRecentFile: vi.fn(),
      serialize: vi.fn(),
      window: browser,
      document,
    })
    const listener = browser.listeners.get('beforeunload')
    const cleanEvent = { preventDefault: vi.fn(), returnValue: undefined }
    listener(cleanEvent)
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled()

    editor.documentState.markChanged('edit')
    const dirtyEvent = { preventDefault: vi.fn(), returnValue: undefined }
    expect(listener(dirtyEvent)).toBe('')
    expect(dirtyEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(dirtyEvent.returnValue).toBe('')

    controller.dispose()
    expect(browser.listeners.has('beforeunload')).toBe(false)
  })
})
