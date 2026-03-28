import commands from './commands/_commands'
import { RemoveElementCommand } from './commands/RemoveElementCommand'
import { SVG } from '@svgdotjs/svg.js'


function isNumericString(str) {
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(str)
}

function Terminal(editor) {
  const signals = editor.signals

  let terminalText = document.getElementById('terminalInput')
  let terminalLog = document.getElementById('terminalLog')

  signals.updatedCoordinates.add((coordinates) => {
    editor.coordinates = coordinates
  })

  signals.terminalLogged.add((e) => {
    const node = document.createElement(e.type)
    node.textContent = e.msg
    terminalLog.appendChild(node)
    terminalLog.scrollTop = terminalLog.scrollHeight
    if (e.clearSelection) {
      signals.clearSelection.dispatch()
    }
  })

  document.addEventListener('keydown', handleInput)
  document.addEventListener('keyup', handleKeyUp)

  // Native paste event — fires reliably cross-tab/cross-instance
  // A guard prevents double-paste when both this event and the Ctrl+V
  // Clipboard API path below fire for the same keypress.
  let pasteHandledByNativeEvent = false
  document.addEventListener('paste', (e) => {
    const activeElement = document.activeElement
    if (activeElement && (activeElement.classList.contains('property-input') || activeElement.classList.contains('prefs-input'))) return
    const text = e.clipboardData && e.clipboardData.getData('text')
    if (text) {
      e.preventDefault()
      pasteHandledByNativeEvent = true
      processPastedText(text)
      // Reset the guard after the synchronous event loop so the Clipboard API
      // promise (which resolves asynchronously) can check it.
      setTimeout(() => { pasteHandledByNativeEvent = false }, 0)
    }
  })

  function handleInput(e) {
    if (e.code === 'F3' || e.code === 'F8' || e.code === 'F9' || e.code === 'F10') {
      e.preventDefault()
    }

    // Ctrl+S — Save SVG
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault()
      if (window.saveSVG) window.saveSVG()
      return
    }
    // Ctrl+O — Open SVG
    if (e.ctrlKey && e.key === 'o') {
      e.preventDefault()
      if (window.openSVG) window.openSVG()
      return
    }
    // Ctrl+C — Copy selected elements to clipboard
    if (e.ctrlKey && e.key === 'c' && !e.shiftKey) {
      if (editor.selected.length === 0) return
      e.preventDefault()
      const serializer = new XMLSerializer()
      const elements = editor.selected.map(el => {
        const svg = serializer.serializeToString(el.node)
        return { svg }
      })
      const payload = JSON.stringify({ nanquimClipboard: true, elements })
      signals.terminalLogged.dispatch({ type: 'span', msg: `[Debug] selected: ${editor.selected.length}, payload: ${payload.length} bytes` })
      navigator.clipboard.writeText(payload).then(() => {
        signals.terminalLogged.dispatch({ type: 'span', msg: `Copied ${elements.length} element(s) to clipboard.` })
      }).catch(() => {
        signals.terminalLogged.dispatch({ type: 'span', msg: 'Failed to copy to clipboard.' })
      })
      return
    }
    // Ctrl+V — Paste elements from clipboard
    // The native 'paste' event fires first and handles cross-tab cases.
    // This Clipboard API path handles same-tab Ctrl+V in browsers where
    // the paste event does not carry text (e.g. programmatic invocation).
    if (e.ctrlKey && e.key === 'v' && !e.shiftKey) {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        if (pasteHandledByNativeEvent) return // already handled by the paste event
        processPastedText(text)
      }).catch(() => {
        // Silently ignore: the native paste event above already handled it
        // (or the user hasn't granted clipboard-read permission).
      })
      return
    }

    // Don't intercept keystrokes while a property/prefs input has focus
    const activeEl = document.activeElement
    if (activeEl && (activeEl.classList.contains('property-input') || activeEl.classList.contains('prefs-input'))) return

    // ── Input Handling (on keydown to intercept Space/Enter correctly) ──
    const isConfirmKey = (e.code === 'Enter' || e.code === 'NumpadEnter') || (e.code === 'Space' && !editor.isTypingText)
    const inputVal = editor.isTypingText ? terminalText.value : terminalText.value.trim()

    if (editor.isInteracting || editor.isDrawing) {
      if (isConfirmKey) {
        e.preventDefault()
        
        // Interaction (Commands using promises/signals) takes priority
        if (editor.isInteracting) {
          if (editor.isTypingText) {
            editor.signals.inputValue.dispatch(inputVal)
          } else if (isNumericString(inputVal)) {
            editor.signals.inputValue.dispatch(inputVal)
          } else if (inputVal.startsWith('@') || inputVal.includes(',')) {
            const raw = inputVal.startsWith('@') ? inputVal.substring(1) : inputVal
            const coords = raw.split(',')
            if (coords.length === 2) {
              const x = parseFloat(coords[0]), y = parseFloat(coords[1])
              if (!isNaN(x) && !isNaN(y)) {
                editor.inputCoord = { x, y }
                editor.signals.coordinateInput.dispatch()
              }
            }
          } else {
            editor.signals.inputValue.dispatch(inputVal)
          }
        }

        // Drawing (Direct SVG manipulation tools) follow
        if (editor.isDrawing) {
          const activeSvg = editor.mode === 'paper' ? editor.paperSvg : editor.svg
          if (isNumericString(inputVal)) {
            editor.length = inputVal
            activeSvg.fire('valueInput')
          } else if (inputVal.startsWith('@')) {
            const coords = inputVal.substring(1).split(',')
            if (coords.length === 2) {
              const x = parseFloat(coords[0]), y = parseFloat(coords[1])
              if (!isNaN(x) && !isNaN(y)) {
                editor.inputCoord = { x, y }
                activeSvg.fire('coordinateInput')
              }
            }
          }
        }
        terminalText.value = ''
        return
      }
    } else {
      // Normal mode command execution
      if (isConfirmKey) {
        if (e.code === 'Space' && inputVal === '') {
          if (editor.lastCommand) {
            e.preventDefault()
            editor.lastCommand.execute()
          }
          return
        }
        if (inputVal !== '') {
          e.preventDefault()
          const typed = inputVal.toLowerCase()
          for (const [command, { execute, aliases }] of Object.entries(commands)) {
            if (aliases.includes(typed)) {
              signals.commandCancelled.dispatch()
              editor.lastCommand = { execute: () => execute(editor) }
              execute(editor)
              terminalText.value = ''
              return
            }
          }
        }
      }
    }

    // Global focus management
    const activeElement = document.activeElement
    if (activeElement && (activeElement.classList.contains('property-input') || activeElement.classList.contains('prefs-input'))) {
      return
    }
    terminalText.focus()
  }

  function processPastedText(text) {
    let data
    try { data = JSON.parse(text) } catch (err) {
      signals.terminalLogged.dispatch({ type: 'span', msg: `[Debug] paste JSON parse failed: ${err.message} (text length: ${text.length})` })
      return
    }
    if (!data || !data.nanquimClipboard || !Array.isArray(data.elements)) {
      signals.terminalLogged.dispatch({ type: 'span', msg: `[Debug] paste: not a nanquim clipboard payload` })
      return
    }
    signals.terminalLogged.dispatch({ type: 'span', msg: `[Debug] pasting ${data.elements.length} element(s) from ${text.length}-byte clipboard` })
    import('./commands/PasteCommand.js').then(({ PasteCommand }) => {
      try {
        editor.execute(new PasteCommand(editor, data))
      } catch (e) {
        signals.terminalLogged.dispatch({ type: 'span', msg: `[Error] Paste failed: ${e.message}` })
        console.error(e)
      }
    })
  }

  function handleKeyUp(e) {
    if (e.code === 'Escape') {
      if (editor.isEditingVertex) {
        editor.editingVertices.forEach((v) => {
          const element = v.element
          const vertexIndex = v.vertexIndex
          const oldPos = v.originalPosition
          if (element.type === 'line') {
            if (vertexIndex === 0) element.plot(oldPos.x, oldPos.y, element.node.x2.baseVal.value, element.node.y2.baseVal.value)
            else element.plot(element.node.x1.baseVal.value, element.node.y1.baseVal.value, oldPos.x, oldPos.y)
          } else if (element.type === 'circle') {
            element.center(oldPos.cx, oldPos.cy)
            element.radius(oldPos.r)
          }
        })
        signals.vertexEditStopped.dispatch()
        signals.updatedSelection.dispatch()
        return
      }

      terminalText.value = ''
      editor.isDrawing = false
      editor.isSelecting = false
      editor.isInteracting = false
      editor.isTypingText = false
      editor.selectSingleElement = false
      editor.svg.fire('cancelDrawing', e)
      signals.commandCancelled.dispatch()
      signals.clearSelection.dispatch()
      editor.selected = []
      signals.updatedProperties.dispatch()
    } else if (e.code === 'F3') {
      handleToogleOverlay()
    } else if (e.code === 'F8') {
      handleToogleOrtho()
    } else if (e.code === 'F9') {
      handleToogleSnap()
    } else if (e.code === 'F10') {
      e.preventDefault()
      handleTogglePolarTracking()
    } else if (e.code === 'Delete') {
      if (editor.selected.length > 0) {
        const toDelete = [...editor.selected]
        signals.clearSelection.dispatch()
        editor.selected = []
        import('./commands/MultiRemoveElementCommand.js').then(({ MultiRemoveElementCommand }) => {
          editor.execute(new MultiRemoveElementCommand(editor, toDelete))
        })
      }
    } else if (e.code === 'KeyZ' && e.ctrlKey) {
      if (e.shiftKey) editor.redo()
      else editor.undo()
    }
  }
}

export { Terminal }
