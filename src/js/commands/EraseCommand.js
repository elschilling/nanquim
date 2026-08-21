import { Command } from '../Command'
import { MultiRemoveElementCommand } from './MultiRemoveElementCommand'

class EraseCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'EraseCommand'
        this.name = 'Erase'
        this.boundOnKeyDown = this.onKeyDown.bind(this)
        this.interactiveExecutionDone = false
    }

    execute() {
        if (this.interactiveExecutionDone) {
            return
        }
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })

        if (this.editor.selected.length > 0) {
            this.editor.isInteracting = true
            this.onSelectionConfirmed()
            return
        }

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Select elements to erase and press Enter to confirm.`,
        })
        document.addEventListener('keydown', this.boundOnKeyDown)
        this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
        this.editor.suppressHandlers = true
    }

    onKeyDown(event) {
        if (event.code === 'Enter' || event.code === 'Space' || event.code === 'NumpadEnter') {
            this.cleanup()
            this.editor.isInteracting = true
            this.onSelectionConfirmed()
        } else if (event.key === 'Escape') {
            this.cleanup()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        }
    }

    onSelectionConfirmed() {
        const selectedElements = [...this.editor.selected]
        if (selectedElements.length === 0) {
            this.editor.signals.terminalLogged.dispatch({ msg: 'No elements selected. Command cancelled.' })
            this.cleanup()
            return
        }

        const command = new MultiRemoveElementCommand(this.editor, selectedElements)
        if (!command.isValid) {
            command.reportInvalid()
            this.cleanup()
            return
        }

        try {
            this.editor.execute(command)
        } catch (_) {
            this.editor.signals.terminalLogged.dispatch({
                msg: 'Erase failed. The drawing was left unchanged.',
            })
            this.cleanup()
            return
        }

        this.editor.signals.terminalLogged.dispatch({ msg: `Erased ${command.elements.length} elements.` })

        this.interactiveExecutionDone = true
        this.cleanup()
    }

    cleanup() {
        document.removeEventListener('keydown', this.boundOnKeyDown)
        this.editor.signals.commandCancelled.remove(this.cleanup, this)
        this.editor.isInteracting = false
        this.editor.suppressHandlers = false
    }
}

function eraseCommand(editor) {
    const eraseCmd = new EraseCommand(editor)
    eraseCmd.execute()
}

export { eraseCommand }
