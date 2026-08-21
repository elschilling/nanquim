import { Command } from '../Command'

function runWithoutTracking(editor, callback) {
  return editor.documentState?.runWithoutTracking
    ? editor.documentState.runWithoutTracking(callback)
    : callback()
}

class EditTextCommand extends Command {
  constructor(editor, textElement) {
    super(editor)
    this.type = 'EditTextCommand'
    this.name = 'Edit Text'
    this.textElement = textElement
    this.originalText = textElement.text()
    this.selectionBefore = [...editor.selected]
    this.newText = null
    this.commitReady = false
    this.active = false
    this.terminalInput = null
    this.pointCaptureTimer = null

    this.boundOnInput = this.onInput.bind(this)
    this.boundOnPointCaptured = this.onPointCaptured.bind(this)
    this.boundTextListener = this.onTextInput.bind(this)
    this.boundCancelCommand = this.cancel.bind(this)
  }

  execute() {
    if (this.commitReady) {
      this.applyText(this.newText)
      return
    }
    this.startInteractive()
  }

  startInteractive() {
    if (this.active) return
    this.active = true

    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'EDIT TEXT ' })
    this.editor.signals.clearSelection.dispatch()
    this.textElement.removeClass('elementHover')
    this.textElement.removeClass('elementSelected')
    this.editor.suppressHandlers = true
    this.editor.isInteracting = true
    this.editor.isTypingText = true
    this.editor.selectSingleElement = true

    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: 'Editing text. Enter new text: ',
    })

    this.terminalInput = document.getElementById('terminalInput')
    if (this.terminalInput) {
      this.terminalInput.value = this.originalText
      this.terminalInput.focus()
      const length = this.terminalInput.value.length
      this.terminalInput.setSelectionRange(length, length)
      this.terminalInput.addEventListener('input', this.boundOnInput)
    }

    this.editor.signals.inputValue.addOnce(this.boundTextListener, this)
    this.editor.signals.commandCancelled.addOnce(this.boundCancelCommand, this)

    // Avoid consuming the pointer event that opened the editor. The timer is
    // retained so cancellation can dispose it deterministically.
    this.pointCaptureTimer = this.deferSessionTask(() => {
      this.pointCaptureTimer = null
      if (this.active) {
        this.editor.signals.pointCaptured.addOnce(this.boundOnPointCaptured, this)
      }
    }, 100)
  }

  onInput() {
    if (!this.terminalInput) return
    this.previewText(this.terminalInput.value || '')
  }

  onPointCaptured() {
    this.onTextInput(this.terminalInput?.value ?? this.textElement.text())
  }

  onTextInput(textValue) {
    if (!this.active) return null
    const nextText = String(textValue ?? '')
    if (nextText.trim() === '') {
      this.editor.signals.terminalLogged.dispatch({
        msg: 'Empty text. Command cancelled, restoring original.',
      })
      this.cancel()
      return null
    }

    if (nextText === this.originalText) {
      this.previewText(this.originalText)
      this.cleanup()
      this.restoreSelection()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Text unchanged.' })
      return null
    }

    // The live preview is non-persistent. Restore the exact pre-command state
    // before History performs the first document mutation.
    this.previewText(this.originalText)
    this.newText = nextText
    this.commitReady = true
    this.cleanup()
    let result
    try {
      result = this.editor.execute(this)
    } catch (error) {
      this.restoreSelection()
      throw error
    }
    this.editor.signals.terminalLogged.dispatch({ msg: 'Text updated.' })
    return result
  }

  previewText(value) {
    runWithoutTracking(this.editor, () => this.textElement.text(value))
  }

  applyText(value) {
    const previous = this.textElement.text()
    try {
      this.textElement.text(value)
      this.invalidateGeometry()
    } catch (error) {
      this.textElement.text(previous)
      this.editor.spatialIndex?.markDirty()
      this.editor.fullSpatialIndex?.markDirty()
      throw error
    }
  }

  cancel() {
    if (!this.active) return
    this.previewText(this.originalText)
    this.cleanup()
    this.restoreSelection()
  }

  restoreSelection() {
    this.editor.selected = this.selectionBefore.filter((element) => (
      element?._paperVp || element?.node?.isConnected
    ))
    this.editor.signals.updatedSelection.dispatch()
  }

  cleanup() {
    this.active = false
    if (this.pointCaptureTimer !== null) {
      clearTimeout(this.pointCaptureTimer)
      this.pointCaptureTimer = null
    }
    this.editor.signals.pointCaptured.remove(this.boundOnPointCaptured, this)
    this.editor.signals.inputValue.remove(this.boundTextListener, this)
    this.editor.signals.commandCancelled.remove(this.boundCancelCommand, this)
    if (this.terminalInput) {
      this.terminalInput.removeEventListener('input', this.boundOnInput)
      this.terminalInput.value = ''
      this.terminalInput = null
    }
    this.editor.isInteracting = false
    this.editor.isTypingText = false
    this.editor.suppressHandlers = false
    this.editor.selectSingleElement = false
  }

  undo() {
    this.applyText(this.originalText)
  }

  redo() {
    this.applyText(this.newText)
  }

  invalidateGeometry() {
    this.editor.spatialIndex?.markDirty()
    this.editor.fullSpatialIndex?.markDirty()
    this.editor.signals.updatedOutliner.dispatch()
    this.editor.signals.updatedSelection.dispatch()
    this.editor.signals.updatedProperties.dispatch()
  }
}

function editTextCommand(editor, textElement) {
  const command = new EditTextCommand(editor, textElement)
  command.execute()
  return command
}

export { editTextCommand, EditTextCommand }
