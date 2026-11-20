import { getPreferences } from './Preferences'
import { dispatchSignalSafely } from './Command'

const sessions = new WeakMap()

function stopCommandAutoRepeat(editor) {
  sessions.get(editor)?.()
}

function armCommandAutoRepeat(editor, repeat) {
  stopCommandAutoRepeat(editor)
  if (!getPreferences().autoRepeatLastCommand) return

  const revision = editor.commandSessionRevision
  const lastCommand = editor.lastCommand
  const mode = editor.mode
  const activeEditor = editor.activeEditor
  let timer = null

  const dispose = () => {
    if (timer !== null) clearTimeout(timer)
    subscriptions.forEach(([signal, listener]) => signal?.remove(listener))
    sessions.delete(editor)
  }
  const onPreferencesChanged = (preferences) => {
    if (!preferences.autoRepeatLastCommand) dispose()
  }
  const onCompleted = (completedRevision) => {
    if (completedRevision !== revision || timer !== null) return
    // Finish the current DOM/signal event and its cleanup before starting a
    // new session, so the completing click or Enter cannot reach the new tool.
    timer = setTimeout(() => {
      const canRepeat = editor.commandSessionRevision === revision
        && editor.lastCommand === lastCommand
        && editor.mode === mode
        && editor.activeEditor === activeEditor
        && activeEditor !== 'geometry-nodes'
        && !editor.isDrawing && !editor.isInteracting && !editor.isSelecting
        && !editor.isEditingVertex
        && getPreferences().autoRepeatLastCommand
      dispose()
      if (!canRepeat) return

      // A repeated tool starts with a fresh selection. In particular, HATCH
      // must not keep hatching the previous preselection without user input.
      dispatchSignalSafely(editor.signals.clearSelection)
      editor.selected = []
      repeat()
    }, 0)
  }
  const subscriptions = [
    [editor.signals.commandCompleted, onCompleted],
    [editor.signals.commandCancelled, dispose],
    [editor.signals.documentSessionReset, dispose],
    [editor.signals.editorModeChanged, dispose],
    [editor.signals.activeEditorChanged, dispose],
    [editor.signals.preferencesChanged, onPreferencesChanged],
  ]
  subscriptions.forEach(([signal, listener]) => signal?.add(listener))
  sessions.set(editor, dispose)
}

export { armCommandAutoRepeat, stopCommandAutoRepeat }
