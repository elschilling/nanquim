function StatusBar(editor) {
  let coordX = document.getElementById('coordX')
  let coordY = document.getElementById('coordY')
  const signals = editor.signals

  signals.updatedCoordinates.add((coordinates) => {
    // coordX.textContent = Math.floor(coordinates.x)
    coordX.textContent = Math.round(coordinates.x)
    // coordX.textContent = coordinates.x
    // coordY.textContent = Math.floor(coordinates.y)
    coordY.textContent = Math.round(coordinates.y)
    // coordY.textContent = coordinates.y
  })
}

export { StatusBar }
