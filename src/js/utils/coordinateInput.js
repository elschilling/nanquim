/**
 * Resolve the most recently typed coordinate for an interactive command.
 * `@x,y` is relative to the command's reference point; `#x,y` (and unprefixed
 * coordinates for backward compatibility) is in world coordinates.
 */
function resolveInputCoordinate(editor, referencePoint = editor.coordinates || { x: 0, y: 0 }) {
  const coordinate = editor.inputCoord
  if (!coordinate) return null

  if (editor.inputCoordMode === 'relative') {
    return {
      x: referencePoint.x + coordinate.x,
      y: referencePoint.y + coordinate.y,
    }
  }

  return { x: coordinate.x, y: coordinate.y }
}

export { resolveInputCoordinate }
