import { Command } from '../Command'

class EditTextCommand extends Command {
    constructor(editor, textElement) {
        super(editor)
        this.type = 'EditTextCommand'
        this.name = 'Edit Text'
        this.textElement = textElement
        this.originalText = textElement.text()
        this.interactiveExecutionDone = false
    }

    execute() {
        if (this.interactiveExecutionDone) {
            return
        }

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
            msg: `Editing text. Enter new text: `,
        })

        const terminalInput = document.getElementById('terminalInput')
        if (terminalInput) {
            terminalInput.value = this.originalText
            terminalInput.focus()
            
            // Move cursor to end
            const len = terminalInput.value.length
            terminalInput.setSelectionRange(len, len)
        }

        this.boundOnInput = () => {
            if (!terminalInput) return
            this.textElement.text(terminalInput.value || '')
        }

        if (terminalInput) {
            terminalInput.addEventListener('input', this.boundOnInput)
        }

        this.boundTextListener = (val) => {
            this.editor.signals.inputValue.remove(this.boundTextListener, this)
            this.onTextInput(val)
        }
        this.editor.signals.inputValue.addOnce(this.boundTextListener, this)
        
        setTimeout(() => {
            this.boundOnPointCaptured = (point) => {
                if (terminalInput) {
                    this.onTextInput(terminalInput.value)
                }
            }
            this.editor.signals.pointCaptured.addOnce(this.boundOnPointCaptured, this)
        }, 100)

        this.boundCancelCommand = () => {
            this.textElement.text(this.originalText)
            this.cleanup()
        }
        this.editor.signals.commandCancelled.addOnce(this.boundCancelCommand, this)
    }

    onTextInput(textValue) {
        this.editor.signals.commandCancelled.remove(this.boundCancelCommand, this)
        
        if (!textValue || textValue.trim() === '') {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Empty text. Command cancelled, restoring original.' })
            this.textElement.text(this.originalText)
            this.cleanup()
            return
        }

        this.textElement.text(textValue)
        this.executeCommand()
    }

    executeCommand() {
        this.newText = this.textElement.text()
        this.interactiveExecutionDone = true
        this.editor.execute(this)

        this.editor.signals.terminalLogged.dispatch({ msg: `Text updated.` })
        this.cleanup()
    }

    cleanup() {
        if (this.boundOnPointCaptured) {
            this.editor.signals.pointCaptured.remove(this.boundOnPointCaptured, this)
        }
        const terminalInput = document.getElementById('terminalInput')
        if (terminalInput && this.boundOnInput) {
            terminalInput.removeEventListener('input', this.boundOnInput)
            terminalInput.value = ''
        }
        if (this.boundTextListener) {
            this.editor.signals.inputValue.remove(this.boundTextListener, this)
        }
        this.editor.isInteracting = false
        this.editor.isTypingText = false
        this.editor.suppressHandlers = false
        setTimeout(() => {
            this.editor.selectSingleElement = false
        }, 10)
    }

    undo() {
        this.textElement.text(this.originalText)
    }

    redo() {
        this.textElement.text(this.newText)
    }
}

function editTextCommand(editor, textElement) {
    const cmd = new EditTextCommand(editor, textElement)
    cmd.execute()
}

export { editTextCommand, EditTextCommand }
