import { cancelCommandSession } from '../commands/_commands'
import { importImageFile } from '../commands/ImageCommand'

function initImageDrop(editor) {
  const target = editor.canvas
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files')
  const dragover = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = editor.mode === 'model' ? 'copy' : 'none'
  }
  const drop = event => {
    if (!hasFiles(event)) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files || [])
    if (editor.mode !== 'model') {
      editor.signals.terminalLogged.dispatch({ msg: 'Images can only be imported in Model Space.' })
      return
    }
    if (files.length !== 1) {
      editor.signals.terminalLogged.dispatch({ msg: 'Drop one PNG, JPEG, GIF or WebP image at a time.' })
      return
    }
    const point = editor.svg.point(event.clientX, event.clientY)
    cancelCommandSession(editor)
    if (editor.activeEditor !== 'canvas') {
      editor.activeEditor = 'canvas'
      editor.signals.activeEditorChanged.dispatch('canvas')
    }
    importImageFile(editor, files[0], point)
  }
  target.addEventListener('dragover', dragover)
  target.addEventListener('drop', drop)
  return () => {
    target.removeEventListener('dragover', dragover)
    target.removeEventListener('drop', drop)
  }
}

export { initImageDrop }
