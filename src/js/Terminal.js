import commands from './commands/_commands'
import { RemoveElementCommand } from './commands/RemoveElementCommand'

function isNumericString(str) {
  return /^\d+(\.\d+)?$/.test(str)
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
    // Don't auto-focus terminal if user is editing a property input
    const activeElement = document.activeElement
    if (activeElement && activeElement.classList.contains('property-input')) {
      return
    }
    terminalInput.focus()
  }

  function handleKeyUp(e) {
    console.log('editor.lastCommand', editor.lastCommand)
    console.log('editor.isDrawing', editor.isDrawing)
    console.log('editor.isInteracting', editor.isInteracting)
    if (!editor.isDrawing && !editor.isInteracting && e.code === 'Space' && terminalInput.value.trim() === '') {
      // const lastCommand = editor.history.undos[editor.history.undos.length - 1]
      if (editor.lastCommand) {
        console.log('call last command')
        editor.lastCommand.execute()
      }
    } else if (
      (!editor.isDrawing && !editor.isInteracting && e.code === 'Space') ||
      (!editor.isDrawing && !editor.isInteracting && e.code === 'Enter') ||
      e.code === 'NumpadEnter'
    ) {
      const typedCommand = terminalInput.value.trim().toLowerCase()

      for (const [command, { execute, aliases }] of Object.entries(commands)) {
        if (aliases.includes(typedCommand)) {
          // Cancel any active command before starting a new one
          signals.commandCancelled.dispatch()

          // Set default repeat behavior: execute the command factory again
          // Individual commands can override this if they want to reuse the instance
          editor.lastCommand = { execute: () => execute(editor) }

          // Execute the command function
          execute(editor)
          // Clear input after execution
          terminalText.value = ''
          return // Exit the loop after executing the command
        }
      }
      // If no matching command or alias found
      console.log('Command not found')
    } else if (e.code === 'Escape') {
      console.log('Escape')

      // Cancel vertex editing if active
      // Cancel vertex editing if active
      if (editor.isEditingVertex) {
        editor.editingVertices.forEach((v) => {
          const element = v.element
          const vertexIndex = v.vertexIndex
          const oldPos = v.originalPosition

          if (element.type === 'line') {
            // Restore original position
            if (vertexIndex === 0) {
              element.plot(oldPos.x, oldPos.y, element.node.x2.baseVal.value, element.node.y2.baseVal.value)
            } else {
              element.plot(element.node.x1.baseVal.value, element.node.y1.baseVal.value, oldPos.x, oldPos.y)
            }
          } else if (element.type === 'circle') {
            element.center(oldPos.cx, oldPos.cy)
            element.radius(oldPos.r)
          }
        })

        signals.vertexEditStopped.dispatch()
        signals.updatedSelection.dispatch() // Redraw handlers at original position
        return
      }

      terminalText.value = ''
      editor.svg.fire('cancelDrawing', e)
      signals.commandCancelled.dispatch()
      signals.clearSelection.dispatch()
      editor.selected = []
      signals.updatedProperties.dispatch()
    } else if (e.code === 'F8') {
      handleToogleOrtho()
    } else if (e.code === 'F9') {
      handleToogleSnap()
    } else if (e.code === 'Delete') {
      if (editor.selected.length === 0) return
      // Store elements to delete before clearing selection
      const elementsToDelete = [...editor.selected]
      // Clear selection and reset array first
      signals.clearSelection.dispatch()
      editor.selected = []
      // Then delete all elements
      import('./commands/MultiRemoveElementCommand.js').then(({ MultiRemoveElementCommand }) => {
        editor.execute(new MultiRemoveElementCommand(editor, elementsToDelete))
      })
    } else if (e.code === 'KeyZ' && e.ctrlKey) {
      if (e.shiftKey) editor.redo()
      else editor.undo()
    } else if (editor.isDrawing) {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        const input = terminalInput.value.trim()
        if (isNumericString(input)) {
          editor.length = input
          editor.svg.fire('valueInput')
          terminalText.value = ''
        } else if (input.startsWith('@')) {
          const coords = input.substring(1).split(',')
          if (coords.length === 2) {
            const x = parseFloat(coords[0])
            const y = parseFloat(coords[1])
            if (!isNaN(x) && !isNaN(y)) {
              editor.inputCoord = { x, y }
              editor.svg.fire('coordinateInput')
              terminalText.value = ''
            }
          }
        }
      }
    } else if (editor.isInteracting) {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        const input = terminalInput.value.trim()
        if (isNumericString(input)) {
          console.log('distance input', input)
          editor.distance = input
          editor.signals.inputValue.dispatch(input)
          terminalText.value = ''
        } else if (input.startsWith('@')) {
          const coords = input.substring(1).split(',')
          if (coords.length === 2) {
            const x = parseFloat(coords[0])
            const y = parseFloat(coords[1])
            if (!isNaN(x) && !isNaN(y)) {
              editor.inputCoord = { x, y }
              editor.signals.coordinateInput.dispatch()
              terminalText.value = ''
            }
          }
        } else {
          console.log('command params', input)
          editor.signals.inputValue.dispatch(input)
          terminalText.value = ''
        }
      }
    }
  }
}

export { Terminal }
