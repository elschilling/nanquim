import { MAX_SVG_GEOMETRY_MAGNITUDE } from './svgNumericBounds.js'
import { stylesheetPropertyState } from './stylesheetPropertyState.js'

const MIN_IMAGE_DIMENSION = 0.000001
const CROP_NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?'
const CROP_PERCENT = new RegExp(`^(${CROP_NUMBER})%$`, 'i')

function readCropInsets(value) {
  if (value == null || String(value).trim() === '' || String(value).trim() === 'none') {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  const match = /^inset\(\s*([^()]*)\s*\)\s+fill-box$/i.exec(String(value).trim())
  if (!match || match[1].length > 256) return null
  const tokens = match[1].trim().split(/\s+/)
  if (tokens.length < 1 || tokens.length > 4) return null
  const values = tokens.map(token => {
    const percentage = CROP_PERCENT.exec(token)
    return percentage ? Number(percentage[1]) / 100 : NaN
  })
  if (!values.every(value => Number.isFinite(value) && value >= 0 && value < 1)) return null
  const [top, right = top, bottom = top, left = right] = values
  if (top + bottom >= 1 || left + right >= 1) return null
  return { top, right, bottom, left }
}

function matchingCropInsets(first, second) {
  return first && second && ['top', 'right', 'bottom', 'left'].every(key => (
    // Chromium and Firefox round computed percentages to six significant digits.
    Math.abs(first[key] - second[key]) <= 0.000001
  ))
}

function cropInsets(bounds) {
  return bounds.cropEditable === false ? null : readCropInsets(bounds['clip-path'])
}

function validBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every(key => (
    Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= MAX_SVG_GEOMETRY_MAGNITUDE
  )) && bounds.width > 0 && bounds.height > 0
    && bounds.x + bounds.width <= MAX_SVG_GEOMETRY_MAGNITUDE
    && bounds.y + bounds.height <= MAX_SVG_GEOMETRY_MAGNITUDE
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function readImageGripBounds(element) {
  const bounds = {}
  const attributes = {}
  for (const name of ['x', 'y', 'width', 'height']) {
    attributes[name] = element.node?.getAttribute(name) ?? null
    let value
    try {
      // SVGLength resolves px, physical units, and percentages in local space.
      value = element.node?.[name]?.baseVal?.value
    } catch (_error) {
      // Detached nodes may not have a resolved length. Numeric SVG.js values
      // also keep the non-rendering test environment usable.
    }
    bounds[name] = Number.isFinite(value) ? value : element.attr(name)
  }
  const clip = element.node?.getAttribute('clip-path') ?? null
  if (clip !== null) {
    bounds['clip-path'] = clip
    attributes['clip-path'] = clip
  }
  // Presentation attributes must not replace a clip owned by CSS. Browsers
  // normalize inset shorthand, so compare parsed values instead of strings.
  if (element.node?.style?.getPropertyValue('clip-path')?.trim()) {
    bounds.cropEditable = false
  } else {
    try {
      const computed = element.node?.ownerDocument?.defaultView?.getComputedStyle(element.node).clipPath
      // jsdom has no SVG layout and reports `none` for presentation attributes.
      const renderedClip = computed !== 'none' || typeof element.node?.getScreenCTM === 'function'
      if (computed && renderedClip && !matchingCropInsets(readCropInsets(clip), readCropInsets(computed))) {
        bounds.cropEditable = false
      }
    } catch (_error) {
      // Detached SVG nodes may not expose computed styles.
    }
  }
  return { ...bounds, attributes }
}

function canCropImageElement(element) {
  const node = element?.node
  if (!node || node.style?.getPropertyValue('all')?.trim()) return false
  const bounds = readImageGripBounds(element)
  if (!validBounds(bounds) || !cropInsets(bounds)) return false
  const state = stylesheetPropertyState(node, ['clip-path', 'all'])
  return !state.matched && !state.inaccessible
}

function getImageVisibleBounds(bounds) {
  if (!validBounds(bounds)) return null
  const { x, y, width, height } = bounds
  const crop = cropInsets(bounds)
  if (!crop) return { x, y, width, height }
  return {
    x: x + width * crop.left,
    y: y + height * crop.top,
    width: width * (1 - (crop.left + crop.right)),
    height: height * (1 - (crop.top + crop.bottom)),
  }
}

function getImageGripPoints(bounds) {
  const visible = getImageVisibleBounds(bounds)
  if (!visible) return []
  const { x, y, width, height } = visible
  const points = [
    { x, y, index: 0 },
    { x: x + width, y, index: 1 },
    { x: x + width, y: y + height, index: 2 },
    { x, y: y + height, index: 3 },
  ]
  if (cropInsets(bounds)) {
    points.push(
      { x: x + width / 2, y, index: 4 },
      { x: x + width, y: y + height / 2, index: 5 },
      { x: x + width / 2, y: y + height, index: 6 },
      { x, y: y + height / 2, index: 7 },
    )
  }
  points.push({ x: x + width / 2, y: y + height / 2, index: 8 })
  return points
}

function cropFromSide(original, index, localPoint) {
  const crop = cropInsets(original)
  if (!crop) return null
  const vertical = index === 4 || index === 6
  const dimension = vertical ? original.height : original.width
  const remaining = vertical ? 1 - (crop.top + crop.bottom) : 1 - (crop.left + crop.right)
  const minimum = Math.min(remaining, Math.max(0.000001, MIN_IMAGE_DIMENSION / dimension))
  const coordinate = vertical ? localPoint.y : localPoint.x
  const origin = vertical ? original.y : original.x
  const fraction = (coordinate - origin) / dimension
  if (index === 4) crop.top = clamp(fraction, 0, 1 - crop.bottom - minimum)
  if (index === 5) crop.right = clamp(1 - fraction, 0, 1 - crop.left - minimum)
  if (index === 6) crop.bottom = clamp(1 - fraction, 0, 1 - crop.top - minimum)
  if (index === 7) crop.left = clamp(fraction, 0, 1 - crop.right - minimum)
  if (Object.values(crop).every(value => value === 0)) return { 'clip-path': null }
  const percentages = ['top', 'right', 'bottom', 'left'].map(key => `${crop[key] * 100}%`)
  return { 'clip-path': `inset(${percentages.join(' ')}) fill-box` }
}

function imageBoundsFromGrip(original, index, localPoint) {
  if (!validBounds(original) || !Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) return null
  const { x, y, width, height } = original
  const visible = getImageVisibleBounds(original)
  const clipping = Object.hasOwn(original, 'clip-path') ? { 'clip-path': original['clip-path'] } : {}
  const limit = MAX_SVG_GEOMETRY_MAGNITUDE
  if (Number.isInteger(index) && index >= 4 && index <= 7) return cropFromSide(original, index, localPoint)
  if (index === 8) {
    return {
      x: clamp(x + localPoint.x - (visible.x + visible.width / 2), -limit, limit - width),
      y: clamp(y + localPoint.y - (visible.y + visible.height / 2), -limit, limit - height),
      width,
      height,
      ...clipping,
    }
  }
  if (!Number.isInteger(index) || index < 0 || index > 3) return null

  const left = index === 0 || index === 3
  const top = index === 0 || index === 1
  const anchorX = left ? visible.x + visible.width : visible.x
  const anchorY = top ? visible.y + visible.height : visible.y
  const longest = Math.max(visible.width, visible.height)
  const unitX = visible.width / longest
  const unitY = visible.height / longest
  if (unitX === 0 || unitY === 0) return null

  // Project onto the original diagonal to keep the closest proportional box.
  // A positive minimum prevents crossing the opposite corner from mirroring it.
  const dx = (clamp(localPoint.x, -limit, limit) - anchorX) * (left ? -1 : 1)
  const dy = (clamp(localPoint.y, -limit, limit) - anchorY) * (top ? -1 : 1)
  const projectedLength = (dx * unitX + dy * unitY) / (unitX ** 2 + unitY ** 2)
  const minimum = Math.min(1, MIN_IMAGE_DIMENSION / Math.min(visible.width, visible.height))
  let maximum = Math.min(limit / width, limit / height)
  for (const [anchor, edge] of [[anchorX, x], [anchorX, x + width], [anchorY, y], [anchorY, y + height]]) {
    const direction = edge - anchor
    if (direction > 0) maximum = Math.min(maximum, (limit - anchor) / direction)
    if (direction < 0) maximum = Math.min(maximum, (-limit - anchor) / direction)
  }
  const scale = clamp(projectedLength / longest, minimum, maximum)
  return {
    x: anchorX + (x - anchorX) * scale,
    y: anchorY + (y - anchorY) * scale,
    width: width * scale,
    height: height * scale,
    ...clipping,
  }
}

export { canCropImageElement, getImageGripPoints, getImageVisibleBounds, imageBoundsFromGrip, readImageGripBounds }
