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

        this.editor.signals.terminalLogged.dispatch({ msg: `Erased ${selectedElements.length} elements.` })

        // Clear selection first
        this.editor.signals.clearSelection.dispatch()
        this.editor.selected = []

        // Execute remove commands
        this.editor.execute(new MultiRemoveElementCommand(this.editor, selectedElements))

        this.interactiveExecutionDone = true
        this.editor.lastCommand = new EraseCommand(this.editor)
        this.cleanup()
    }

    cleanup() {
        document.removeEventListener('keydown', this.boundOnKeyDown)
        this.editor.isInteracting = false
        this.editor.suppressHandlers = false
    }
}

function eraseCommand(editor) {
    const eraseCmd = new EraseCommand(editor)
    eraseCmd.execute()
}

export { eraseCommand }
