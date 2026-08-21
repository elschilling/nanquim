const MAX_SVG_GEOMETRY_MAGNITUDE = 1000000000
const MAX_SVG_REFERENCE_DEPTH = 128
const MAX_SVG_REFERENCE_WORK = 100000
const MAX_SAFE_STROKE_MITER_LIMIT = 4
const DEFAULT_STROKE_MITER_EXTENT_FACTOR = MAX_SAFE_STROKE_MITER_LIMIT / 2

const SVG_NUMBER_PREFIX = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/
const SVG_NUMBER_GLOBAL = /[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/g
const PATH_COMMANDS = new Set('AaCcHhLlMmQqSsTtVvZz')
const PATH_ARGUMENTS = Object.freeze({
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
})
const ABSOLUTE_LENGTH_FACTORS = Object.freeze({
  '': 1,
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
  px: 1,
})
const GEOMETRY_CSS_PROPERTIES = new Set([
  'baseline-shift', 'clip',
  'font-size', 'font-size-adjust', 'letter-spacing',
  'marker', 'marker-end', 'marker-mid', 'marker-start',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'stroke-width',
  'transform', 'transform-origin', 'word-spacing',
])
const CSS_MARKER_PROPERTIES = new Set(['marker', 'marker-end', 'marker-mid', 'marker-start'])
const MARKER_GEOMETRY_ELEMENTS = new Set(['line', 'path', 'polygon', 'polyline'])
const LENGTH_ATTRIBUTES = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy',
  'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height',
  'pathlength', 'textlength', 'startoffset', 'refx', 'refy',
  'markerwidth', 'markerheight', 'offset',
])
const NON_NEGATIVE_LENGTH_ATTRIBUTES = new Set([
  'r', 'rx', 'ry', 'fr', 'width', 'height', 'pathlength', 'textlength',
  'markerwidth', 'markerheight',
])
const PRESENTATION_GEOMETRY_ATTRIBUTES = new Set([
  'baseline-shift', 'font-size', 'font-size-adjust', 'letter-spacing',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'stroke-width',
  'transform-origin', 'word-spacing',
])
const PAINT_EXTENT_PROPERTIES = new Set([
  'baseline-shift', 'font-size', 'letter-spacing', 'stroke-width', 'word-spacing',
])
const TRANSFORM_ATTRIBUTES = new Set([
  'transform', 'patterntransform', 'gradienttransform',
])
const IDENTITY_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })

function isWhitespace(character) {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t' || character === '\f'
}

function boundedNumber(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_SVG_GEOMETRY_MAGNITUDE
}

function boundedMatrix(matrix) {
  return matrix && Object.values(matrix).every(boundedNumber)
}

function multiplyMatrices(first, second) {
  const matrix = {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f,
  }
  return boundedMatrix(matrix) ? matrix : null
}

function translateMatrix(x, y) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }
}

function scaleMatrix(x, y) {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }
}

function rotateMatrix(degrees) {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 }
}

function skipSeparators(source, start) {
  let cursor = start
  while (cursor < source.length && (isWhitespace(source[cursor]) || source[cursor] === ',')) cursor += 1
  return cursor
}

function readNumber(source, start, { allowUnits = false } = {}) {
  const match = source.slice(start).match(SVG_NUMBER_PREFIX)
  if (!match) return null
  let cursor = start + match[0].length
  let unit = ''
  if (allowUnits) {
    const unitMatch = source.slice(cursor).match(/^(?:%|[a-z]+)/i)
    if (unitMatch) {
      unit = unitMatch[0].toLowerCase()
      cursor += unitMatch[0].length
    }
  }
  const numeric = Number(match[0])
  if (!boundedNumber(numeric)) return null
  return { cursor, numeric, unit }
}

function convertLength(numeric, unit) {
  if (unit === '%') {
    const extent = Math.abs(numeric) * MAX_SVG_GEOMETRY_MAGNITUDE / 100
    if (!boundedNumber(extent)) return null
    return {
      maximum: numeric < 0 ? 0 : extent,
      minimum: numeric < 0 ? -extent : 0,
      relative: true,
      value: numeric,
    }
  }
  if (unit === 'em' || unit === 'ex' || unit === 'rem') {
    const extent = Math.abs(numeric) * MAX_SVG_GEOMETRY_MAGNITUDE
    if (!boundedNumber(extent)) return null
    return {
      maximum: numeric < 0 ? 0 : extent,
      minimum: numeric < 0 ? -extent : 0,
      relative: true,
      value: numeric,
    }
  }
  const factor = ABSOLUTE_LENGTH_FACTORS[unit]
  if (factor === undefined) return null
  const value = numeric * factor
  if (!boundedNumber(value)) return null
  return { maximum: value, minimum: value, relative: false, value }
}

function parseNumberSequence(source, options = {}) {
  const text = String(source).trim()
  if (!text) return null
  const values = []
  let cursor = 0
  let previousEnd = -1

  while (cursor < text.length) {
    const beforeSeparators = cursor
    cursor = skipSeparators(text, cursor)
    const hadSeparator = cursor > beforeSeparators
    if (cursor >= text.length) break
    if (previousEnd >= 0 && !hadSeparator && text[cursor] !== '+' && text[cursor] !== '-') return null

    const token = readNumber(text, cursor, { allowUnits: options.allowUnits === true })
    if (!token) return null
    const converted = options.allowUnits ? convertLength(token.numeric, token.unit) : {
      maximum: token.numeric,
      minimum: token.numeric,
      relative: false,
      value: token.numeric,
    }
    if (!converted) return null
    if (options.nonNegative === true && token.numeric < 0) return null
    values.push(converted)
    if (values.length > (options.maxValues || 1000000)) return null
    previousEnd = token.cursor
    cursor = token.cursor
  }

  if (values.length < (options.minValues || 1)) return null
  if (options.maxValues && values.length > options.maxValues) return null
  if (options.even === true && values.length % 2 !== 0) return null
  return values
}

function transformArgumentValue(argument, type) {
  if (type === 'number') return argument.unit === '' ? argument.numeric : null
  if (type === 'length') {
    if (argument.unit === '%') return null
    const converted = convertLength(argument.numeric, argument.unit)
    return converted && !converted.relative ? converted.value : null
  }
  if (type === 'angle') {
    if (argument.unit === '' || argument.unit === 'deg') return argument.numeric
    if (argument.unit === 'rad') return argument.numeric * 180 / Math.PI
    if (argument.unit === 'grad') return argument.numeric * 0.9
    if (argument.unit === 'turn') return argument.numeric * 360
  }
  return null
}

function readTransformArguments(source, css) {
  const text = String(source).trim()
  if (!text) return []
  const values = []
  let cursor = 0
  let previousEnd = -1
  while (cursor < text.length) {
    const beforeSeparators = cursor
    cursor = skipSeparators(text, cursor)
    const hadSeparator = cursor > beforeSeparators
    if (cursor >= text.length) break
    if (previousEnd >= 0 && !hadSeparator && text[cursor] !== '+' && text[cursor] !== '-') return null
    const token = readNumber(text, cursor, { allowUnits: css })
    if (!token) return null
    values.push({ numeric: token.numeric, unit: token.unit })
    if (values.length > 16) return null
    previousEnd = token.cursor
    cursor = token.cursor
  }
  return values
}

function matrixForTransformFunction(name, argumentsList, css) {
  const lowerName = name.toLowerCase()
  const number = (index) => transformArgumentValue(argumentsList[index], 'number')
  const length = (index) => transformArgumentValue(argumentsList[index], css ? 'length' : 'number')
  const angle = (index) => transformArgumentValue(argumentsList[index], css ? 'angle' : 'number')
  let matrix = null

  if (lowerName === 'matrix' && argumentsList.length === 6) {
    const values = argumentsList.map((_entry, index) => number(index))
    if (values.every(value => value !== null && boundedNumber(value))) {
      matrix = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] }
    }
  } else if (lowerName === 'translate' && (argumentsList.length === 1 || argumentsList.length === 2)) {
    const x = length(0)
    const y = argumentsList.length === 2 ? length(1) : 0
    if (x !== null && y !== null) matrix = translateMatrix(x, y)
  } else if (css && lowerName === 'translatex' && argumentsList.length === 1) {
    const x = length(0)
    if (x !== null) matrix = translateMatrix(x, 0)
  } else if (css && lowerName === 'translatey' && argumentsList.length === 1) {
    const y = length(0)
    if (y !== null) matrix = translateMatrix(0, y)
  } else if (lowerName === 'scale' && (argumentsList.length === 1 || argumentsList.length === 2)) {
    const x = number(0)
    const y = argumentsList.length === 2 ? number(1) : x
    if (x !== null && y !== null) matrix = scaleMatrix(x, y)
  } else if (css && lowerName === 'scalex' && argumentsList.length === 1) {
    const x = number(0)
    if (x !== null) matrix = scaleMatrix(x, 1)
  } else if (css && lowerName === 'scaley' && argumentsList.length === 1) {
    const y = number(0)
    if (y !== null) matrix = scaleMatrix(1, y)
  } else if (lowerName === 'rotate' && (argumentsList.length === 1 || (!css && argumentsList.length === 3))) {
    const degrees = angle(0)
    if (degrees !== null && boundedNumber(degrees)) {
      matrix = rotateMatrix(degrees)
      if (argumentsList.length === 3) {
        const x = length(1)
        const y = length(2)
        if (x === null || y === null) return null
        matrix = multiplyMatrices(
          multiplyMatrices(translateMatrix(x, y), matrix),
          translateMatrix(-x, -y),
        )
      }
    }
  } else if (lowerName === 'skewx' && argumentsList.length === 1) {
    const degrees = angle(0)
    if (degrees !== null) matrix = { a: 1, b: 0, c: Math.tan(degrees * Math.PI / 180), d: 1, e: 0, f: 0 }
  } else if (lowerName === 'skewy' && argumentsList.length === 1) {
    const degrees = angle(0)
    if (degrees !== null) matrix = { a: 1, b: Math.tan(degrees * Math.PI / 180), c: 0, d: 1, e: 0, f: 0 }
  }

  return boundedMatrix(matrix) ? matrix : null
}

function parseBoundedTransform(rawValue, options = {}) {
  const source = String(rawValue).trim()
  const css = options.css === true
  if (css && source.toLowerCase() === 'none') return { ...IDENTITY_MATRIX }
  if (!source) return null

  let cursor = 0
  let result = { ...IDENTITY_MATRIX }
  let functions = 0
  while (cursor < source.length) {
    while (cursor < source.length && (isWhitespace(source[cursor]) || source[cursor] === ',')) cursor += 1
    if (cursor >= source.length) break
    const nameMatch = source.slice(cursor).match(/^[a-z]+/i)
    if (!nameMatch) return null
    cursor += nameMatch[0].length
    while (isWhitespace(source[cursor])) cursor += 1
    if (source[cursor] !== '(') return null
    const close = source.indexOf(')', cursor + 1)
    if (close < 0 || source.slice(cursor + 1, close).includes('(')) return null
    const argumentsList = readTransformArguments(source.slice(cursor + 1, close), css)
    if (!argumentsList) return null
    const matrix = matrixForTransformFunction(nameMatch[0], argumentsList, css)
    if (!matrix) return null
    result = multiplyMatrices(result, matrix)
    if (!result) return null
    functions += 1
    if (functions > 128) return null
    cursor = close + 1
  }
  return functions > 0 ? result : null
}

function geometryCssValueIsBounded(property, value) {
  if (!GEOMETRY_CSS_PROPERTIES.has(property)) return true
  if (property === 'transform') return parseBoundedTransform(value, { css: true }) !== null
  // Marker geometry is resolved structurally from presentation attributes below.
  // CSS marker cascade resolution would otherwise require matching every rule to
  // every element at this untrusted boundary, so imported CSS marker declarations
  // are degraded rather than approximated.
  if (CSS_MARKER_PROPERTIES.has(property)) return false
  // Transform origins require layout-dependent resolution for percentages and
  // keywords. Imported origins are discarded rather than approximated, because
  // a safe scale around a large origin can still create an unsafe translation.
  if (property === 'transform-origin' || property === 'font-size-adjust') return false
  if (/(?:abs|attr|calc|clamp|cos|env|exp|hypot|log|max|min|mod|pow|rem|round|sign|sin|sqrt|tan|var)\s*\(/i.test(value)) return false
  if (/(?:^|[^-\w])(?:nan|[-+]?infinity)(?:$|[^-\w])/i.test(value)) return false

  if (property === 'stroke-miterlimit') {
    const values = parseNumberSequence(value, { maxValues: 1 })
    return values !== null
      && values.length === 1
      && values[0].value >= 1
      && values[0].value <= MAX_SAFE_STROKE_MITER_LIMIT
  }

  SVG_NUMBER_GLOBAL.lastIndex = 0
  let match
  while ((match = SVG_NUMBER_GLOBAL.exec(value))) {
    const token = readNumber(value, match.index, { allowUnits: true })
    const converted = token && convertLength(token.numeric, token.unit)
    if (!converted || converted.relative) return false
    if (property === 'stroke-width'
      && Math.abs(converted.value) * DEFAULT_STROKE_MITER_EXTENT_FACTOR
        > MAX_SVG_GEOMETRY_MAGNITUDE) return false
    SVG_NUMBER_GLOBAL.lastIndex = token.cursor
  }
  return true
}

function sanitizeGeometryCssValue(property, value) {
  return geometryCssValueIsBounded(property, value) ? value : null
}

function pathBounds(rawValue) {
  const source = String(rawValue).trim()
  if (!source || source.length > 4 * 1024 * 1024) return null
  let cursor = 0
  let command = null
  let currentX = 0
  let currentY = 0
  let startX = 0
  let startY = 0
  let hadMove = false
  let previousSegment = null
  let lastCubicControlX = null
  let lastCubicControlY = null
  let lastQuadraticControlX = null
  let lastQuadraticControlY = null
  let minimumX = Infinity
  let minimumY = Infinity
  let maximumX = -Infinity
  let maximumY = -Infinity

  const include = (x, y) => {
    if (!boundedNumber(x) || !boundedNumber(y)) return false
    minimumX = Math.min(minimumX, x)
    minimumY = Math.min(minimumY, y)
    maximumX = Math.max(maximumX, x)
    maximumY = Math.max(maximumY, y)
    return true
  }

  const includeArc = (radiusXValue, radiusYValue, rotation, largeArc, sweep, endX, endY) => {
    let radiusX = Math.abs(radiusXValue)
    let radiusY = Math.abs(radiusYValue)
    if (radiusX === 0 || radiusY === 0 || (currentX === endX && currentY === endY)) {
      return include(endX, endY)
    }

    const radians = (rotation % 360) * Math.PI / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const halfDeltaX = (currentX - endX) / 2
    const halfDeltaY = (currentY - endY) / 2
    const transformedX = cosine * halfDeltaX + sine * halfDeltaY
    const transformedY = -sine * halfDeltaX + cosine * halfDeltaY
    const correction = Math.max(1, Math.hypot(transformedX / radiusX, transformedY / radiusY))
    radiusX *= correction
    radiusY *= correction
    if (!boundedNumber(radiusX) || !boundedNumber(radiusY)) return false

    const radiusXSquared = radiusX * radiusX
    const radiusYSquared = radiusY * radiusY
    const transformedXSquared = transformedX * transformedX
    const transformedYSquared = transformedY * transformedY
    const denominator = radiusXSquared * transformedYSquared
      + radiusYSquared * transformedXSquared
    const numerator = radiusXSquared * radiusYSquared - denominator
    const direction = largeArc === sweep ? -1 : 1
    const centerFactor = denominator === 0
      ? 0
      : direction * Math.sqrt(Math.max(0, numerator / denominator))
    const transformedCenterX = centerFactor * radiusX * transformedY / radiusY
    const transformedCenterY = centerFactor * -radiusY * transformedX / radiusX
    const centerX = cosine * transformedCenterX - sine * transformedCenterY
      + (currentX + endX) / 2
    const centerY = sine * transformedCenterX + cosine * transformedCenterY
      + (currentY + endY) / 2
    const horizontalExtent = Math.hypot(radiusX * cosine, radiusY * sine)
    const verticalExtent = Math.hypot(radiusX * sine, radiusY * cosine)
    if (!boundedNumber(centerX) || !boundedNumber(centerY)
      || !boundedNumber(horizontalExtent) || !boundedNumber(verticalExtent)) return false

    return include(centerX - horizontalExtent, centerY - verticalExtent)
      && include(centerX + horizontalExtent, centerY + verticalExtent)
      && include(endX, endY)
  }

  while (cursor < source.length) {
    cursor = skipSeparators(source, cursor)
    if (cursor >= source.length) break
    if (/[a-z]/i.test(source[cursor])) {
      if (!PATH_COMMANDS.has(source[cursor])) return null
      command = source[cursor]
      cursor += 1
      if (command === 'Z' || command === 'z') {
        if (!hadMove || !include(startX, startY)) return null
        currentX = startX
        currentY = startY
        lastCubicControlX = null
        lastCubicControlY = null
        lastQuadraticControlX = null
        lastQuadraticControlY = null
        previousSegment = 'Z'
        command = null
      }
      continue
    }
    if (!command) return null

    const upper = command.toUpperCase()
    const argumentCount = PATH_ARGUMENTS[upper]
    if (!argumentCount) return null
    const values = []
    for (let index = 0; index < argumentCount; index += 1) {
      cursor = skipSeparators(source, cursor)
      if (cursor >= source.length || /[a-z]/i.test(source[cursor])) return null
      const token = readNumber(source, cursor)
      if (!token) return null
      values.push(token.numeric)
      cursor = token.cursor
    }

    const relative = command === command.toLowerCase()
    const x = (value) => relative ? currentX + value : value
    const y = (value) => relative ? currentY + value : value
    if (upper === 'M' || upper === 'L' || upper === 'T') {
      let nextX = x(values[0])
      let nextY = y(values[1])
      if (upper === 'T') {
        const reflectedX = previousSegment === 'Q' || previousSegment === 'T'
          ? 2 * currentX - lastQuadraticControlX
          : currentX
        const reflectedY = previousSegment === 'Q' || previousSegment === 'T'
          ? 2 * currentY - lastQuadraticControlY
          : currentY
        if (!include(reflectedX, reflectedY)) return null
        lastQuadraticControlX = reflectedX
        lastQuadraticControlY = reflectedY
      } else {
        lastQuadraticControlX = null
        lastQuadraticControlY = null
      }
      currentX = nextX
      currentY = nextY
      if (!include(currentX, currentY)) return null
      lastCubicControlX = null
      lastCubicControlY = null
      if (upper === 'M') {
        startX = currentX
        startY = currentY
        hadMove = true
        command = relative ? 'l' : 'L'
      }
    } else if (upper === 'H') {
      currentX = x(values[0])
      if (!include(currentX, currentY)) return null
      lastCubicControlX = null
      lastCubicControlY = null
      lastQuadraticControlX = null
      lastQuadraticControlY = null
    } else if (upper === 'V') {
      currentY = y(values[0])
      if (!include(currentX, currentY)) return null
      lastCubicControlX = null
      lastCubicControlY = null
      lastQuadraticControlX = null
      lastQuadraticControlY = null
    } else if (upper === 'C') {
      const points = [
        [x(values[0]), y(values[1])],
        [x(values[2]), y(values[3])],
        [x(values[4]), y(values[5])],
      ]
      if (!points.every(point => include(point[0], point[1]))) return null
      currentX = points[2][0]
      currentY = points[2][1]
      lastCubicControlX = points[1][0]
      lastCubicControlY = points[1][1]
      lastQuadraticControlX = null
      lastQuadraticControlY = null
    } else if (upper === 'S') {
      const reflectedX = previousSegment === 'C' || previousSegment === 'S'
        ? 2 * currentX - lastCubicControlX
        : currentX
      const reflectedY = previousSegment === 'C' || previousSegment === 'S'
        ? 2 * currentY - lastCubicControlY
        : currentY
      const points = [
        [reflectedX, reflectedY],
        [x(values[0]), y(values[1])],
        [x(values[2]), y(values[3])],
      ]
      if (!points.every(point => include(point[0], point[1]))) return null
      currentX = points[2][0]
      currentY = points[2][1]
      lastCubicControlX = points[1][0]
      lastCubicControlY = points[1][1]
      lastQuadraticControlX = null
      lastQuadraticControlY = null
    } else if (upper === 'Q') {
      const points = [
        [x(values[0]), y(values[1])],
        [x(values[2]), y(values[3])],
      ]
      if (!points.every(point => include(point[0], point[1]))) return null
      currentX = points[1][0]
      currentY = points[1][1]
      lastQuadraticControlX = points[0][0]
      lastQuadraticControlY = points[0][1]
      lastCubicControlX = null
      lastCubicControlY = null
    } else if (upper === 'A') {
      if ((values[3] !== 0 && values[3] !== 1) || (values[4] !== 0 && values[4] !== 1)) return null
      const endX = x(values[5])
      const endY = y(values[6])
      if (!includeArc(values[0], values[1], values[2], values[3], values[4], endX, endY)) return null
      currentX = endX
      currentY = endY
      lastCubicControlX = null
      lastCubicControlY = null
      lastQuadraticControlX = null
      lastQuadraticControlY = null
    }
    previousSegment = upper
  }

  if (!hadMove || minimumX === Infinity) return null
  return { minimumX, minimumY, maximumX, maximumY }
}

function pointsBounds(rawValue, minimumValues) {
  const values = parseNumberSequence(rawValue, {
    even: true,
    minValues: minimumValues,
  })
  if (!values) return null
  let minimumX = Infinity
  let minimumY = Infinity
  let maximumX = -Infinity
  let maximumY = -Infinity
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index].value
    const y = values[index + 1].value
    minimumX = Math.min(minimumX, x)
    minimumY = Math.min(minimumY, y)
    maximumX = Math.max(maximumX, x)
    maximumY = Math.max(maximumY, y)
  }
  return { minimumX, minimumY, maximumX, maximumY }
}

function firstLength(element, name, fallback = 0) {
  const raw = element.getAttribute(name)
  if (raw === null) return { minimum: fallback, maximum: fallback }
  const values = parseNumberSequence(raw, { allowUnits: true, maxValues: 1000000 })
  return values ? values[0] : null
}

function combineIntervals(first, second) {
  const minimum = first.minimum + second.minimum
  const maximum = first.maximum + second.maximum
  return boundedNumber(minimum) && boundedNumber(maximum) ? { minimum, maximum } : null
}

function boundsFromIntervals(x, y) {
  if (!x || !y || !boundedNumber(x.minimum) || !boundedNumber(x.maximum)
    || !boundedNumber(y.minimum) || !boundedNumber(y.maximum)) return null
  return {
    minimumX: x.minimum,
    minimumY: y.minimum,
    maximumX: x.maximum,
    maximumY: y.maximum,
  }
}

function boxGeometryBounds(element) {
  const x = firstLength(element, 'x')
  const y = firstLength(element, 'y')
  const width = firstLength(element, 'width')
  const height = firstLength(element, 'height')
  if (!x || !y || !width || !height) return null
  const right = combineIntervals(x, width)
  const bottom = combineIntervals(y, height)
  if (!right || !bottom) return null
  return boundsFromIntervals(
    { minimum: Math.min(x.minimum, right.minimum), maximum: Math.max(x.maximum, right.maximum) },
    { minimum: Math.min(y.minimum, bottom.minimum), maximum: Math.max(y.maximum, bottom.maximum) },
  )
}

function radialGeometryBounds(element, xName, yName, radiusXName, radiusYName = radiusXName) {
  const x = firstLength(element, xName)
  const y = firstLength(element, yName)
  const radiusX = firstLength(element, radiusXName)
  const radiusY = firstLength(element, radiusYName)
  if (!x || !y || !radiusX || !radiusY) return null
  const xExtent = Math.max(Math.abs(radiusX.minimum), Math.abs(radiusX.maximum))
  const yExtent = Math.max(Math.abs(radiusY.minimum), Math.abs(radiusY.maximum))
  const bounds = {
    minimumX: x.minimum - xExtent,
    maximumX: x.maximum + xExtent,
    minimumY: y.minimum - yExtent,
    maximumY: y.maximum + yExtent,
  }
  return Object.values(bounds).every(boundedNumber) ? bounds : null
}

function localGeometryBounds(element, options = {}) {
  const name = element.localName.toLowerCase()
  if (name === 'path') return pathBounds(element.getAttribute('d'))
  if (name === 'polyline') return pointsBounds(element.getAttribute('points'), 4)
  if (name === 'polygon') return pointsBounds(element.getAttribute('points'), 6)
  if (name === 'line') {
    const x1 = firstLength(element, 'x1')
    const y1 = firstLength(element, 'y1')
    const x2 = firstLength(element, 'x2')
    const y2 = firstLength(element, 'y2')
    if (!x1 || !y1 || !x2 || !y2) return null
    return boundsFromIntervals(
      { minimum: Math.min(x1.minimum, x2.minimum), maximum: Math.max(x1.maximum, x2.maximum) },
      { minimum: Math.min(y1.minimum, y2.minimum), maximum: Math.max(y1.maximum, y2.maximum) },
    )
  }
  if (name === 'rect' || name === 'image' || (name === 'svg' && (
    element.ownerDocument.documentElement !== element || options.rootViewportIsGeometry === true
  ))) {
    return boxGeometryBounds(element)
  }
  if (name === 'circle') return radialGeometryBounds(element, 'cx', 'cy', 'r')
  if (name === 'ellipse') return radialGeometryBounds(element, 'cx', 'cy', 'rx', 'ry')
  if (name === 'text' || name === 'tspan' || name === 'textpath') {
    const x = firstLength(element, 'x')
    const y = firstLength(element, 'y')
    const dx = firstLength(element, 'dx')
    const dy = firstLength(element, 'dy')
    if (!x || !y || !dx || !dy) return null
    return boundsFromIntervals(combineIntervals(x, dx), combineIntervals(y, dy))
  }
  return undefined
}

function transformBounds(bounds, matrix) {
  if (!bounds) return null
  const corners = [
    [bounds.minimumX, bounds.minimumY],
    [bounds.minimumX, bounds.maximumY],
    [bounds.maximumX, bounds.minimumY],
    [bounds.maximumX, bounds.maximumY],
  ]
  let minimumX = Infinity
  let minimumY = Infinity
  let maximumX = -Infinity
  let maximumY = -Infinity
  for (const [x, y] of corners) {
    const transformedX = matrix.a * x + matrix.c * y + matrix.e
    const transformedY = matrix.b * x + matrix.d * y + matrix.f
    if (!boundedNumber(transformedX) || !boundedNumber(transformedY)) return null
    minimumX = Math.min(minimumX, transformedX)
    minimumY = Math.min(minimumY, transformedY)
    maximumX = Math.max(maximumX, transformedX)
    maximumY = Math.max(maximumY, transformedY)
  }
  return { minimumX, minimumY, maximumX, maximumY }
}

function unionBounds(first, second) {
  if (!first) return second
  if (!second) return first
  return {
    minimumX: Math.min(first.minimumX, second.minimumX),
    minimumY: Math.min(first.minimumY, second.minimumY),
    maximumX: Math.max(first.maximumX, second.maximumX),
    maximumY: Math.max(first.maximumY, second.maximumY),
  }
}

function presentationExtent(value) {
  const source = String(value)
  let extent = 0
  SVG_NUMBER_GLOBAL.lastIndex = 0
  let match
  while ((match = SVG_NUMBER_GLOBAL.exec(source))) {
    const token = readNumber(source, match.index, { allowUnits: true })
    if (!token) return null
    const converted = convertLength(token.numeric, token.unit)
    if (!converted) return null
    extent = Math.max(extent, Math.abs(converted.minimum), Math.abs(converted.maximum))
    if (!boundedNumber(extent)) return null
    SVG_NUMBER_GLOBAL.lastIndex = token.cursor
  }
  return extent
}

function declarationExtent(styleText) {
  let extent = 0
  String(styleText).split(';').forEach((declaration) => {
    const colon = declaration.indexOf(':')
    if (colon < 1) return
    const property = declaration.slice(0, colon).trim().toLowerCase()
    if (!PAINT_EXTENT_PROPERTIES.has(property)) return
    const valueExtent = presentationExtent(declaration.slice(colon + 1))
    if (valueExtent !== null) {
      const renderedExtent = property === 'stroke-width'
        ? valueExtent * DEFAULT_STROKE_MITER_EXTENT_FACTOR
        : valueExtent
      if (boundedNumber(renderedExtent)) extent = Math.max(extent, renderedExtent)
    }
  })
  if (/(?:^|;)\s*stroke\s*:\s*(?!none(?:\s|;|$)|transparent(?:\s|;|$))/i.test(styleText)) {
    extent = Math.max(extent, DEFAULT_STROKE_MITER_EXTENT_FACTOR)
  }
  return extent
}

function stylesheetPaintExtent(root) {
  let extent = 0
  root.querySelectorAll('style').forEach((style) => {
    const rulePattern = /[^{}]+\{([^{}]*)\}/g
    let match
    while ((match = rulePattern.exec(style.textContent))) {
      extent = Math.max(extent, declarationExtent(match[1]))
    }
  })
  return extent
}

function elementPaintExtent(element, inheritedExtent, globalExtent) {
  const elementName = element.localName.toLowerCase()
  let extent = Math.max(
    inheritedExtent,
    globalExtent,
    elementName === 'text' || elementName === 'tspan' ? 16 : 0,
  )
  const attributeStroke = (element.getAttribute('stroke') || '').trim().toLowerCase()
  if (attributeStroke && attributeStroke !== 'none' && attributeStroke !== 'transparent') {
    extent = Math.max(extent, DEFAULT_STROKE_MITER_EXTENT_FACTOR)
  }
  PAINT_EXTENT_PROPERTIES.forEach((property) => {
    const raw = element.getAttribute(property)
    if (raw === null) return
    const valueExtent = presentationExtent(raw)
    if (valueExtent !== null) {
      const renderedExtent = property === 'stroke-width'
        ? valueExtent * DEFAULT_STROKE_MITER_EXTENT_FACTOR
        : valueExtent
      if (boundedNumber(renderedExtent)) extent = Math.max(extent, renderedExtent)
    }
  })
  extent = Math.max(extent, declarationExtent(element.getAttribute('style') || ''))
  if (element.localName.toLowerCase() === 'text' || element.localName.toLowerCase() === 'tspan') {
    const textLength = element.getAttribute('textlength')
    if (textLength !== null) {
      const valueExtent = presentationExtent(textLength)
      if (valueExtent !== null) extent = Math.max(extent, valueExtent)
    }
    // Font size, spacing, baseline shift and stroke can each add to text paint
    // bounds. Eight times the longest imported component is a conservative
    // envelope for their combined horizontal/vertical contribution.
    const textExtent = extent
      * Math.max(1, Math.min(element.textContent.length, MAX_SVG_GEOMETRY_MAGNITUDE))
      * 8
      + 16
    if (!boundedNumber(textExtent)) return null
    extent = Math.max(extent, textExtent)
  }
  return boundedNumber(extent) ? extent : null
}

function expandBounds(bounds, extent) {
  if (!bounds || !boundedNumber(extent)) return null
  const expanded = {
    minimumX: bounds.minimumX - extent,
    minimumY: bounds.minimumY - extent,
    maximumX: bounds.maximumX + extent,
    maximumY: bounds.maximumY + extent,
  }
  return Object.values(expanded).every(boundedNumber) ? expanded : null
}

function inlineStyleTransform(element) {
  const style = element.getAttribute('style')
  if (!style) return { matrix: { ...IDENTITY_MATRIX }, present: false }
  const declarations = style.split(';')
    .filter(candidate => candidate.trim().toLowerCase().startsWith('transform:'))
  const declaration = declarations[declarations.length - 1]
  if (!declaration) return { matrix: { ...IDENTITY_MATRIX }, present: false }
  return {
    matrix: parseBoundedTransform(declaration.slice(declaration.indexOf(':') + 1), { css: true }),
    present: true,
  }
}

function exactLength(element, name, fallback = 0) {
  const interval = firstLength(element, name, fallback)
  if (!interval || interval.minimum !== interval.maximum) return null
  return interval.minimum
}

function svgViewportMatrix(element, enabled) {
  if (!enabled || element.localName.toLowerCase() !== 'svg') return { ...IDENTITY_MATRIX }
  const x = exactLength(element, 'x')
  const y = exactLength(element, 'y')
  if (x === null || y === null) return null
  const viewBox = parsedViewBox(element)
  if (!viewBox) return translateMatrix(x, y)
  if (!element.hasAttribute('width') || !element.hasAttribute('height')) return null
  const width = exactLength(element, 'width')
  const height = exactLength(element, 'height')
  if (width === null || height === null || width < 0 || height < 0) return null

  const scaleX = width / viewBox[2]
  const scaleY = height / viewBox[3]
  if (!boundedNumber(scaleX) || !boundedNumber(scaleY)) return null
  const preserve = (element.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim()
  let appliedScaleX = scaleX
  let appliedScaleY = scaleY
  let offsetX = 0
  let offsetY = 0
  if (!/^none(?:\s|$)/i.test(preserve)) {
    const scale = /(?:^|\s)slice(?:\s|$)/i.test(preserve)
      ? Math.max(scaleX, scaleY)
      : Math.min(scaleX, scaleY)
    const align = preserve.match(/x(Min|Mid|Max)Y(Min|Mid|Max)/i)
    const xFactor = !align || align[1].toLowerCase() === 'mid' ? 0.5 : align[1].toLowerCase() === 'max' ? 1 : 0
    const yFactor = !align || align[2].toLowerCase() === 'mid' ? 0.5 : align[2].toLowerCase() === 'max' ? 1 : 0
    offsetX = (width - viewBox[2] * scale) * xFactor
    offsetY = (height - viewBox[3] * scale) * yFactor
    appliedScaleX = scale
    appliedScaleY = scale
  }

  return multiplyMatrices(
    multiplyMatrices(
      translateMatrix(x + offsetX, y + offsetY),
      scaleMatrix(appliedScaleX, appliedScaleY),
    ),
    translateMatrix(-viewBox[0], -viewBox[1]),
  )
}

function markerViewportMatrix(marker) {
  const viewBox = parsedViewBox(marker)
  if (!viewBox) return { ...IDENTITY_MATRIX }
  const width = exactLength(marker, 'markerWidth', 3)
  const height = exactLength(marker, 'markerHeight', 3)
  if (width === null || height === null || width < 0 || height < 0) return null
  if (width === 0 || height === 0) return scaleMatrix(0, 0)

  const scaleX = width / viewBox[2]
  const scaleY = height / viewBox[3]
  if (!boundedNumber(scaleX) || !boundedNumber(scaleY)) return null
  let appliedScaleX = scaleX
  let appliedScaleY = scaleY
  let offsetX = 0
  let offsetY = 0
  const preserve = (marker.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim()
  if (!/^none(?:\s|$)/i.test(preserve)) {
    // Use the larger possible viewport scale even for `meet`. This deliberately
    // bounds the complete marker viewport rather than depending on clipping or
    // alignment details at the reference point.
    const scale = Math.max(scaleX, scaleY)
    const align = preserve.match(/x(Min|Mid|Max)Y(Min|Mid|Max)/i)
    const xFactor = !align || align[1].toLowerCase() === 'mid' ? 0.5 : align[1].toLowerCase() === 'max' ? 1 : 0
    const yFactor = !align || align[2].toLowerCase() === 'mid' ? 0.5 : align[2].toLowerCase() === 'max' ? 1 : 0
    offsetX = (width - viewBox[2] * scale) * xFactor
    offsetY = (height - viewBox[3] * scale) * yFactor
    appliedScaleX = scale
    appliedScaleY = scale
  }

  return multiplyMatrices(
    multiplyMatrices(
      translateMatrix(offsetX, offsetY),
      scaleMatrix(appliedScaleX, appliedScaleY),
    ),
    translateMatrix(-viewBox[0], -viewBox[1]),
  )
}

function validateElementNumericAttributes(element, documentRoot, onMutation, options = {}) {
  const name = element.localName.toLowerCase()
  const viewportGeometry = name === 'svg' && (
    element !== documentRoot || options.rootViewportIsGeometry === true
  )
  if (viewportGeometry && element.hasAttribute('viewBox')
    && (!element.hasAttribute('width') || !element.hasAttribute('height'))) {
    const values = parseNumberSequence(element.getAttribute('viewBox'), { maxValues: 4, minValues: 4 })
    if (values && values.length === 4 && values[2].value > 0 && values[3].value > 0) {
      if (!element.hasAttribute('width')) element.setAttribute('width', String(values[2].value))
      if (!element.hasAttribute('height')) element.setAttribute('height', String(values[3].value))
      onMutation()
    }
  }
  for (const attribute of Array.from(element.attributes)) {
    const attributeName = attribute.localName.toLowerCase()
    if (CSS_MARKER_PROPERTIES.has(attributeName) && !MARKER_GEOMETRY_ELEMENTS.has(name)) {
      // Marker presentation properties inherit. Retaining them on containers
      // would apply unbounded referenced geometry to every descendant shape.
      element.removeAttributeNode(attribute)
      onMutation()
      continue
    }
    if (TRANSFORM_ATTRIBUTES.has(attributeName)) {
      if (!parseBoundedTransform(attribute.value)) return false
      continue
    }
    if (attributeName === 'd' && name === 'path') {
      if (!pathBounds(attribute.value)) return false
      continue
    }
    if (attributeName === 'points' && (name === 'polyline' || name === 'polygon')) {
      if (!pointsBounds(attribute.value, name === 'polygon' ? 6 : 4)) return false
      continue
    }
    if (attributeName === 'viewbox' && (
      element !== documentRoot || options.rootViewportIsGeometry === true
    )) {
      const values = parseNumberSequence(attribute.value, { maxValues: 4, minValues: 4 })
      if (!values || values.length !== 4 || values[2].value < 0 || values[3].value < 0) return false
      continue
    }
    if (LENGTH_ATTRIBUTES.has(attributeName)) {
      const isTextPosition = (name === 'text' || name === 'tspan')
        && (attributeName === 'x' || attributeName === 'y' || attributeName === 'dx' || attributeName === 'dy')
      const values = parseNumberSequence(attribute.value, {
        allowUnits: true,
        maxValues: isTextPosition ? 1 : undefined,
        nonNegative: NON_NEGATIVE_LENGTH_ATTRIBUTES.has(attributeName),
      })
      if (values) continue
      if (element === documentRoot && (attributeName === 'width' || attributeName === 'height')) {
        element.removeAttributeNode(attribute)
        onMutation()
        continue
      }
      return false
    }
    if (attributeName === 'rotate') {
      if (!parseNumberSequence(attribute.value)) return false
      continue
    }
    if (PRESENTATION_GEOMETRY_ATTRIBUTES.has(attributeName)) {
      if (sanitizeGeometryCssValue(attributeName, attribute.value) !== null) continue
      element.removeAttributeNode(attribute)
      onMutation()
    }
  }
  return true
}

function isSvgViewportGeometry(element, context) {
  return element.localName.toLowerCase() === 'svg' && (
    element.ownerDocument.documentElement !== element
    || (element === context.root && context.rootViewportIsGeometry === true)
  )
}

function elementTransform(element, context = {}, options = {}) {
  let result = { ...IDENTITY_MATRIX }
  for (const attributeName of ['patterntransform', 'gradienttransform']) {
    const raw = element.getAttribute(attributeName)
    if (raw === null) continue
    result = multiplyMatrices(result, parseBoundedTransform(raw))
    if (!result) return null
  }
  const inline = inlineStyleTransform(element)
  const presentation = element.getAttribute('transform')
  const renderedTransform = inline.present
    ? inline.matrix
    : presentation === null
      ? IDENTITY_MATRIX
      : parseBoundedTransform(presentation)
  if (!renderedTransform) return null
  result = multiplyMatrices(result, renderedTransform)
  if (!result) return null
  if (options.includeViewport === false) return result
  const viewport = svgViewportMatrix(
    element,
    isSvgViewportGeometry(element, context),
  )
  return viewport && multiplyMatrices(result, viewport)
}

function referencedElement(root, useElement) {
  const rawHref = useElement.getAttribute('href')
    || useElement.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  if (!rawHref || !rawHref.startsWith('#')) return null
  const target = root.ownerDocument.getElementById(rawHref.slice(1))
  return target && (target === root || root.contains(target)) ? target : null
}

function referencedUrlElement(root, rawValue) {
  const match = String(rawValue || '').trim().match(/^url\(\s*(['"]?)#([^\s"'()<>[\]{}\\]+)\1\s*\)$/i)
  if (!match) return null
  const target = root.ownerDocument.getElementById(match[2])
  return target && (target === root || root.contains(target)) ? target : null
}

function parsedViewBox(element) {
  const raw = element.getAttribute('viewBox')
  if (raw === null) return null
  const values = parseNumberSequence(raw, { minValues: 4, maxValues: 4 })
  if (!values || values.length !== 4 || values[2].value <= 0 || values[3].value <= 0) return null
  return values.map(entry => entry.value)
}

function scaleBounds(bounds, scale, originX, originY) {
  const horizontal = [
    (bounds.minimumX - originX) * scale,
    (bounds.maximumX - originX) * scale,
  ]
  const vertical = [
    (bounds.minimumY - originY) * scale,
    (bounds.maximumY - originY) * scale,
  ]
  const scaled = {
    minimumX: Math.min(...horizontal),
    maximumX: Math.max(...horizontal),
    minimumY: Math.min(...vertical),
    maximumY: Math.max(...vertical),
  }
  return Object.values(scaled).every(boundedNumber) ? scaled : null
}

function translateBoundsByIntervals(bounds, x, y, alignmentX = 0, alignmentY = 0) {
  const translated = {
    minimumX: bounds.minimumX + x.minimum - alignmentX,
    maximumX: bounds.maximumX + x.maximum + alignmentX,
    minimumY: bounds.minimumY + y.minimum - alignmentY,
    maximumY: bounds.maximumY + y.maximum + alignmentY,
  }
  return Object.values(translated).every(boundedNumber) ? translated : null
}

function useViewportBounds(useElement, target, targetBounds) {
  const x = firstLength(useElement, 'x')
  const y = firstLength(useElement, 'y')
  if (!x || !y) return null
  const targetName = target.localName.toLowerCase()
  const viewBox = targetName === 'symbol' || targetName === 'svg' ? parsedViewBox(target) : null
  if (!viewBox) return translateBoundsByIntervals(targetBounds, x, y)

  const width = useElement.hasAttribute('width')
    ? firstLength(useElement, 'width')
    : { minimum: viewBox[2], maximum: viewBox[2] }
  const height = useElement.hasAttribute('height')
    ? firstLength(useElement, 'height')
    : { minimum: viewBox[3], maximum: viewBox[3] }
  if (!width || !height) return null
  const widthExtent = Math.max(Math.abs(width.minimum), Math.abs(width.maximum))
  const heightExtent = Math.max(Math.abs(height.minimum), Math.abs(height.maximum))
  if (widthExtent === 0 || heightExtent === 0) {
    return boundsFromIntervals(x, y)
  }
  const scale = Math.max(widthExtent / viewBox[2], heightExtent / viewBox[3])
  if (!boundedNumber(scale)) return null
  const scaled = scaleBounds(targetBounds, scale, viewBox[0], viewBox[1])
  if (!scaled) return null
  // preserveAspectRatio alignment can offset a meet/slice result inside the
  // requested viewport. Expanding by the complete viewport is conservative
  // across all supported alignments without layout or style resolution.
  return translateBoundsByIntervals(scaled, x, y, widthExtent, heightExtent)
}

function aggregateReferencedSubtree(element, parentMatrix, inheritedExtent, context, depth) {
  context.work += 1
  if (context.work > MAX_SVG_REFERENCE_WORK || depth > MAX_SVG_REFERENCE_DEPTH) {
    return { bounds: null, safe: false }
  }

  const localTransform = elementTransform(element, context)
  const matrix = localTransform && multiplyMatrices(parentMatrix, localTransform)
  const paintExtent = elementPaintExtent(element, inheritedExtent, context.globalPaintExtent)
  const markerResult = markerReferenceExtent(element, context, paintExtent, depth + 1)
  const renderedExtent = markerResult.extent === null
    ? null
    : Math.max(paintExtent || 0, markerResult.extent)
  if (!matrix || paintExtent === null || markerResult.unsafeAttributes.length > 0
    || renderedExtent === null) return { bounds: null, safe: false }

  let aggregate = null
  if (element.localName.toLowerCase() === 'use') {
    const reference = referencedUseBounds(element, context, depth + 1, paintExtent)
    if (!reference.safe) return reference
    if (reference.bounds) {
      const transformed = transformBounds(expandBounds(reference.bounds, renderedExtent), matrix)
      if (!transformed) return { bounds: null, safe: false }
      aggregate = unionBounds(aggregate, transformed)
    }
  } else {
    const local = localGeometryBounds(element)
    if (local === null) return { bounds: null, safe: false }
    if (local !== undefined) {
      const outerTransform = isSvgViewportGeometry(element, context)
        ? elementTransform(element, context, { includeViewport: false })
        : null
      const boundsMatrix = outerTransform ? multiplyMatrices(parentMatrix, outerTransform) : matrix
      const transformed = boundsMatrix
        && transformBounds(expandBounds(local, renderedExtent), boundsMatrix)
      if (!transformed) return { bounds: null, safe: false }
      aggregate = unionBounds(aggregate, transformed)
    }
  }

  for (const child of Array.from(element.children)) {
    const childResult = aggregateReferencedSubtree(child, matrix, paintExtent, context, depth + 1)
    if (!childResult.safe) return childResult
    aggregate = unionBounds(aggregate, childResult.bounds)
  }
  return { bounds: aggregate, safe: true }
}

function markerReferenceExtent(element, context, paintExtent, depth) {
  let extent = 0
  const referencedAttributes = []
  const unsafeAttributes = []
  for (const attributeName of ['marker', 'marker-start', 'marker-mid', 'marker-end']) {
    const raw = element.getAttribute(attributeName)
    if (raw === null) continue
    const marker = referencedUrlElement(context.root, raw)
    if (!marker || marker.localName.toLowerCase() !== 'marker') continue
    referencedAttributes.push(attributeName)
    if (context.activeTargets.has(marker) || depth > MAX_SVG_REFERENCE_DEPTH) {
      unsafeAttributes.push(attributeName)
      continue
    }

    context.activeTargets.add(marker)
    const markerResult = aggregateReferencedSubtree(
      marker,
      IDENTITY_MATRIX,
      0,
      context,
      depth + 1,
    )
    context.activeTargets.delete(marker)
    if (!markerResult.safe) {
      unsafeAttributes.push(attributeName)
      continue
    }
    if (!markerResult.bounds) continue

    const viewport = markerViewportMatrix(marker)
    const viewportBounds = viewport && transformBounds(markerResult.bounds, viewport)
    const refX = exactLength(marker, 'refX')
    const refY = exactLength(marker, 'refY')
    if (!viewportBounds || refX === null || refY === null) {
      unsafeAttributes.push(attributeName)
      continue
    }
    const transformedRefX = viewport.a * refX + viewport.c * refY + viewport.e
    const transformedRefY = viewport.b * refX + viewport.d * refY + viewport.f
    if (!boundedNumber(transformedRefX) || !boundedNumber(transformedRefY)) {
      unsafeAttributes.push(attributeName)
      continue
    }

    const relativeCorners = [
      [viewportBounds.minimumX - transformedRefX, viewportBounds.minimumY - transformedRefY],
      [viewportBounds.minimumX - transformedRefX, viewportBounds.maximumY - transformedRefY],
      [viewportBounds.maximumX - transformedRefX, viewportBounds.minimumY - transformedRefY],
      [viewportBounds.maximumX - transformedRefX, viewportBounds.maximumY - transformedRefY],
    ]
    let markerExtent = Math.max(...relativeCorners.map(([x, y]) => Math.hypot(x, y)))
    if ((marker.getAttribute('markerUnits') || 'strokeWidth').toLowerCase() !== 'userspaceonuse') {
      markerExtent *= Math.max(1, paintExtent || 0)
    }
    if (!boundedNumber(markerExtent)) {
      unsafeAttributes.push(attributeName)
      continue
    }
    extent = Math.max(extent, markerExtent)
  }
  return {
    extent: boundedNumber(extent) ? extent : null,
    referencedAttributes,
    unsafeAttributes,
  }
}

function referencedUseBounds(useElement, context, depth, inheritedExtent = 0) {
  const target = referencedElement(context.root, useElement)
  if (!target) return { bounds: null, safe: true }
  if (context.activeTargets.has(target) || depth > MAX_SVG_REFERENCE_DEPTH) {
    return { bounds: null, safe: false }
  }
  context.activeTargets.add(target)
  const targetResult = aggregateReferencedSubtree(
    target,
    IDENTITY_MATRIX,
    inheritedExtent,
    context,
    depth + 1,
  )
  context.activeTargets.delete(target)
  if (!targetResult.safe || !targetResult.bounds) return targetResult
  const bounds = useViewportBounds(useElement, target, targetResult.bounds)
  return { bounds, safe: bounds !== null }
}

function sanitizeSvgNumericGeometry(root, options = {}) {
  const onMutation = typeof options.onMutation === 'function' ? options.onMutation : () => {}
  const context = {
    activeTargets: new Set(),
    globalPaintExtent: stylesheetPaintExtent(root),
    root,
    rootViewportIsGeometry: options.rootViewportIsGeometry === true,
    work: 0,
  }

  const visit = (element, parentMatrix, inheritedExtent) => {
    if (!validateElementNumericAttributes(element, root, onMutation, {
      rootViewportIsGeometry: element === root && context.rootViewportIsGeometry,
    })) {
      if (element === root) throw new RangeError('The SVG root contains out-of-range geometry.')
      element.remove()
      onMutation()
      return
    }

    const localTransform = elementTransform(element, context)
    const matrix = localTransform && multiplyMatrices(parentMatrix, localTransform)
    const paintExtent = elementPaintExtent(element, inheritedExtent, context.globalPaintExtent)
    if (!matrix || paintExtent === null) {
      if (element === root) throw new RangeError('The SVG root transform exceeds the supported geometry range.')
      element.remove()
      onMutation()
      return
    }

    const markerResult = markerReferenceExtent(element, context, paintExtent, 0)
    markerResult.unsafeAttributes.forEach((attributeName) => {
      element.removeAttribute(attributeName)
      onMutation()
    })
    const renderedExtent = markerResult.extent === null
      ? null
      : Math.max(paintExtent, markerResult.extent)
    if (renderedExtent === null) {
      if (element === root) throw new RangeError('The SVG root marker geometry exceeds the supported range.')
      element.remove()
      onMutation()
      return
    }

    const reference = element.localName.toLowerCase() === 'use'
      ? referencedUseBounds(element, context, 0, paintExtent)
      : null
    const bounds = reference ? reference.bounds : localGeometryBounds(element, {
      rootViewportIsGeometry: element === root && context.rootViewportIsGeometry,
    })
    let expanded = bounds === undefined || bounds === null ? bounds : expandBounds(bounds, renderedExtent)
    const outerTransform = isSvgViewportGeometry(element, context)
      ? elementTransform(element, context, { includeViewport: false })
      : null
    const boundsMatrix = outerTransform ? multiplyMatrices(parentMatrix, outerTransform) : matrix
    let renderedBounds = expanded && boundsMatrix ? transformBounds(expanded, boundsMatrix) : null
    let geometryIsUnsafe = (!reference && bounds === null)
      || (bounds !== undefined && bounds !== null && !expanded)
      || (expanded && !renderedBounds)
    const retainedMarkerAttributes = markerResult.referencedAttributes
      .filter(attributeName => element.hasAttribute(attributeName))
    if (geometryIsUnsafe && retainedMarkerAttributes.length > 0
      && bounds !== undefined && bounds !== null && boundsMatrix) {
      const paintOnlyBounds = expandBounds(bounds, paintExtent)
      const renderedPaintOnlyBounds = paintOnlyBounds
        && transformBounds(paintOnlyBounds, boundsMatrix)
      if (renderedPaintOnlyBounds) {
        retainedMarkerAttributes.forEach((attributeName) => {
          element.removeAttribute(attributeName)
          onMutation()
        })
        expanded = paintOnlyBounds
        renderedBounds = renderedPaintOnlyBounds
        geometryIsUnsafe = false
      }
    }
    if ((reference && !reference.safe) || geometryIsUnsafe) {
      if (element === root) throw new RangeError('The SVG root viewport exceeds the supported geometry range.')
      element.remove()
      onMutation()
      return
    }

    Array.from(element.children).forEach((child) => visit(child, matrix, paintExtent))
  }

  visit(root, IDENTITY_MATRIX, 0)
  return root
}

export {
  MAX_SVG_GEOMETRY_MAGNITUDE,
  parseBoundedTransform,
  sanitizeGeometryCssValue,
  sanitizeSvgNumericGeometry,
}
