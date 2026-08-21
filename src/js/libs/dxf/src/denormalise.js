import cloneDeep from 'lodash/cloneDeep'

import logger from './util/logger'

const DEFAULT_DXF_EXPANSION_LIMITS = Object.freeze({
  maxExpandedEntities: 100000,
  maxInsertDepth: 32,
  maxInsertInstances: 100000,
})
const MAX_DXF_COORDINATE = 1000000000

class DxfExpansionError extends RangeError {
  constructor(code, message) {
    super(message)
    this.name = 'DxfExpansionError'
    this.code = code
  }
}

function positiveSafeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function normalizedLimits(options = {}) {
  return {
    maxExpandedEntities: positiveSafeInteger(
      options.maxExpandedEntities,
      DEFAULT_DXF_EXPANSION_LIMITS.maxExpandedEntities,
    ),
    maxInsertDepth: positiveSafeInteger(
      options.maxInsertDepth,
      DEFAULT_DXF_EXPANSION_LIMITS.maxInsertDepth,
    ),
    maxInsertInstances: positiveSafeInteger(
      options.maxInsertInstances,
      DEFAULT_DXF_EXPANSION_LIMITS.maxInsertInstances,
    ),
  }
}

function insertCount(value, label) {
  const count = value ?? 1
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new DxfExpansionError(
      'invalid-insert-array',
      `DXF INSERT ${label} must be a positive safe integer.`,
    )
  }
  return count
}

function incrementReport(report, field) {
  if (!report || typeof report !== 'object') return
  const current = Number.isSafeInteger(report[field]) && report[field] >= 0 ? report[field] : 0
  report[field] = current + 1
}

function insertTransformNumber(value, fallback, label, options = {}) {
  if (value === undefined || value === null) return fallback
  if (
    !Number.isFinite(value)
    || Math.abs(value) > MAX_DXF_COORDINATE
    || (options.nonZero === true && value === 0)
  ) {
    throw new DxfExpansionError(
      'invalid-insert-transform',
      `DXF INSERT ${label} must be a finite in-range number${options.nonZero === true ? ' other than zero' : ''}.`,
    )
  }
  return value
}

function offsetBlockEntity(entity, block) {
  const blockX = insertTransformNumber(block.x, 0, 'block base X')
  const blockY = insertTransformNumber(block.y, 0, 'block base Y')
  switch (entity.type) {
    case 'LINE': {
      entity.start.x -= blockX
      entity.start.y -= blockY
      entity.end.x -= blockX
      entity.end.y -= blockY
      break
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      entity.vertices.forEach((vertex) => {
        vertex.x -= blockX
        vertex.y -= blockY
      })
      break
    }
    case 'CIRCLE':
    case 'ELLIPSE':
    case 'ARC': {
      entity.x -= blockX
      entity.y -= blockY
      break
    }
    case 'SPLINE': {
      entity.controlPoints.forEach((point) => {
        point.x -= blockX
        point.y -= blockY
      })
      break
    }
    case 'INSERT': {
      entity.x = insertTransformNumber(entity.x, 0, 'nested X') - blockX
      entity.y = insertTransformNumber(entity.y, 0, 'nested Y') - blockY
      break
    }
    default:
      break
  }
  return entity
}

export default (parseResult, options = {}) => {
  const limits = normalizedLimits(options)
  const report = options.report && typeof options.report === 'object' ? options.report : null
  const blocksByName = new Map()
  ;(parseResult.blocks || []).forEach((block) => {
    if (typeof block?.name === 'string') blocksByName.set(block.name, block)
  })

  const expanded = []
  let insertInstanceCount = 0
  let insertGroupCounter = 0

  const gatherEntities = (entities, transforms, ancestry = []) => {
    ;(entities || []).forEach((sourceEntity) => {
      if (sourceEntity.type !== 'INSERT') {
        if (expanded.length >= limits.maxExpandedEntities) {
          throw new DxfExpansionError(
            'expanded-entity-limit',
            `DXF expansion exceeds ${limits.maxExpandedEntities} entities.`,
          )
        }
        const entity = cloneDeep(sourceEntity)
        entity.transforms = transforms.slice().reverse()
        expanded.push(entity)
        return
      }

      const insert = sourceEntity
      const blockName = typeof insert.block === 'string' ? insert.block : ''
      const block = blocksByName.get(blockName)
      if (!block) {
        logger.error('no block found for DXF insert')
        incrementReport(report, 'missingBlockInserts')
        return
      }
      if (ancestry.includes(blockName)) {
        throw new DxfExpansionError(
          'insert-cycle',
          'The DXF contains a recursive block INSERT cycle.',
        )
      }
      if (ancestry.length >= limits.maxInsertDepth) {
        throw new DxfExpansionError(
          'insert-depth-limit',
          `DXF block INSERT nesting exceeds ${limits.maxInsertDepth} levels.`,
        )
      }

      const rowCount = insertCount(insert.rowCount, 'row count')
      const columnCount = insertCount(insert.columnCount, 'column count')
      const remainingInstances = limits.maxInsertInstances - insertInstanceCount
      if (
        columnCount > remainingInstances
        || rowCount > Math.floor(remainingInstances / columnCount)
      ) {
        throw new DxfExpansionError(
          'insert-instance-limit',
          `DXF INSERT expansion exceeds ${limits.maxInsertInstances} instances.`,
        )
      }

      const rowSpacing = insertTransformNumber(insert.rowSpacing, 0, 'row spacing')
      const columnSpacing = insertTransformNumber(insert.columnSpacing, 0, 'column spacing')
      const rotation = insertTransformNumber(insert.rotation, 0, 'rotation')
      const insertX = insertTransformNumber(insert.x, 0, 'X')
      const insertY = insertTransformNumber(insert.y, 0, 'Y')
      const scaleX = insertTransformNumber(insert.scaleX, 1, 'X scale', { nonZero: true })
      const scaleY = insertTransformNumber(insert.scaleY, 1, 'Y scale', { nonZero: true })
      const scaleZ = insertTransformNumber(insert.scaleZ, 1, 'Z scale', { nonZero: true })
      const extrusionX = insertTransformNumber(insert.extrusionX, 0, 'extrusion X')
      const extrusionY = insertTransformNumber(insert.extrusionY, 0, 'extrusion Y')
      const extrusionZ = insertTransformNumber(insert.extrusionZ, 1, 'extrusion Z')
      let rowVector
      let columnVector
      if (rowCount > 1 || columnCount > 1) {
        const angle = (rotation * Math.PI) / 180
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        rowVector = { x: -sin * rowSpacing, y: cos * rowSpacing }
        columnVector = { x: cos * columnSpacing, y: sin * columnSpacing }
      } else {
        rowVector = { x: 0, y: 0 }
        columnVector = { x: 0, y: 0 }
      }

      const nextAncestry = [...ancestry, blockName]
      for (let row = 0; row < rowCount; row += 1) {
        for (let column = 0; column < columnCount; column += 1) {
          if (insertInstanceCount >= limits.maxInsertInstances) {
            throw new DxfExpansionError(
              'insert-instance-limit',
              `DXF INSERT expansion exceeds ${limits.maxInsertInstances} instances.`,
            )
          }
          insertInstanceCount += 1
          insertGroupCounter += 1
          const transformedX = insertX + rowVector.x * row + columnVector.x * column
          const transformedY = insertY + rowVector.y * row + columnVector.y * column
          if (
            !Number.isFinite(transformedX)
            || !Number.isFinite(transformedY)
            || Math.abs(transformedX) > MAX_DXF_COORDINATE
            || Math.abs(transformedY) > MAX_DXF_COORDINATE
          ) {
            throw new DxfExpansionError(
              'invalid-insert-transform',
              'DXF INSERT array coordinates exceed the supported numeric range.',
            )
          }
          const transform = {
            x: transformedX,
            y: transformedY,
            scaleX,
            scaleY,
            scaleZ,
            extrusionX,
            extrusionY,
            extrusionZ,
            rotation,
          }
          const nextTransforms = [...transforms, transform]
          const groupBase = insert.handle || blockName || 'insert'
          const insertGroup = `${groupBase}-${insertGroupCounter}`
          ;(block.entities || []).forEach((blockEntity) => {
            const entity = offsetBlockEntity(cloneDeep(blockEntity), block)
            entity.layer = insert.layer
            entity.insertGroup = insertGroup
            entity.insertName = blockName
            gatherEntities([entity], nextTransforms, nextAncestry)
          })
        }
      }
    })
  }

  gatherEntities(parseResult.entities || [], [])
  if (report) {
    report.expandedEntities = expanded.length
    report.insertInstances = insertInstanceCount
  }
  return expanded
}

export {
  DEFAULT_DXF_EXPANSION_LIMITS,
  DxfExpansionError,
}
