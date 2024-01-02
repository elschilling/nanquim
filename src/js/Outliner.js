function Outliner(editor) {
  // let coordX = document.getElementById('coordX')
  // let coordY = document.getElementById('coordY')
  // const signals = editor.signals
  // signals.updatedCoordinates.add((coordinates) => {
  //   coordX.textContent = Math.floor(coordinates.x)
  //   coordY.textContent = Math.floor(coordinates.y)
  // })
  const signals = editor.signals
  const svgtree = document.getElementById('svg-tree')
  signals.updatedOutliner.add(() => {
    console.log(editor.drawing.children())
  })
  // editor.svg.children().each((el) => {
  //   console.log(el)
  // })
}

export { Outliner }
