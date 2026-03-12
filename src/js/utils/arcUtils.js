export function getArcGeometry(p1, p2, p3) {
    // Area of the triangle formed by the three points (multiplied by 2)
    const A = p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + p2.x * p3.y - p3.x * p2.y

    // Use a much smaller threshold for collinearity to support small curvatures
    if (Math.abs(A) < 1e-9) return null

    const p1sq = p1.x * p1.x + p1.y * p1.y
    const p2sq = p2.x * p2.x + p2.y * p2.y
    const p3sq = p3.x * p3.x + p3.y * p3.y

    const B = p1sq * (p3.y - p2.y) + p2sq * (p1.y - p3.y) + p3sq * (p2.y - p1.y)
    const C = p1sq * (p2.x - p3.x) + p2sq * (p3.x - p1.x) + p3sq * (p1.x - p2.x)

    const cx = -B / (2 * A)
    const cy = -C / (2 * A)

    // Radius is distance from center to any point
    const rSq = (cx - p1.x) ** 2 + (cy - p1.y) ** 2
    let radius = Math.sqrt(rSq)

    // Increase limit for better support of small curvatures
    // 1,000,000,000 is usually enough for most practical CAD drawings
    radius = Math.min(radius, 1000000000)

    // Calculate angles from center to the three points
    let theta1 = Math.atan2(p1.y - cy, p1.x - cx)
    let thetaMid = Math.atan2(p2.y - cy, p2.x - cx)
    let theta3 = Math.atan2(p3.y - cy, p3.x - cx)

    // Normalize angles to be between 0 and 2*PI
    if (theta1 < 0) theta1 += 2 * Math.PI
    if (thetaMid < 0) thetaMid += 2 * Math.PI
    if (theta3 < 0) theta3 += 2 * Math.PI

    // Determine if sweep is CCW or CW
    let ccw = true
    let ccwDistance = theta3 - theta1
    if (ccwDistance < 0) ccwDistance += 2 * Math.PI

    let midCcwDistance = thetaMid - theta1
    if (midCcwDistance < 0) midCcwDistance += 2 * Math.PI

    if (midCcwDistance > ccwDistance) {
        ccw = false
    }

    const sweepFlag = ccw ? 1 : 0
    let largeArcFlag = 0
    if (ccw) {
        largeArcFlag = ccwDistance > Math.PI ? 1 : 0
    } else {
        const cwDistance = 2 * Math.PI - ccwDistance
        largeArcFlag = cwDistance > Math.PI ? 1 : 0
    }

    return {
        cx,
        cy,
        radius,
        theta1,
        thetaMid,
        theta2: thetaMid, // Compatibility with some files that use p2 for mid
        theta3,
        ccw,
        sweepFlag,
        largeArcFlag
    }
}

export function isPointInArc(pt, cx, cy, startAngle, endAngle, ccw) {
    let angle = Math.atan2(pt.y - cy, pt.x - cx)
    if (angle < 0) angle += 2 * Math.PI

    let sweep = ccw ? (endAngle - startAngle) : (startAngle - endAngle)
    if (sweep < 0) sweep += 2 * Math.PI

    let aDiff = ccw ? (angle - startAngle) : (startAngle - angle)
    if (aDiff < 0) aDiff += 2 * Math.PI

    return aDiff <= sweep + 1e-4
}

