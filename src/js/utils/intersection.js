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

export function isPolygonIntersectingRect(polygon, rect) {
  // 1. Check if any vertex of the polygon is inside the rectangle
  for (const vertex of polygon) {
    if (vertex.x >= rect.x && vertex.x <= rect.x + rect.width &&
      vertex.y >= rect.y && vertex.y <= rect.y + rect.height) {
      return true;
    }
  }

  // 2. Check if any edge of the polygon intersects with the rectangle's edges
  const rectVertices = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const q1 = polygon[(i + 1) % polygon.length]; // Next vertex, wraps around

    for (let j = 0; j < rectVertices.length; j++) {
      const p2 = rectVertices[j];
      const q2 = rectVertices[(j + 1) % rectVertices.length];
      if (doLineSegmentsIntersect(p1, q1, p2, q2)) {
        return true;
      }
    }
  }

  // 3. Check if the rectangle is completely inside the polygon (point in polygon test)
  // Using a point from the rectangle (e.g., the center) is sufficient if no intersections were found
  const rectCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > rectCenter.y) !== (yj > rectCenter.y)) &&
      (rectCenter.x < (xj - xi) * (rectCenter.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

// Utility functions for line geometry
export function getLineEquation(line) {
  // SVG.js uses attr() method instead of getAttribute()
  // Works with svg.js elements or raw objects with x1,y1,x2,y2 properties
  const x1 = typeof line.attr === 'function' ? parseFloat(line.attr('x1')) : line.x1;
  const y1 = typeof line.attr === 'function' ? parseFloat(line.attr('y1')) : line.y1;
  const x2 = typeof line.attr === 'function' ? parseFloat(line.attr('x2')) : line.x2;
  const y2 = typeof line.attr === 'function' ? parseFloat(line.attr('y2')) : line.y2;

  return { x1, y1, x2, y2 }
}

export function getLineIntersection(line1, line2) {
  const l1 = getLineEquation(line1)
  const l2 = getLineEquation(line2)

  const denom = (l1.x1 - l1.x2) * (l2.y1 - l2.y2) - (l1.y1 - l1.y2) * (l2.x1 - l2.x2)

  if (Math.abs(denom) < 1e-10) {
    return null // Lines are parallel or coincident
  }

  const t = ((l1.x1 - l2.x1) * (l2.y1 - l2.y2) - (l1.y1 - l2.y1) * (l2.x1 - l2.x2)) / denom

  return {
    x: l1.x1 + t * (l1.x2 - l1.x1),
    y: l1.y1 + t * (l1.y2 - l1.y1),
  }
}

export function getLineCircleIntersections(line, circle) {
  // line: {x1, y1, x2, y2} (or from getLineEquation)
  // circle: {cx, cy, r}
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const cx = circle.cx;
  const cy = circle.cy;
  const r = circle.r;

  const A = dx * dx + dy * dy;
  const B = 2 * (dx * (line.x1 - cx) + dy * (line.y1 - cy));
  const C = (line.x1 - cx) * (line.x1 - cx) + (line.y1 - cy) * (line.y1 - cy) - r * r;

  const det = B * B - 4 * A * C;
  if (A <= 0.0000001 || det < 0) {
    return []; // No intersection
  } else if (det === 0) {
    // One intersection (tangent)
    const t = -B / (2 * A);
    return [{ x: line.x1 + t * dx, y: line.y1 + t * dy }];
  } else {
    // Two intersections
    const t1 = (-B + Math.sqrt(det)) / (2 * A);
    const t2 = (-B - Math.sqrt(det)) / (2 * A);
    return [
      { x: line.x1 + t1 * dx, y: line.y1 + t1 * dy },
      { x: line.x1 + t2 * dx, y: line.y1 + t2 * dy }
    ];
  }
}

export function getLineRectIntersections(line, rect) {
  // rect: {x, y, width, height}
  const intersections = [];

  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;

  // The 4 segments of the rectangle
  const segments = [
    { x1: minX, y1: minY, x2: maxX, y2: minY }, // Top
    { x1: maxX, y1: minY, x2: maxX, y2: maxY }, // Right
    { x1: maxX, y1: maxY, x2: minX, y2: maxY }, // Bottom
    { x1: minX, y1: maxY, x2: minX, y2: minY }  // Left
  ];

  for (const seg of segments) {
    const pt = getLineIntersection(line, seg);
    if (pt) {
      // Check if point is on the finite rectangle segment
      const intersectMinX = Math.min(seg.x1, seg.x2) - 1e-4;
      const intersectMaxX = Math.max(seg.x1, seg.x2) + 1e-4;
      const intersectMinY = Math.min(seg.y1, seg.y2) - 1e-4;
      const intersectMaxY = Math.max(seg.y1, seg.y2) + 1e-4;

      if (pt.x >= intersectMinX && pt.x <= intersectMaxX &&
        pt.y >= intersectMinY && pt.y <= intersectMaxY) {
        intersections.push(pt);
      }
    }
  }

  return intersections;
}

export function getCircleCircleIntersections(c1, c2) {
  const dx = c2.cx - c1.cx;
  const dy = c2.cy - c1.cy;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d > (c1.r + c2.r)) return [];
  if (d < Math.abs(c1.r - c2.r)) return [];
  if (d === 0 && c1.r === c2.r) return [];

  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));

  const cx2 = c1.cx + (dx * a) / d;
  const cy2 = c1.cy + (dy * a) / d;

  const int1 = { x: cx2 + (h * dy) / d, y: cy2 - (h * dx) / d };
  const int2 = { x: cx2 - (h * dy) / d, y: cy2 + (h * dx) / d };

  if (h === 0) return [int1];
  return [int1, int2];
}