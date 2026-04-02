import { Command } from '../Command'

function shoelaceArea(points) {
    let area = 0
    const n = points.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = points[i]
        const [x2, y2] = points[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    }
    return Math.abs(area) / 2
}

class AreaCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'AreaCommand'
        this.name = 'Area'
        this.boundOnElementSelected = this.onElementSelected.bind(this)
        this.boundOnCancelled = null
        this.boundOnKeyDown = this.onKeyDown.bind(this)
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({
            type: 'strong',
            msg: 'AREA ',
            clearSelection: true,
        })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Select a closed polyline or rectangle: ',
        })

        this.editor.isInteracting = true
        this.editor.selectSingleElement = true

        this.editor.signals.toogledSelect.add(this.boundOnElementSelected)

        this.boundOnCancelled = () => this.cleanup()
        this.editor.signals.commandCancelled.addOnce(this.boundOnCancelled, this)

        document.addEventListener('keydown', this.boundOnKeyDown)
    }

    onKeyDown(e) {
        if (e.key === 'Escape') {
            this.cleanup()
            this.editor.signals.terminalLogged.dispatch({ msg: 'Command cancelled.' })
        }
    }

    onElementSelected(el) {
        const nodeName = el.node.nodeName.toLowerCase()
        let area

        if (nodeName === 'polyline' || nodeName === 'polygon') {
            const rawPoints = el.array()
            if (!rawPoints || rawPoints.length < 3) {
                this.editor.signals.terminalLogged.dispatch({
                    type: 'span',
                    msg: 'Polyline needs at least 3 points to calculate area.',
                })
                this.cleanup()
                return
            }
            area = shoelaceArea(rawPoints)
        } else if (nodeName === 'rect') {
            const w = el.width()
            const h = el.height()
            area = Math.abs(w * h)
        } else {
            this.editor.signals.terminalLogged.dispatch({
                type: 'span',
                msg: 'Selected element is not supported. Please select a polyline or rectangle.',
            })
            return
        }

        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: `Area = ${area.toFixed(4)}`,
        })

        this.cleanup()
    }

    cleanup() {
        this.editor.signals.toogledSelect.remove(this.boundOnElementSelected)
        if (this.boundOnCancelled) {
            this.editor.signals.commandCancelled.remove(this.boundOnCancelled, this)
            this.boundOnCancelled = null
        }
        document.removeEventListener('keydown', this.boundOnKeyDown)
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
    }
}

function areaCommand(editor) {
    const cmd = new AreaCommand(editor)
    cmd.execute()
}

export { areaCommand }
