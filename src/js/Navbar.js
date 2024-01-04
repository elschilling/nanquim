function Navbar(editor) {
  const form = document.createElement('form')
  form.style.display = 'none'
  document.body.appendChild(form)
  const fileInput = document.createElement('input')
  fileInput.multiple = false
  fileInput.type = 'file'
  fileInput.addEventListener('change', function () {
    console.log('load file', fileInput.files)
    editor.loader.loadFile(fileInput.files[0])
    form.reset()
  })
  window.fileInput = fileInput
  form.appendChild(fileInput)

  window.onclick = function (event) {
    if (!event.target.matches('.navbar-menus')) {
      let menus = document.getElementsByClassName('dropdown-menu')
      for (let i = 0; i < menus.length; i++) {
        if (menus[i].classList.contains('show-menu')) {
          menus[i].classList.remove('show-menu')
        }
      }
    }
  }
}
function menuFile() {
  document.getElementsByClassName('dropdown-menu')[0].classList.toggle('show-menu')
}
window.menuFile = menuFile
export { Navbar }
