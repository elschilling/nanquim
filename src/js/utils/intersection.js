function onSegment(p, q, r) {
  if (q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
      q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)) {
    return true;
  }
  return false;
}

function orientation(p, q, r) {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (val === 0) return 0; // Collinear
  return (val > 0) ? 1 : 2; // Clockwise or Counterclockwise
}

function doLineSegmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  // Special Cases for collinear points
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

export function isLineIntersectingRect(line, rect) {
    const p1 = { x: line.x1, y: line.y1 };
    const q1 = { x: line.x2, y: line.y2 };

    // Check if the line is completely inside the rectangle
    if (p1.x > rect.x && p1.x < rect.x + rect.width &&
        p1.y > rect.y && p1.y < rect.y + rect.height &&
        q1.x > rect.x && q1.x < rect.x + rect.width &&
        q1.y > rect.y && q1.y < rect.y + rect.height) {
        return true;
    }

    // Check for intersection with each of the 4 rectangle segments
    const topLeft = { x: rect.x, y: rect.y };
    const topRight = { x: rect.x + rect.width, y: rect.y };
    const bottomLeft = { x: rect.x, y: rect.y + rect.height };
    const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height };

    if (doLineSegmentsIntersect(p1, q1, topLeft, topRight)) return true;
    if (doLineSegmentsIntersect(p1, q1, topRight, bottomRight)) return true;
    if (doLineSegmentsIntersect(p1, q1, bottomRight, bottomLeft)) return true;
    if (doLineSegmentsIntersect(p1, q1, bottomLeft, topLeft)) return true;

    return false;
}

export function isCircleIntersectingRect(circle, rect) {
    const circleDistX = Math.abs(circle.cx - rect.x - rect.width / 2);
    const circleDistY = Math.abs(circle.cy - rect.y - rect.height / 2);

    if (circleDistX > (rect.width / 2 + circle.r)) { return false; }
    if (circleDistY > (rect.height / 2 + circle.r)) { return false; }

    if (circleDistX <= (rect.width / 2)) { return true; }
    if (circleDistY <= (rect.height / 2)) { return true; }

    const cornerDistanceSq = Math.pow(circleDistX - rect.width / 2, 2) +
                             Math.pow(circleDistY - rect.height / 2, 2);

    return (cornerDistanceSq <= Math.pow(circle.r, 2));
}
