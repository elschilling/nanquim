import { Command } from '../Command'
import { AddElementCommand } from './AddElementCommand'
import { applyCollectionStyleToElement } from '../Collection'

class DrawEllipseCommand extends Command {
    constructor(editor) {
        super(editor)
        this.type = 'DrawEllipseCommand'
        this.name = 'Ellipse'
        this.drawing = this.editor.activeCollection
        this.ghost = null
        this.onMouseMove = null
    }

    execute() {
        this.editor.signals.terminalLogged.dispatch({ type: 'strong', msg: 'DRAW ELLIPSE ' })
        this.editor.signals.terminalLogged.dispatch({
            type: 'span',
            msg: 'Click to set center or type @x,y coordinates',
        })

        this.editor.isInteracting = true
        this.editor.selectSingleElement = true
        this.setCenter()
    }

    getActiveSvg() {
        return this.editor.mode === 'paper' ? this.editor.paperSvg : this.editor.svg
    }

    createGhost(cx, cy, rx, ry) {
        const activeSvg = this.getActiveSvg()
        this.ghost = activeSvg
            .ellipse(rx * 2, ry * 2)
            .center(cx, cy)
            .attr({
                stroke: '#8ab4f8',
                'stroke-width': 1,
                'stroke-dasharray': '4 4',
                'vector-effect': 'non-scaling-stroke',
                opacity: 0.7,
                fill: 'none',
            })
    }

    removeGhost() {
        if (this.ghost) {
            this.ghost.remove()
            this.ghost = null
        }
        if (this.onMouseMove) {
            document.removeEventListener('mousemove', this.onMouseMove)
            this.onMouseMove = null
        }
    }

    cleanup() {
        this.removeGhost()
        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
    }

    setCenter() {
        let centerHandled = false

        const onPoint = (point) => {
            if (centerHandled) return
            centerHandled = true
            this.editor.signals.coordinateInput.remove(onCoord, this)
            this.setRx(point)
        }

        const onCoord = () => {
            if (centerHandled) return
            centerHandled = true
            this.editor.signals.pointCaptured.remove(onPoint, this)
            const coord = this.editor.inputCoord
            this.setRx({ x: coord.x, y: coord.y })
        }

        const onCancel = () => {
            this.cleanup()
        }

        this.editor.signals.pointCaptured.addOnce(onPoint, this)
        this.editor.signals.coordinateInput.addOnce(onCoord, this)
        this.editor.signals.commandCancelled.addOnce(onCancel, this)
    }

    setRx(center) {
        const activeSvg = this.getActiveSvg()

        this.createGhost(center.x, center.y, 0, 0)

        this.editor.signals.terminalLogged.dispatch({ msg: 'Rx (horizontal radius):' })

        this.onMouseMove = (e) => {
            const raw = activeSvg.point(e.pageX, e.pageY)
            const cursor = this.editor.snapPoint || raw
            const rx = Math.abs(cursor.x - center.x)
            const ry = Math.abs(cursor.y - center.y)
            if (this.ghost) {
                this.ghost.center(center.x, center.y).attr({ rx: Math.max(rx, 0.1), ry: Math.max(ry, 0.1) })
            }
        }
        document.addEventListener('mousemove', this.onMouseMove)

        let rxHandled = false

        const onValue = (val) => {
            if (rxHandled) return
            rxHandled = true
            this.editor.signals.pointCaptured.remove(onPoint, this)
            this.editor.signals.commandCancelled.remove(onCancel, this)
            const rx = parseFloat(val)
            if (isNaN(rx) || rx <= 0) {
                this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid radius. Command cancelled.' })
                this.cleanup()
                return
            }
            this.setRy(center, rx)
        }

        const onPoint = (point) => {
            if (rxHandled) return
            rxHandled = true
            this.editor.signals.inputValue.remove(onValue, this)
            this.editor.signals.commandCancelled.remove(onCancel, this)
            const rx = Math.abs(point.x - center.x)
            this.setRy(center, rx)
        }

        const onCancel = () => {
            this.editor.signals.inputValue.remove(onValue, this)
            this.editor.signals.pointCaptured.remove(onPoint, this)
            this.cleanup()
        }

        this.editor.signals.inputValue.addOnce(onValue, this)
        this.editor.signals.pointCaptured.addOnce(onPoint, this)
        this.editor.signals.commandCancelled.addOnce(onCancel, this)
    }

    setRy(center, rx) {
        const activeSvg = this.getActiveSvg()

        // Update ghost to show fixed rx and dynamic ry
        if (this.ghost) {
            this.ghost.attr({ rx: Math.max(rx, 0.1) })
        }

        // Remove old mousemove and add a new one for ry only
        if (this.onMouseMove) {
            document.removeEventListener('mousemove', this.onMouseMove)
            this.onMouseMove = null
        }

        this.onMouseMove = (e) => {
            const raw = activeSvg.point(e.pageX, e.pageY)
            const cursor = this.editor.snapPoint || raw
            const ry = Math.abs(cursor.y - center.y)
            if (this.ghost) {
                this.ghost.center(center.x, center.y).attr({ rx: Math.max(rx, 0.1), ry: Math.max(ry, 0.1) })
            }
        }
        document.addEventListener('mousemove', this.onMouseMove)

        this.editor.signals.terminalLogged.dispatch({ msg: 'Ry (vertical radius):' })

        Promise.resolve().then(() => {
            let ryHandled = false

            const onValue = (val) => {
                if (ryHandled) return
                ryHandled = true
                this.editor.signals.pointCaptured.remove(onPoint, this)
                this.editor.signals.commandCancelled.remove(onCancel, this)
                const ry = parseFloat(val)
                if (isNaN(ry) || ry <= 0) {
                    this.editor.signals.terminalLogged.dispatch({ msg: 'Invalid radius. Command cancelled.' })
                    this.cleanup()
                    return
                }
                this.finalize(center, rx, ry)
            }

            const onPoint = (point) => {
                if (ryHandled) return
                ryHandled = true
                this.editor.signals.inputValue.remove(onValue, this)
                this.editor.signals.commandCancelled.remove(onCancel, this)
                const ry = Math.abs(point.y - center.y)
                this.finalize(center, rx, ry)
            }

            const onCancel = () => {
                this.editor.signals.inputValue.remove(onValue, this)
                this.editor.signals.pointCaptured.remove(onPoint, this)
                this.cleanup()
            }

            this.editor.signals.inputValue.addOnce(onValue, this)
            this.editor.signals.pointCaptured.addOnce(onPoint, this)
            this.editor.signals.commandCancelled.addOnce(onCancel, this)
        })
    }

    finalize(center, rx, ry) {
        this.removeGhost()

        const el = this.drawing
            .ellipse(rx * 2, ry * 2)
            .center(center.x, center.y)
            .fill('none')

        applyCollectionStyleToElement(this.editor, el)
        el.attr('id', this.editor.elementIndex++)
        el.attr('name', 'Ellipse')

        this.editor.history.undos.push(new AddElementCommand(this.editor, el))
        this.editor.lastCommand = this
        this.updatedOutliner()

        this.editor.signals.terminalLogged.dispatch({
            msg: `Ellipse created: rx=${rx.toFixed(2)}, ry=${ry.toFixed(2)}`,
        })

        this.editor.isInteracting = false
        this.editor.selectSingleElement = false
    }
}

function drawEllipseCommand(editor) {
    const cmd = new DrawEllipseCommand(editor)
    cmd.execute()
}

export { drawEllipseCommand }
