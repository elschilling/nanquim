import { Command } from '../Command'

class FilletCommand extends Command {
  constructor(editor) {
    super(editor)
    this.type = 'FilletCommand'
    this.name = 'Fillet'
    this.selectedElements = []

    // Bind handlers
    this.boundOnKeyDown = this.onKeyDown.bind(this)
    this.boundOnElementSelected = this.onElementSelected.bind(this)
  }

  execute() {
    this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: this.name.toUpperCase() + ' ' })
    this.editor.signals.terminalLogged.dispatch({
      type: 'span',
      msg: `Select elements to fillet - Radius: ` + this.editor.cmdParams.filletRadius,
    })
    this.editor.isInteracting = true
    this.editor.signals.inputValue.addOnce(this.onRadiusParam, this)
    document.addEventListener('keydown', this.boundOnKeyDown)
    this.startSelection()
  }

  onRadiusParam(input) {
    this.editor.signals.terminalLogged.dispatch({ msg: `Enter fillet radius` })
    this.editor.signals.inputValue.addOnce(this.onRadiusInput, this)
  }

  onRadiusInput(input) {
    this.editor.signals.terminalLogged.dispatch({ msg: `Radius set to` + input })
    this.editor.cmdParams.filletRadius = input
    this.execute()
  }

  startSelection() {
    this.editor.signals.clearSelection.dispatch()
    this.editor.selectSingleElement = true
    this.editor.signals.toogledSelect.addOnce(this.boundOnElementSelected)
  }

  onElementSelected(el) {
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    if (!el) return
    this.selectedElements.push(el)
    console.log('selectedElements', this.selectedElements)
    if (this.selectedElements.length < 2) {
      this.startSelection()
    } else {
      this.filletElements()
    }
  }

  filletElements() {
    // IMPLEMENT THE FILLET LOGIC FOR LINES
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.cleanup()
      this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
    }
  }

  cleanup() {
    document.removeEventListener('keydown', this.boundOnKeyDown)
    this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
    this.editor.isInteracting = false
    this.editor.selectSingleElement = false
    this.editor.distance = null
    this.selectedElement = null
  }

  undo() {}
  redo() {}
}

function filletCommand(editor) {
  const filletCmd = new FilletCommand(editor)
  filletCmd.execute()
}

export { filletCommand }
