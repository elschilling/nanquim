export function applyMatrixToPoint(matrix, x, y) {
    return {
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f
    }
}

export function applyMatrixToElement(element, matrix) {
    if (element.type === 'line') {
        const p1 = applyMatrixToPoint(matrix, element.attr('x1'), element.attr('y1'))
        const p2 = applyMatrixToPoint(matrix, element.attr('x2'), element.attr('y2'))
        element.plot(p1.x, p1.y, p2.x, p2.y)
    } else if (element.type === 'polyline' || element.type === 'polygon') {
        const points = element.array()
        const newPoints = points.map(p => {
            const pt = applyMatrixToPoint(matrix, p[0], p[1])
            return [pt.x, pt.y]
        })
        element.plot(newPoints)
    } else if (element.type === 'circle') {
        const pt = applyMatrixToPoint(matrix, element.cx(), element.cy())
        element.center(pt.x, pt.y)
        // Assume uniform scale for circles
        const scale = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b)
        element.radius(element.radius() * scale)
    } else if (element.type === 'ellipse') {
        const pt = applyMatrixToPoint(matrix, element.cx(), element.cy())
        element.center(pt.x, pt.y)
        const scaleX = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b)
        const scaleY = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d)
        element.radius(element.rx() * scaleX, element.ry() * scaleY)
        // Ellipses don't handle rotation well natively without transform attribute,
        // so we might need a fallback if rotated. For DXF this is usually fine.
    } else if (element.type === 'rect') {
        const p1 = applyMatrixToPoint(matrix, element.x(), element.y())
        const p2 = applyMatrixToPoint(matrix, element.x() + element.width(), element.y())
        const p3 = applyMatrixToPoint(matrix, element.x() + element.width(), element.y() + element.height())
        const p4 = applyMatrixToPoint(matrix, element.x(), element.y() + element.height())
        const parent = element.parent()
        if (parent) {
            const polygon = parent.polygon([[p1.x, p1.y], [p2.x, p2.y], [p3.x, p3.y], [p4.x, p4.y]])
            polygon.attr(element.attr())
            element.remove()
            return polygon
        }
    } else if (element.type === 'path') {
        const pathArray = element.array()
        const newPathArray = []
        let lastPoint = { x: 0, y: 0 }

        for (const segment of pathArray) {
            const newSegment = [...segment]
            const command = newSegment[0]

            if (command === 'M' || command === 'L' || command === 'T') {
                const p = applyMatrixToPoint(matrix, newSegment[1], newSegment[2])
                newSegment[1] = p.x
                newSegment[2] = p.y
                lastPoint = { x: p.x, y: p.y }
            } else if (command === 'H') {
                const p = applyMatrixToPoint(matrix, newSegment[1], lastPoint.y)
                newSegment[0] = 'L'
                newSegment[1] = p.x
                newSegment[2] = p.y
                lastPoint = { x: p.x, y: p.y }
            } else if (command === 'V') {
                const p = applyMatrixToPoint(matrix, lastPoint.x, newSegment[1])
                newSegment[0] = 'L'
                newSegment[1] = p.x
                newSegment[2] = p.y
                lastPoint = { x: p.x, y: p.y }
            } else if (command === 'C') {
                const p1 = applyMatrixToPoint(matrix, newSegment[1], newSegment[2])
                const p2 = applyMatrixToPoint(matrix, newSegment[3], newSegment[4])
                const p3 = applyMatrixToPoint(matrix, newSegment[5], newSegment[6])
                newSegment[1] = p1.x; newSegment[2] = p1.y
                newSegment[3] = p2.x; newSegment[4] = p2.y
                newSegment[5] = p3.x; newSegment[6] = p3.y
                lastPoint = { x: p3.x, y: p3.y }
            } else if (command === 'S' || command === 'Q') {
                const p1 = applyMatrixToPoint(matrix, newSegment[1], newSegment[2])
                const p2 = applyMatrixToPoint(matrix, newSegment[3], newSegment[4])
                newSegment[1] = p1.x; newSegment[2] = p1.y
                newSegment[3] = p2.x; newSegment[4] = p2.y
                lastPoint = { x: p2.x, y: p2.y }
            } else if (command === 'A') {
                const p = applyMatrixToPoint(matrix, newSegment[6], newSegment[7])
                const scaleX = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b)
                const scaleY = Math.sqrt(matrix.c * matrix.c + matrix.d * matrix.d)
                newSegment[1] *= scaleX
                newSegment[2] *= scaleY
                // simplistic rotation calculation
                const rot = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI)
                newSegment[3] += rot
                // A reflection (det < 0) reverses the arc sweep direction
                const det = matrix.a * matrix.d - matrix.b * matrix.c
                if (det < 0) newSegment[5] = newSegment[5] ? 0 : 1
                newSegment[6] = p.x
                newSegment[7] = p.y
                lastPoint = { x: p.x, y: p.y }
            }
            newPathArray.push(newSegment)
        }
        element.plot(newPathArray)
    }

    // Transform related data attributes
    if (element.data('arcData')) {
        const ad = element.data('arcData')
        element.data('arcData', {
            p1: applyMatrixToPoint(matrix, ad.p1.x, ad.p1.y),
            p2: applyMatrixToPoint(matrix, ad.p2.x, ad.p2.y),
            p3: applyMatrixToPoint(matrix, ad.p3.x, ad.p3.y)
        })
    }
    if (element.data('circleTrimData')) {
        const ctd = element.data('circleTrimData')
        const center = applyMatrixToPoint(matrix, ctd.cx, ctd.cy)
        element.data('circleTrimData', {
            ...ctd,
            cx: center.x,
            cy: center.y,
            startPt: applyMatrixToPoint(matrix, ctd.startPt.x, ctd.startPt.y),
            endPt: applyMatrixToPoint(matrix, ctd.endPt.x, ctd.endPt.y)
        })
    }

    return element
}

export function bakeTransforms(element, parentMatrix = null) {
    const localMatrix = element.matrix()

    // Multiply parent by local if parent exists
    const accumulatedMatrix = parentMatrix ? {
        a: parentMatrix.a * localMatrix.a + parentMatrix.c * localMatrix.b,
        b: parentMatrix.b * localMatrix.a + parentMatrix.d * localMatrix.b,
        c: parentMatrix.a * localMatrix.c + parentMatrix.c * localMatrix.d,
        d: parentMatrix.b * localMatrix.c + parentMatrix.d * localMatrix.d,
        e: parentMatrix.a * localMatrix.e + parentMatrix.c * localMatrix.f + parentMatrix.e,
        f: parentMatrix.b * localMatrix.e + parentMatrix.d * localMatrix.f + parentMatrix.f
    } : localMatrix

    if (element.type === 'g') {
        const children = [...element.children()]
        children.forEach(child => {
            bakeTransforms(child, accumulatedMatrix)
        })
        // Once all children have baked the accumulated matrix, this group
        // and its ancestors up to the original call point should have no transform.
        element.transform({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        element.node.removeAttribute('transform')
    } else {
        if (element.type === 'text' || element.type === 'image') {
            element.transform(accumulatedMatrix)
            return element
        }

        // Apply the accumulated matrix to the leaf element's geometry
        const result = applyMatrixToElement(element, accumulatedMatrix)

        // Ensure the element has no lingering transform attribute
        if (result && result.transform) {
            result.transform({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
            result.node.removeAttribute('transform')
        }
        return result
    }
    return element
}
