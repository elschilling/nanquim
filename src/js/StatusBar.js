function StatusBar(editor) {
  let coordX = document.getElementById('coordX')
  let coordY = document.getElementById('coordY')
  const signals = editor.signals

  signals.updatedCoordinates.add((coordinates) => {
    coordX.textContent = Math.floor(coordinates.x)
    coordY.textContent = Math.floor(coordinates.y)
  })
}

export { StatusBar }
