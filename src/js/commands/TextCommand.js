import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement, setElementOverrides } from '../Collection'

class TextCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'TextCommand'
        this.name = 'Text'
        this.drawing = this.editor.activeCollection
        this.interactiveExecutionDone = false
    }

    execute() {
        if (this.interactiveExecutionDone) {
            return
        }

        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ' + this.name.toUpperCase() + ' ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Click to set insertion point or type @x,y coordinates `,
        })

        this.editor.isInteracting = true
        this.editor.isTypingText = true
        this.editor.selectSingleElement = true
        this.editor.signals.pointCaptured.addOnce(this.onInsertionPoint, this)

        // Listen for coordinate input for insertion point
        this.boundOnCoordinateInput = () => {
            this.editor.signals.pointCaptured.remove(this.onInsertionPoint, this)
            this.onInsertionPoint(this.editor.inputCoord)
        }
        this.editor.signals.coordinateInput.addOnce(this.boundOnCoordinateInput, this)
        this.editor.signals.commandCancelled.addOnce(this.cleanup, this)
    }

    onInsertionPoint(point) {
        if (this.boundOnCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnCoordinateInput, this)
        }

        this.insertionPoint = point
        this.editor.signals.terminalLogged.dispatch({
            msg: `Insertion point: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}. Enter text:`,
        })

        // Create live feedback text element
        let textElement = this.drawing.text('')
        this.textElement = textElement
        textElement.font({ size: 0.5, family: 'monospace' }) // setup default font size BEFORE move to fix bbox calcs

        // Position text
        textElement.move(this.insertionPoint.x, this.insertionPoint.y)

        applyCollectionStyleToElement(this.editor, textElement)

        // Default text to being filled instead of outlined
        const currentStroke = textElement.css('stroke') || textElement.attr('stroke') || 'white'
        const fillColor = (currentStroke !== 'transparent' && currentStroke !== 'none') ? currentStroke : '#ffffff'

        textElement.css({
            fill: fillColor,
            stroke: 'none'
        })
        setElementOverrides(textElement, { fill: true, stroke: true })
        
        this.boundOnInput = () => {
            if (!terminalInput) return
            let textElement = this.textElement
            textElement.text(terminalInput.value || '')
        }

        if (terminalInput) {
            terminalInput.addEventListener('input', this.boundOnInput)
        }

        this.boundOnTextInput = () => {
            this.editor.signals.inputValue.remove(this.boundOnTextInput, this)
            this.onTextInput(this.editor.distance || this.editor.lastInputString) // Editor distance is used for numeric strings, let's just listen to inputValue
        }

        // Create a special listener just for the text input
        this.boundTextListener = (val) => {
            this.editor.signals.inputValue.remove(this.boundTextListener, this)
            this.onTextInput(val)
        }
        this.editor.signals.inputValue.addOnce(this.boundTextListener, this)
        
        // Add pointCaptured to finish editing when clicking outside
        setTimeout(() => {
            this.boundOnPointCaptured = (point) => {
                if (terminalInput) {
                    this.onTextInput(terminalInput.value)
                }
            }
            this.editor.signals.pointCaptured.addOnce(this.boundOnPointCaptured, this)
        }, 100)

        this.boundCancelCommand = () => {
            if (this.textElement) this.textElement.remove()
            this.cleanup()
        }
        this.editor.signals.commandCancelled.addOnce(this.boundCancelCommand, this)
    }

    onTextInput(textValue) {
        this.editor.signals.commandCancelled.remove(this.boundCancelCommand, this)

        if (!textValue || textValue.trim() === '') {
            this.editor.signals.terminalLogged.dispatch({ msg: 'Empty text. Command cancelled.' })
            if (this.textElement) this.textElement.remove()
            this.cleanup()
            return
        }

        this.textElement.text(textValue)
        this.textElement.attr('id', this.editor.elementIndex++)
        this.textElement.attr('name', 'Text')

        this.editor.history.undos.push(new AddElementCommand(this.editor, this.textElement))
        this.editor.lastCommand = this
        if (this.editor.signals.updatedOutliner) {
            this.editor.signals.updatedOutliner.dispatch()
        }

        this.editor.signals.terminalLogged.dispatch({ msg: `Text inserted.` })

        this.cleanup()

        this.interactiveExecutionDone = true
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

        if (this.boundOnCoordinateInput) {
            this.editor.signals.coordinateInput.remove(this.boundOnCoordinateInput, this)
        }
        if (this.boundTextListener) {
            this.editor.signals.inputValue.remove(this.boundTextListener, this)
        }
        this.editor.signals.commandCancelled.remove(this.boundCancelCommand, this)
        this.editor.isInteracting = false
        this.editor.isTypingText = false
        setTimeout(() => {
            this.editor.selectSingleElement = false
        }, 10)
    }
}

function textCommand(editor) {
    const cmd = new TextCommand(editor)
    cmd.execute()
}

export { textCommand }
