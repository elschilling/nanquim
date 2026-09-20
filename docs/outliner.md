# Organize the Outliner

Click an element, then hold **Shift** and click another to select the visible
range between them, in either direction. Another Shift-click adjusts the range
from the same starting row; separately selected elements stay selected. Ordinary
clicks keep toggling individual elements. Hidden and locked content and children
inside collapsed rows are skipped. Groups are selected as a whole without adding
their children twice. Element ranges exclude collection headers; Shift-clicking
between collection headers selects collections instead of their contents.

Drag a row in the Outliner to change drawing order or move geometry between
collections and ordinary groups. Dragging a selected row moves the selected
elements together, in their existing drawing order. Dragging an unselected row
moves only that element. Dragging geometry excludes selected collection rows;
dragging a collection moves only selected collections.

Tree order follows SVG paint order: later siblings paint over earlier siblings.

To choose a collection without dragging, select the elements, place the pointer
over the Outliner, and press **M**. Choose an existing collection or **New
collection…**, enter its name, and click **Move**. Creating a collection and
moving the selection uses one Undo step. Escape or Cancel leaves the drawing
unchanged. The shortcut is available while no command is running and does not
interrupt typing in other fields. Selected collection headers are excluded.

- Drop geometry anywhere on a collection header to move it into that collection.
- Drop near an element or group row's top or bottom edge to place the elements
  before or after it. Drop in the middle of a group row to place them inside it.
  Collapsed containers also accept drops.
- Drag collection rows above or below other collections to reorder them.
  Collections remain at the drawing root.

The highlighted row or insertion line shows the destination. Release the mouse
to finish, or press Escape to cancel. Undo and Redo restore the previous parents,
drawing order, and transforms. Moving geometry between transformed groups keeps
its position in the drawing. Elements inherit their destination collection's
style while retaining explicit style overrides.

Each movable row also has a keyboard move button. Focus that button and press
Enter to pick up the row. Use Up and Down to choose a destination row, and Left
and Right to choose before, inside, or after where supported. Press Enter to
drop or Escape to cancel. Focus returns to the moved row after a completed move.

Model geometry stays in Model Space. In Paper Space, only annotations can be
reorganized; Model collections and Paper viewport rows cannot be moved there.
Locked content, block-definition editing, and Geometry Nodes internals are
protected. A Geometry Nodes wrapper can be moved as a whole, but cannot accept
ordinary geometry as new children. Drops that would put a group inside itself
or one of its descendants are rejected.
