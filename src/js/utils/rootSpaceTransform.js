import { Matrix } from '@svgdotjs/svg.js'
import { stylesheetPropertyState } from './stylesheetPropertyState.js'

const MATRIX_EPSILON = 1e-12
const CSS_MATRIX_EPSILON = 1e-6
// Firefox serializes computed transform coefficients with six significant digits.
const CSS_SERIALIZATION_EPSILON = 5e-6

function computedTransform(node) {
  const view = node?.ownerDocument?.defaultView
  const style = view?.getComputedStyle?.(node)
  return String(style?.getPropertyValue?.('transform') || style?.transform || '').trim()
}

function matricesEqual(left, right, epsilon = CSS_MATRIX_EPSILON) {
  return ['a', 'b', 'c', 'd', 'e', 'f'].every((key) => {
    const leftValue = Number(left[key])
    const rightValue = Number(right[key])
    const scale = Math.max(1, Math.abs(leftValue), Math.abs(rightValue))
    return Math.abs(leftValue - rightValue) <= epsilon * scale
  })
}

function parseComputedMatrix(value) {
  const match = /^matrix\((.*)\)$/i.exec(String(value).trim())
  if (!match) return null
  const values = match[1].trim().split(/[\s,]+/).map(Number)
  if (values.length !== 6 || !values.every(Number.isFinite)) return null
  const [a, b, c, d, e, f] = values
  return { a, b, c, d, e, f }
}

function hasOwnCssTransform(element) {
  const node = element?.node || element
  if (!node) return false

  const inline = String(node.style?.getPropertyValue?.('transform') || '').trim()
  if (inline) return true

  const attribute = node.getAttribute?.('transform')
  const computed = computedTransform(node)
  const stylesheetState = stylesheetPropertyState(node, 'transform')
  if (stylesheetState.matched || stylesheetState.inaccessible) return true
  if (!attribute) return Boolean(computed && computed !== 'none')

  // Presentation attributes lose to active author CSS. Inspect accessible
  // rules without touching persistent geometry, then compare the browser's
  // computed matrix to SVG.js's attribute matrix to catch animations and
  // styles from origins whose rules cannot be enumerated.
  if (!computed || computed === 'none') {
    if (typeof node.getScreenCTM !== 'function') return false
    return !matricesEqual(new Matrix(), element.matrixify())
  }

  const computedMatrix = parseComputedMatrix(computed)
  return !computedMatrix || !matricesEqual(computedMatrix, element.matrixify(), CSS_SERIALIZATION_EPSILON)
}

function matrixValues(source) {
  const matrix = new Matrix(source)
  const values = {
    a: Number(matrix.a),
    b: Number(matrix.b),
    c: Number(matrix.c),
    d: Number(matrix.d),
    e: Number(matrix.e),
    f: Number(matrix.f),
  }
  if (!Object.values(values).every(Number.isFinite)) {
    throw new Error('Transform matrix contains non-finite values.')
  }
  return values
}

function multiply(left, right) {
  return matrixValues(new Matrix(left).multiply(right))
}

function inverse(matrix) {
  const values = matrixValues(matrix)
  const determinant = values.a * values.d - values.b * values.c
  if (Math.abs(determinant) <= MATRIX_EPSILON) {
    throw new Error('Transform matrix is not invertible.')
  }
  return matrixValues(new Matrix(values).inverse())
}

function nativeScreenMatrix(node) {
  if (typeof node?.getScreenCTM !== 'function') return null
  try {
    const matrix = node.getScreenCTM()
    return matrix ? matrixValues(matrix) : null
  } catch (_error) {
    return null
  }
}

function parentToRootFromScreen(parent, root) {
  const parentScreen = nativeScreenMatrix(parent?.node)
  const rootScreen = nativeScreenMatrix(root?.node)
  if (!parentScreen || !rootScreen) return null
  return multiply(inverse(rootScreen), parentScreen)
}

function parentToRootFromAttributes(parent, root) {
  const chain = []
  let current = parent

  while (current?.node && current.node !== root?.node) {
    if (hasOwnCssTransform(current)) {
      throw new Error('A CSS transform cannot be resolved without a rendered coordinate matrix.')
    }
    chain.unshift(matrixValues(current.matrixify()))
    current = current.parent?.()
  }

  if (!current?.node || current.node !== root?.node) {
    throw new Error('Element is not inside the requested transform root.')
  }

  return chain.reduce(
    (combined, local) => multiply(combined, local),
    matrixValues(new Matrix()),
  )
}

function getParentToRootMatrix(element, root) {
  const parent = element?.parent?.()
  if (!parent || !root?.node) {
    throw new Error('Element does not have a valid transform parent or root.')
  }
  if (parent.node === root.node) return matrixValues(new Matrix())

  const rendered = parentToRootFromScreen(parent, root)
  return rendered || parentToRootFromAttributes(parent, root)
}

/**
 * Capture the matrices needed to apply a transform expressed in root SVG
 * coordinates without flattening an element or changing its parent.
 */
function captureRootTransformContext(element, root) {
  if (!element?.node || !root?.node) {
    throw new Error('Cannot capture a transform context for a detached element.')
  }
  if (hasOwnCssTransform(element)) {
    throw new Error('CSS transforms on selected elements cannot be composed safely.')
  }

  const parentToRoot = getParentToRootMatrix(element, root)
  inverse(parentToRoot)

  return {
    local: matrixValues(element.matrixify()),
    parentToRoot,
  }
}

/**
 * Return a new element-local matrix whose visible result is a rotation in the
 * root SVG coordinate system: P^-1 * R * P * M.
 */
function composeRootRotation(context, angle, centerPoint) {
  const numericAngle = Number(angle)
  const cx = Number(centerPoint?.x)
  const cy = Number(centerPoint?.y)
  if (![numericAngle, cx, cy].every(Number.isFinite)) {
    throw new Error('Rotation angle and center point must be finite.')
  }

  const parentToRoot = matrixValues(context?.parentToRoot)
  const local = matrixValues(context?.local)
  const rotation = matrixValues(new Matrix().rotate(numericAngle, cx, cy))

  return multiply(
    multiply(
      multiply(inverse(parentToRoot), rotation),
      parentToRoot,
    ),
    local,
  )
}

export {
  captureRootTransformContext,
  composeRootRotation,
  getParentToRootMatrix,
}
