function dispatchSignalSafely(signal, args = [], reportError = () => {}) {
  if (!signal || typeof signal.dispatch !== 'function' || signal.active === false) return false

  const bindings = Array.isArray(signal._bindings) ? signal._bindings.slice() : null
  if (!bindings) {
    try {
      signal.dispatch(...args)
    } catch (error) {
      reportError(error)
    }
    return true
  }

  // js-signals stops at the first listener that throws. Notifications at this
  // boundary must remain best effort so one broken panel cannot prevent later
  // cleanup or make History reject an otherwise successful mutation.
  if (signal.memorize) signal._prevParams = args
  signal._shouldPropagate = true
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    if (!signal._shouldPropagate) break
    const binding = bindings[index]
    try {
      if (binding.execute(args) === false) break
    } catch (error) {
      reportError(error)
      if (binding._isOnce) {
        try {
          binding.detach()
        } catch (detachError) {
          reportError(detachError)
        }
      }
    }
  }
  return true
}

class Command {
  constructor(editor) {
    // this.id = - 1;
    // this.inMemory = false;
    // this.updatable = false;
    this.type = ''
    this.name = ''
    this.editor = editor
    this.isDrawing = true
    this.signals = editor.signals
    this.commandSessionRevision = editor.commandSessionRevision
  }

  // Drawing commands may remain active while the user chooses a different
  // collection in the outliner. Resolve the destination lazily so the next
  // element is created in the collection that is active at that moment rather
  // than the one that was active when the command started.
  get drawing() {
    return this.editor.activeCollection || this.editor.drawing
  }

  // Existing drawing commands assign their initial collection in their
  // constructors. Keep that assignment harmless while the getter above keeps
  // the destination current.
  set drawing(_collection) {}

  dispatchSignal(name, ...args) {
    const signal = this.signals && this.signals[name]
    return dispatchSignalSafely(
      signal,
      args,
      error => this._reportNotificationError(name, error),
    )
  }

  ownsCommandSession() {
    return this.editor.commandSessionRevision === this.commandSessionRevision
  }

  deferSessionTask(callback, delay = 0) {
    return setTimeout(() => {
      if (this.ownsCommandSession()) callback()
    }, delay)
  }

  _reportNotificationError(name, error) {
    try {
      console.error(`[${this.type || 'Command'}] ${name} listener failed:`, error)
    } catch (_reportError) {
      // Reporting must remain best effort at this post-commit boundary.
    }
  }

  updatedOutliner() {
    this.dispatchSignal('updatedOutliner')
  }
  // toJSON() {

  // 	const output = {};
  // 	output.type = this.type;
  // 	output.id = this.id;
  // 	output.name = this.name;
  // 	return output;

  // }

  // fromJSON( json ) {

  // 	this.inMemory = true;
  // 	this.type = json.type;
  // 	this.id = json.id;
  // 	this.name = json.name;

  // }
}

export { Command, dispatchSignalSafely }
