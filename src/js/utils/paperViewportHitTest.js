// Paper viewport content can have an unclipped Model bounding box. Test the
// pointer against the frame in its own space, independently of that content.
function isPointInsidePaperViewport(point, viewport, paperMatrix, frameMatrix) {
  const matrixKeys = ['a', 'b', 'c', 'd', 'e', 'f']
  if (!point || !viewport || !paperMatrix || !frameMatrix) return false
  if (![point.x, point.y, viewport.x, viewport.y, viewport.w, viewport.h]
    .every(Number.isFinite)) return false
  if (viewport.w <= 0 || viewport.h <= 0) return false
  if (!matrixKeys.every(key => Number.isFinite(paperMatrix[key]) && Number.isFinite(frameMatrix[key]))) return false

  const paperDeterminant = paperMatrix.a * paperMatrix.d - paperMatrix.b * paperMatrix.c
  const frameDeterminant = frameMatrix.a * frameMatrix.d - frameMatrix.b * frameMatrix.c
  if (!Number.isFinite(paperDeterminant) || paperDeterminant === 0
    || !Number.isFinite(frameDeterminant) || frameDeterminant === 0) return false

  const screenX = paperMatrix.a * point.x + paperMatrix.c * point.y + paperMatrix.e
  const screenY = paperMatrix.b * point.x + paperMatrix.d * point.y + paperMatrix.f
  const localX = (frameMatrix.d * (screenX - frameMatrix.e)
    - frameMatrix.c * (screenY - frameMatrix.f)) / frameDeterminant
  const localY = (-frameMatrix.b * (screenX - frameMatrix.e)
    + frameMatrix.a * (screenY - frameMatrix.f)) / frameDeterminant

  return Number.isFinite(localX) && Number.isFinite(localY)
    && localX >= viewport.x && localX <= viewport.x + viewport.w
    && localY >= viewport.y && localY <= viewport.y + viewport.h
}

export { isPointInsidePaperViewport }
