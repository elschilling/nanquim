import './styles/main.sass'
// import './js/libs/svg.js/svg.select.css'

import { Editor } from './js/Editor'
import { Navbar } from './js/Navbar'
import { Viewport } from './js/Viewport'
import { Outliner } from './js/Outliner'
import { Properties } from './js/Properties'
import { Terminal } from './js/Terminal'
import { StatusBar } from './js/StatusBar'
import { Preferences } from './js/PreferencesUI'
import { PaperEditor } from './js/PaperEditor'
import { WelcomeScreen } from './js/WelcomeScreen'
import { LinearDimensionCommand } from './js/commands/LinearDimensionCommand'

const editor = new Editor()
const navbar = new Navbar(editor)
const paperEditor = new PaperEditor(editor) // Initialize before Viewport
const viewport = new Viewport(editor)
const outliner = new Outliner(editor)
const properties = new Properties(editor)
const terminal = new Terminal(editor)
const statusbar = new StatusBar(editor)
const preferences = new Preferences(editor)

// Expose paperEditor on editor so commands and UI can access it
editor.paperEditor = paperEditor

// Initialize listeners
LinearDimensionCommand.registerRedrawListener(editor)

// Show welcome screen on startup
const welcomeScreen = new WelcomeScreen(editor)
window.welcomeScreen = welcomeScreen

// Reveal the app now that all modules are ready (pairs with visibility:hidden in index.html critical CSS)
document.body.style.visibility = 'visible'

window.editor = editor

// ── Editor Mode Switching ─────────────────────────────────────────────────
window.switchEditorMode = function(mode) {
  if (editor.mode === mode) return
  // Clear selection BEFORE changing mode so that panels (like Properties) don't crash 
  // trying to render outdated PaperViewport objects in Model mode logic.
  editor.signals.clearSelection.dispatch()

  editor.mode = mode

  // Update label and icon
  const label = document.getElementById('editor-mode-label')
  const icon = document.getElementById('editor-mode-icon')
  if (label) label.textContent = mode === 'paper' ? 'Paper Space' : 'Draw Space'
  if (icon) {
    icon.classList.remove('icon-mode-draw', 'icon-mode-paper')
    icon.classList.add(mode === 'paper' ? 'icon-mode-paper' : 'icon-mode-draw')
  }

  // Update active state on menu items
  document.querySelectorAll('.editor-mode-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode)
  })

  // Close dropdown
  const dd = document.getElementById('editor-mode-dropdown')
  if (dd) dd.classList.remove('show-menu')

  // Fire signal — PaperEditor and Properties listen to this
  editor.signals.editorModeChanged.dispatch(mode)
}

window.toggleEditorModeMenu = function(e) {
  e.stopPropagation()
  const dd = document.getElementById('editor-mode-dropdown')
  if (dd) dd.classList.toggle('show-menu')
}
