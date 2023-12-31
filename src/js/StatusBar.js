function StatusBar(editor) {
  let coordX = document.getElementById('coordX')
  let coordY = document.getElementById('coordY')
  const signals = editor.signals

  signals.updatedCoordinates.add((coordinates) => {
    coordX.textContent = coordinates.x
    coordY.textContent = coordinates.y
  })
}

export { StatusBar }
