/**
 * WelcomeScreen — Blender-style welcome dialog for nanquim.
 *
 * Recent files are persisted in localStorage under the key
 * "nanquim-recent-files" as a JSON array of { name, dataURL } objects
 * (max RECENT_LIMIT entries, newest first).
 */

const STORAGE_KEY = 'nanquim-recent-files'
const RECENT_LIMIT = 10

function WelcomeScreen(editor) {
  this.editor = editor
  this._overlay = null

  // Listen to the loader so we can track freshly-opened files
  const origLoadFile = editor.loader.loadFile.bind(editor.loader)
  editor.loader.loadFile = (file) => {
    editor.currentFileName = file.name
    _trackFile(file)
    origLoadFile(file)
  }

  this.show()
}

// ── Public ──────────────────────────────────────────────────────────────────

WelcomeScreen.prototype.show = function () {
  if (this._overlay) return           // already visible
  const overlay = document.createElement('div')
  overlay.id = 'welcome-overlay'
  overlay.className = 'welcome-overlay'
  overlay.innerHTML = _buildHTML(getRecentFiles())

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
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index, 10)
      const recent = getRecentFiles()[index]
      if (!recent) return
      this.dismiss()
      _loadFromDataURL(recent.dataURL, recent.name, editor)
    })
  })

  // Dismiss on Escape
  this._keyHandler = (e) => { if (e.key === 'Escape') this.dismiss() }
  document.addEventListener('keydown', this._keyHandler)
}

WelcomeScreen.prototype.dismiss = function () {
  if (!this._overlay) return
  this._overlay.classList.add('ws-fade-out')
  document.removeEventListener('keydown', this._keyHandler)
  this._overlay.addEventListener('animationend', () => {
    this._overlay.remove()
    this._overlay = null
  }, { once: true })
}

// ── Recent files helpers ─────────────────────────────────────────────────────

export function getRecentFiles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function addRecentFile(name, dataURL) {
  let list = getRecentFiles().filter(f => f.name !== name)
  list.unshift({ name, dataURL, timestamp: Date.now() })
  if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT)
  // Retry with progressively fewer entries if storage quota is exceeded
  while (list.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        list.pop() // drop the oldest entry and try again
      } else {
        throw e
      }
    }
  }
}

function _trackFile(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    addRecentFile(file.name, e.target.result)
  }
  reader.readAsDataURL(file)
}

function _loadFromDataURL(dataURL, name, editor) {
  // Convert data-URL → Blob → File then hand to the existing loader
  fetch(dataURL)
    .then(r => r.blob())
    .then(blob => {
      const file = new File([blob], name)
      editor.loader.loadFile(file)
    })
    .catch(err => console.error('[WelcomeScreen] Failed to load recent file:', err))
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function _formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function _buildHTML(recentFiles) {
  const recentHTML = recentFiles.length
    ? recentFiles.map((f, i) => /* html */`
        <div class="ws-recent-item" data-index="${i}" title="${f.name}">
          <span class="ws-recent-icon icon icon-canvas"></span>
          <span class="ws-recent-name">${_esc(f.name)}</span>
          <span class="ws-recent-date">${_formatDate(f.timestamp)}</span>
        </div>
      `).join('')
    : `<div class="ws-no-recent">No recently opened files.</div>`

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
