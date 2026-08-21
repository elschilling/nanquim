function invalidateSpatialIndexes(editor) {
  editor?.spatialIndex?.markDirty()
  editor?.fullSpatialIndex?.markDirty()
}

export { invalidateSpatialIndexes }
