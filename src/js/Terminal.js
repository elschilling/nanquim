import commands from './commands/_commands'
import { RemoveElementCommand } from './commands/RemoveElementCommand'

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
      const elements = editor.selected.map(el => {
        const svg = el.node.outerHTML
        return { svg }
      })
      const payload = JSON.stringify({ nanquimClipboard: true, elements })
      navigator.clipboard.writeText(payload).then(() => {
        signals.terminalLogged.dispatch({ type: 'span', msg: `Copied ${elements.length} element(s) to clipboard.` })
      }).catch(() => {
        signals.terminalLogged.dispatch({ type: 'span', msg: 'Failed to copy to clipboard.' })
      })
      return
    }
    // Ctrl+V — Paste elements from clipboard
    if (e.ctrlKey && e.key === 'v' && !e.shiftKey) {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        let data
        try { data = JSON.parse(text) } catch { return }
        if (!data || !data.nanquimClipboard || !Array.isArray(data.elements)) return

        const pasted = []
        const SVG = editor.svg.constructor
        const parent = editor.activeCollection || editor.drawing

        data.elements.forEach(item => {
          // Parse the SVG fragment
          const temp = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          temp.innerHTML = item.svg
          const node = temp.firstElementChild
          if (!node) return

          // Add to parent and adopt into svg.js
          parent.node.appendChild(node)
          const el = SVG.adopt(node)

          // Assign new unique ID and name
          const newId = editor.elementIndex++
          el.attr('id', newId)
          const typeName = el.node.nodeName.charAt(0).toUpperCase() + el.node.nodeName.slice(1)
          el.attr('name', typeName + ' ' + newId)

          // Hydrate data- attributes into svg.js data store
          Array.from(node.attributes).forEach(attr => {
            if (attr.name.startsWith('data-')) {
              const key = attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
              try { el.data(key, JSON.parse(attr.value)) } catch { el.data(key, attr.value) }
            }
          })

          // For groups, hydrate children recursively
          const hydrateChildren = (parentEl) => {
            if (!parentEl.children) return
            parentEl.children().each(child => {
              const childId = editor.elementIndex++
              child.attr('id', childId)
              if (!child.attr('name')) {
                const cn = child.node.nodeName.charAt(0).toUpperCase() + child.node.nodeName.slice(1)
                child.attr('name', cn + ' ' + childId)
              }
              Array.from(child.node.attributes).forEach(attr => {
                if (attr.name.startsWith('data-')) {
                  const key = attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                  try { child.data(key, JSON.parse(attr.value)) } catch { child.data(key, attr.value) }
                }
              })
              if (child.type === 'g') hydrateChildren(child)
            })
          }
          if (el.type === 'g') hydrateChildren(el)

          pasted.push(el)
        })

        if (pasted.length > 0) {
          editor.spatialIndex.markDirty()
          signals.clearSelection.dispatch()
          editor.selected = pasted
          signals.updatedSelection.dispatch()
          signals.updatedOutliner.dispatch()
          signals.terminalLogged.dispatch({ type: 'span', msg: `Pasted ${pasted.length} element(s).` })
        }
      }).catch(() => {
        signals.terminalLogged.dispatch({ type: 'span', msg: 'Failed to read clipboard.' })
      })
      return
    }

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
