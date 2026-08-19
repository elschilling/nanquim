const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0])

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function identityMatrix() {
  return [...IDENTITY_MATRIX]
}

function normaliseMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6) return identityMatrix()

  return [
    finiteNumber(matrix[0], 1),
    finiteNumber(matrix[1], 0),
    finiteNumber(matrix[2], 0),
    finiteNumber(matrix[3], 1),
    finiteNumber(matrix[4], 0),
    finiteNumber(matrix[5], 0),
  ]
}

const normalizeMatrix = normaliseMatrix

/**
 * Multiply affine matrices using SVG's [a, b, c, d, e, f] convention.
 * `multiplyMatrices(left, right)` applies `right`, then `left`.
 */
function multiplyMatrices(left, right) {
  const [a1, b1, c1, d1, e1, f1] = normaliseMatrix(left)
  const [a2, b2, c2, d2, e2, f2] = normaliseMatrix(right)

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function translationMatrix(x = 0, y = 0) {
  return [1, 0, 0, 1, finiteNumber(x), finiteNumber(y)]
}

function rotationMatrix(degrees = 0) {
  const radians = finiteNumber(degrees) * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [cosine, sine, -sine, cosine, 0, 0]
}

function scaleMatrix(x = 1, y = x) {
  return [finiteNumber(x, 1), 0, 0, finiteNumber(y, 1), 0, 0]
}

function composeTransform({
  translation = { x: 0, y: 0 },
  translationX,
  translationY,
  rotation = 0,
  scale = { x: 1, y: 1 },
  scaleX,
  scaleY,
  pivot = { x: 0, y: 0 },
  pivotX,
  pivotY,
} = {}) {
  const tx = finiteNumber(translationX, finiteNumber(translation && translation.x))
  const ty = finiteNumber(translationY, finiteNumber(translation && translation.y))
  const sx = finiteNumber(scaleX, finiteNumber(scale && scale.x, 1))
  const sy = finiteNumber(scaleY, finiteNumber(scale && scale.y, 1))
  const px = finiteNumber(pivotX, finiteNumber(pivot && pivot.x))
  const py = finiteNumber(pivotY, finiteNumber(pivot && pivot.y))

  let matrix = translationMatrix(-px, -py)
  matrix = multiplyMatrices(scaleMatrix(sx, sy), matrix)
  matrix = multiplyMatrices(rotationMatrix(rotation), matrix)
  matrix = multiplyMatrices(translationMatrix(px, py), matrix)
  return multiplyMatrices(translationMatrix(tx, ty), matrix)
}

function transformPoint(matrix, pointOrX, y) {
  const [a, b, c, d, e, f] = normaliseMatrix(matrix)
  const point = typeof pointOrX === 'object' && pointOrX !== null
    ? pointOrX
    : { x: pointOrX, y }
  const xValue = finiteNumber(point.x)
  const yValue = finiteNumber(point.y)

  return {
    x: a * xValue + c * yValue + e,
    y: b * xValue + d * yValue + f,
  }
}

function determinant(matrix) {
  const [a, b, c, d] = normaliseMatrix(matrix)
  return a * d - b * c
}

function invertMatrix(matrix) {
  const [a, b, c, d, e, f] = normaliseMatrix(matrix)
  const value = a * d - b * c

  if (Math.abs(value) < Number.EPSILON) return null

  return [
    d / value,
    -b / value,
    -c / value,
    a / value,
    (c * f - d * e) / value,
    (b * e - a * f) / value,
  ]
}

function isIdentityMatrix(matrix, epsilon = 1e-12) {
  const value = normaliseMatrix(matrix)
  return value.every((component, index) => (
    Math.abs(component - IDENTITY_MATRIX[index]) <= epsilon
  ))
}

export {
  IDENTITY_MATRIX,
  composeTransform,
  determinant,
  finiteNumber,
  identityMatrix,
  invertMatrix,
  isIdentityMatrix,
  multiplyMatrices,
  normaliseMatrix,
  normalizeMatrix,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix,
}
