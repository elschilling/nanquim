import commands from './commands/_commands'

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
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
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
      editor.ortho = !editor.ortho
      editor.svg.fire('orthoChange')
      console.log(editor.ortho)
    }
  }
}

export { Terminal }
