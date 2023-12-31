import { DrawLineCommand } from './DrawLineCommand'

export function cLine(editor) {
  const lineCommand = new DrawLineCommand(editor)
  lineCommand.execute()
}
