/**
 * WelcomeScreen — Blender-style welcome dialog for nanquim.
 *
 * Recent files are persisted as FileSystemFileHandle objects in IndexedDB.
 * The drawing content is deliberately not cached: opening a recent item always
 * reads the file currently on disk.
 */

const LEGACY_STORAGE_KEY = 'nanquim-recent-files'
const DATABASE_NAME = 'nanquim-recent-files'
const STORE_NAME = 'files'
const RECENT_LIMIT = 10

function WelcomeScreen(editor) {
  this.editor = editor
  this._overlay = null
  this._dismissState = null

  // Remove snapshots written by versions that cached the file contents.
  localStorage.removeItem(LEGACY_STORAGE_KEY)

  this.show()
}

// ── Public ──────────────────────────────────────────────────────────────────

WelcomeScreen.prototype.show = async function () {
  if (this._overlay) return           // already visible
  const overlay = document.createElement('div')
  overlay.id = 'welcome-overlay'
  overlay.className = 'welcome-overlay'
  const recentFiles = await getRecentFiles()
  overlay.innerHTML = _buildHTML(recentFiles, _canPersistFileHandles())

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) this.dismiss()
  })

  document.body.appendChild(overlay)
  this._overlay = overlay

  // Wire buttons
  overlay.querySelector('#ws-new').addEventListener('click', () => {
    this.dismiss()
    // new file = just start fresh (editor already blank on load)
  })

  overlay.querySelector('#ws-open').addEventListener('click', () => {
    this.dismiss()
    window.openSVG()
  })

  overlay.querySelector('#ws-dismiss').addEventListener('click', () => {
    this.dismiss()
  })

  // Recent file entries
  overlay.querySelectorAll('.ws-recent-item').forEach((item) => {
    const index = parseInt(item.dataset.index, 10)
    item._recentFile = recentFiles[index]
    item.addEventListener('click', () => {
      const recent = item._recentFile
      if (!recent) return
      _openRecentFile(recent, this.editor, this)
    })
  })

  // Dismiss on Escape
  this._keyHandler = (e) => { if (e.key === 'Escape') this.dismiss() }
  document.addEventListener('keydown', this._keyHandler)
}

WelcomeScreen.prototype.dismiss = function (onComplete) {
  const overlay = this._overlay
  if (!overlay) {
    if (onComplete) onComplete()
    return
  }

  const pendingDismissal = this._dismissState
  if (pendingDismissal?.overlay === overlay) {
    if (onComplete) pendingDismissal.callbacks.push(onComplete)
    if (!overlay.isConnected) pendingDismissal.finish()
    return
  }

  const dismissal = {
    overlay,
    callbacks: onComplete ? [onComplete] : [],
    finish: null,
  }
  const finish = (event) => {
    // The welcome dialog has its own entrance animation whose animationend
    // event bubbles through the overlay. Only the overlay fade-out completes
    // dismissal.
    if (event && event.target !== overlay) return

    overlay.removeEventListener('animationend', finish)
    overlay.remove()
    if (this._overlay === overlay) this._overlay = null
    if (this._dismissState === dismissal) this._dismissState = null

    const callbacks = dismissal.callbacks.splice(0)
    callbacks.forEach(callback => callback())
  }
  dismissal.finish = finish
  this._dismissState = dismissal

  overlay.classList.add('ws-fade-out')
  document.removeEventListener('keydown', this._keyHandler)
  overlay.addEventListener('animationend', finish)
  if (!overlay.isConnected) finish()
}

// ── Recent files helpers ─────────────────────────────────────────────────────

export async function getRecentFiles() {
  const db = await _openDatabase()
  if (!db) return []

  try {
    const files = await _getAll(db)
    return files.sort((a, b) => b.timestamp - a.timestamp)
  } catch {
    return []
  } finally {
    db.close()
  }
}

export async function addRecentFile(handle) {
  if (!handle) return
  const db = await _openDatabase()
  if (!db) return

  try {
    const existing = await _getAll(db)
    const matchingEntry = await _findMatchingEntry(existing, handle)
    const entry = {
      id: matchingEntry ? matchingEntry.id : crypto.randomUUID(),
      name: handle.name,
      handle,
      timestamp: Date.now(),
    }
    await _put(db, entry)

    const staleEntries = existing
      .filter(file => file.id !== entry.id)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(RECENT_LIMIT - 1)
    await Promise.all(staleEntries.map(file => _delete(db, file.id)))
  } finally {
    db.close()
  }
}

async function _findMatchingEntry(entries, handle) {
  for (const entry of entries) {
    try {
      if (await entry.handle.isSameEntry(handle)) return entry
    } catch (_) {
      // A stale handle cannot be compared; opening it will remove it.
    }
  }
  return null
}

async function _openRecentFile(recent, editor, welcomeScreen) {
  try {
    // Call this directly from the click handler so the browser treats it as a
    // user-initiated permission request. Asking for write access here also
    // enables a later Ctrl+S direct save without another prompt.
    const permission = await recent.handle.requestPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      editor.signals.terminalLogged.dispatch({ msg: `Access to ${recent.name} was not granted.` })
      return
    }

    const file = await recent.handle.getFile()
    editor.currentFileName = file.name
    editor.currentFileHandle = recent.handle
    welcomeScreen.dismiss()
    editor.loader.loadFile(file)
  } catch (error) {
    // A deleted or moved file has no valid handle anymore. Do not offer an old
    // drawing snapshot in its place.
    if (error.name === 'NotFoundError') {
      await _removeRecentFile(recent.id)
      welcomeScreen.dismiss(() => welcomeScreen.show())
      return
    }
    console.error('[WelcomeScreen] Failed to open recent file:', error)
    editor.signals.terminalLogged.dispatch({ msg: `Could not open ${recent.name}.` })
  }
}

function _openDatabase() {
  if (!window.indexedDB) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function _getAll(db) {
  return _request(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll())
}

function _put(db, entry) {
  return _request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entry))
}

function _delete(db, id) {
  return _request(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id))
}

function _request(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function _removeRecentFile(id) {
  const db = await _openDatabase()
  if (!db) return
  try {
    await _delete(db, id)
  } finally {
    db.close()
  }
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function _formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function _canPersistFileHandles() {
  return window.isSecureContext && typeof window.showOpenFilePicker === 'function'
}

function _buildHTML(recentFiles, canPersistFileHandles) {
  const recentHTML = recentFiles.length
    ? recentFiles.map((f, i) => /* html */`
        <div class="ws-recent-item" data-index="${i}" title="${f.name}">
          <span class="ws-recent-icon icon icon-canvas"></span>
          <span class="ws-recent-name">${_esc(f.name)}</span>
          <span class="ws-recent-date">${_formatDate(f.timestamp)}</span>
        </div>
      `).join('')
    : `<div class="ws-no-recent">${canPersistFileHandles
      ? 'No recent disk files. Files opened with Open File… or saved with Save SVG will appear here.'
      : 'Recent disk files require HTTPS or localhost and the File System Access API. This browser connection can only open files once.'
    }</div>`

  return /* html */`
    <div class="ws-dialog" id="ws-dialog">

      <!-- Left: logo + actions -->
      <div class="ws-left">
        <div class="ws-logo-area">
          <div class="ws-logo-icon-wrap">
            <span class="icon icon-nanquim-logo"></span>
          </div>
          <span class="ws-app-name">nanquim</span>
        </div>
        <p class="ws-tagline">SVG CAD editor</p>

        <div class="ws-actions">
          <button class="ws-btn" id="ws-new">
            <span class="icon icon-canvas ws-btn-icon"></span>
            New File
          </button>
          <button class="ws-btn" id="ws-open">
            <span class="icon icon-file-folder ws-btn-icon"></span>
            Open File…
          </button>
          <a
            class="ws-btn ws-btn-ghost"
            href="https://github.com/elschilling/nanquim"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg class="ws-github-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303
                3.438 9.8 8.205 11.385.6.113.82-.258.82-.577
                0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422
                18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729
                1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305
                3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93
                0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176
                0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405
                1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23
                3.285-1.23.645 1.653.24 2.873.12 3.176.765.84
                1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475
                5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015
                3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592
                24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
            GitHub
          </a>
        </div>

        <button class="ws-dismiss-btn" id="ws-dismiss">
          Close
        </button>
      </div>

      <!-- Right: recent files -->
      <div class="ws-right">
        <div class="ws-right-header">
          <span class="icon icon-open_recent ws-section-icon"></span>
          Recent Files
        </div>
        <div class="ws-recent-list">
          ${recentHTML}
        </div>
      </div>

    </div>
  `
}

function _esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export { WelcomeScreen }
