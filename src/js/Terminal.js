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
    // console.log('update coordinates', coordinates)
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

  function handleInput() {
    terminalInput.focus()
  }

  function handleKeyUp(e) {
    // console.log(e)
    if (!editor.isDrawing && !editor.isInteracting && e.code === 'Space' && terminalInput.value.trim() === '') {
      // const lastCommand = editor.history.undos[editor.history.undos.length - 1]
      if (editor.lastCommand) {
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
      terminalText.value = ''
      editor.svg.fire('cancelDrawing', e)
      signals.clearSelection.dispatch()
      editor.selected = []
      signals.updatedProperties.dispatch()
    } else if (e.code === 'F8') {
      handleToogleOrtho()
    } else if (e.code === 'F9') {
      handleToogleSnap()
    } else if (e.code === 'Delete') {
      const element = editor.selected[0]
      if (element === null) return
      signals.clearSelection.dispatch()
      editor.selected = []
      editor.execute(new RemoveElementCommand(editor, element))
    } else if (e.code === 'KeyZ' && e.ctrlKey) {
      if (e.shiftKey) editor.redo()
      else editor.undo()
    } else if (editor.isDrawing) {
      if (isNumericString(terminalInput.value.trim())) {
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          editor.length = terminalInput.value
          editor.svg.fire('valueInput')
          terminalText.value = ''
        }
      }
    } else if (editor.isInteracting) {
      if (isNumericString(terminalInput.value.trim())) {
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          console.log('distance input', terminalInput.value)
          editor.distance = terminalInput.value
          editor.signals.inputValue.dispatch()
          terminalText.value = ''
        }
      }
    }
  }
}

export { Terminal }
