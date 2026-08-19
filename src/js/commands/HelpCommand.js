function helpCommand(editor) {
  if (editor?.helpSession && typeof editor.helpSession.open === 'function') {
    editor.helpSession.open()
    return
  }

  editor?.signals?.terminalLogged?.dispatch({
    type: 'span',
    msg: 'Help is not available.',
  })
}

export { helpCommand }
