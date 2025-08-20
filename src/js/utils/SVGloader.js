let svgString

function SVGLoader(editor) {
  this.loadFile = function (file) {
    const reader = new FileReader()
    reader.onload = function (e) {
      svgString = e.target.result
      console.log(svgString)
      editor.drawing.svg(svgString)
    }
    reader.readAsText(file)
  }
}

export { DXFLoader }
