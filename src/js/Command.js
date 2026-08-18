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

  updatedOutliner() {
    this.signals.updatedOutliner.dispatch()
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

export { Command }
