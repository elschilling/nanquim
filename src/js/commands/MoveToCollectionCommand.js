import { createCollection, isElementHidden, isElementLocked } from '../Collection'
import { invalidateSpatialIndexes } from '../utils/invalidateSpatialIndexes'
import { ReorderTreeCommand, canReorderTreeElement } from './ReorderTreeCommand'

class MoveToCollectionCommand extends ReorderTreeCommand {
  constructor(editor, elements, { collection, name } = {}) {
    super(editor, elements, collection)
    this.type = 'MoveToCollectionCommand'
    this.name = 'Move to collection'
    this.collectionName = name
    this.createdCollection = null
    this.deferNotifications = false
  }

  validate() {
    if (this.editor.mode !== 'model' || this.editor.drawing?.node !== this.root?.node) {
      throw new Error('Move to collection is only available in the active Model drawing.')
    }
    if (!this.elements.length || this.elements.some(element => (
      !canReorderTreeElement(this.editor, element) || element.attr('data-collection') === 'true'
    ))) {
      throw new Error('Select editable elements to move to a collection.')
    }
    if (this.target) {
      if (this.collectionName !== undefined || this.target.attr?.('data-collection') !== 'true'
        || this.editor.collections.get(this.target.attr('id'))?.group?.node !== this.target.node
        || this.target.parent()?.node !== this.root.node) {
        throw new Error('Choose an existing Model collection or a new collection name.')
      }
    } else if (typeof this.collectionName !== 'string' || !this.collectionName.trim()
      || this.collectionName.trim().length > 256 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(this.collectionName)) {
      throw new Error('Enter a collection name with 1 to 256 valid characters.')
    }
  }

  execute() {
    if (this.after) return this.redo()
    this.validate()
    const previousIndex = this.editor.collectionIndex
    if (!this.target) {
      this.target = createCollection(this.editor, this.collectionName.trim(), { activate: false, notify: false })
      this.createdCollection = this.editor.collections.get(this.target.attr('id'))
      this.activeCollectionBefore = this.editor.activeCollection
    }
    try {
      super.execute()
    } catch (error) {
      if (this.createdCollection) {
        this.detachCollection()
        this.editor.collectionIndex = previousIndex
        this.target = null
        this.createdCollection = null
      }
      throw error
    }
  }

  attachCollection() {
    this.root.node.insertBefore(this.target.node, this.root.node.childNodes[this.collectionPosition] || null)
    const entries = [...this.editor.collections]
    entries.splice(this.collectionMapPosition, 0, [this.target.attr('id'), this.createdCollection])
    this.editor.collections.clear()
    entries.forEach(([id, data]) => this.editor.collections.set(id, data))
  }

  detachCollection() {
    this.collectionPosition = [...this.root.node.childNodes].indexOf(this.target.node)
    this.collectionMapPosition = [...this.editor.collections.keys()].indexOf(this.target.attr('id'))
    this.target.node.remove()
    this.editor.collections.delete(this.target.attr('id'))
  }

  undo() {
    if (!this.createdCollection) return super.undo()
    this.deferNotifications = true
    try {
      super.undo()
      try {
        this.detachCollection()
      } catch (error) {
        this.attachCollection()
        super.redo()
        throw error
      }
      if (this.editor.activeCollection?.node === this.target.node) {
        this.editor.activeCollection = this.root.node.contains(this.activeCollectionBefore?.node || null)
          ? this.activeCollectionBefore
          : [...this.editor.collections.values()].find(data => data.group.parent()?.node === this.root.node)?.group || null
      }
    } finally {
      this.deferNotifications = false
    }
    this.notify(this.selectionBefore)
  }

  redo() {
    if (!this.createdCollection) return super.redo()
    this.attachCollection()
    try {
      super.redo()
    } catch (error) {
      this.detachCollection()
      throw error
    }
  }

  notify(selection) {
    if (this.deferNotifications) return
    if (!this.createdCollection) return super.notify(selection)
    invalidateSpatialIndexes(this.editor)
    this.dispatchSignal('clearSelection')
    const root = this.editor.mode === 'paper' ? this.editor.paperAnnotations : this.editor.drawing
    this.editor.selected = selection.filter(element => (
      element?.node && root?.node?.contains(element.node)
      && !isElementHidden(this.editor, element) && !isElementLocked(this.editor, element)
    ))
    this.dispatchSignal('updatedCollections')
    this.dispatchSignal('updatedSelection')
    this.dispatchSignal('modelContentChanged')
  }
}

export { MoveToCollectionCommand }
