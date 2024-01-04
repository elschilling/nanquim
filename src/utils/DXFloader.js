import * as Helper from '../js/libs/dxf/src/Helper'

function DXFLoader(editor) {
  this.loadFile = function (file) {
    console.log('file', file)

    const reader = new FileReader()
    reader.onload = function (e) {
      let data = e.target.result
      if (file.type === 'image/vnd.dxf') {
        console.log('loading dxf')
        data = new Helper.default(data).toSVG()
      } else if (file.type === 'image/svg+xml') {
        console.log('loading svg')
      }
      console.log(data)
      const parser = new DOMParser()
      const doc = parser.parseFromString(data, 'image/svg+xml')
      const svgContent = doc.documentElement.innerHTML
      console.log('svgContent', svgContent)
      editor.drawing.svg(svgContent)
      editor.signals.updatedOutliner.dispatch()
    }
    reader.readAsText(file)
    // console.log('reader', )
    // console.log('data', data)
  }
}

export { DXFLoader }
