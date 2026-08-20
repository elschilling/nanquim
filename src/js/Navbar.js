import { DXFExporter } from './utils/DXFexporter.js'

function runWelcomeAwareDocumentAction(action, failureMessage) {
  const welcomeScreen = window.welcomeScreen
  if (
    welcomeScreen?.isVisible?.()
    && typeof welcomeScreen.runDocumentAction === 'function'
  ) {
    return welcomeScreen.runDocumentAction(action, failureMessage)
  }
  return action()
}

function Navbar(editor) {
  const documents = editor.documents
  if (!documents) throw new TypeError('DocumentController must be initialized before Navbar.')

  // Keep these globals as the declarative Pug menu and keyboard layer call
  // them directly. All editable document I/O is delegated to the one
  // controller/serializer boundary.
  window.newDocument = () => runWelcomeAwareDocumentAction(
    () => documents.newDocument(),
    'Could not create a new drawing.',
  )
  window.openSVG = () => runWelcomeAwareDocumentAction(
    () => documents.open(),
    'Could not open a drawing.',
  )
  window.saveSVG = () => documents.save()
  window.saveAsSVG = () => documents.saveAs()
  window.exportSVG = () => documents.exportSvg()

  window.saveDXF = function () {
    new DXFExporter(editor).saveFile('drawing.dxf')
  }

  window.onclick = function (event) {
    if (!event.target.matches('.navbar-menus')) {
      const menus = document.getElementsByClassName('dropdown-menu')
      for (let i = 0; i < menus.length; i += 1) {
        menus[i].classList.remove('show-menu')
      }
    }
  }
}

function menuFile() {
  document.getElementsByClassName('dropdown-menu')[0]?.classList.toggle('show-menu')
}

window.menuFile = menuFile

export { Navbar }
