That confirms the diagnosis — you have a classic **O(n) hit-testing problem**. Every `mousemove` walks every entity, which at even 5,000 entities and 60fps becomes 300,000 checks per second. Here's how to fix it properly:

---

## The core fix: Spatial Indexing

You need an R-tree. The idea is simple: instead of checking every entity, you only check the ones whose bounding box overlaps the mouse cursor's vicinity.

**`rbush`** is the go-to library for this in JS — it's tiny (~3kb), battle-tested, and used in Mapbox:

```js
import RBush from 'rbush';

const tree = new RBush();

// After DXF import, index all entities
const items = entities.map(e => ({
  minX: e.bbox.minX,
  minY: e.bbox.minY,
  maxX: e.bbox.maxX,
  maxY: e.bbox.maxY,
  entity: e
}));
tree.load(items); // bulk-load is O(n log n), much faster than inserting one by one
```

Then on `mousemove`, instead of looping all entities:

```js
function onMouseMove(svgPoint) {
  const tolerance = 5 / currentZoom; // 5px in world space
  const candidates = tree.search({
    minX: svgPoint.x - tolerance,
    minY: svgPoint.y - tolerance,
    maxX: svgPoint.x + tolerance,
    maxY: svgPoint.y + tolerance,
  });
  // candidates is now a tiny list — do precise hit test only on these
  const hit = candidates.find(item => preciseHitTest(item.entity, svgPoint, tolerance));
}
```

This reduces your mousemove work from O(n) to O(log n + k) where k is the number of candidates near the cursor — usually 0–5.

---

## The precise hit test matters too

For lines/arcs, a bounding box alone isn't enough — a diagonal line has a lot of empty space in its bbox. After the R-tree narrows down candidates, run a proper geometric test:

```js
function preciseHitTest(entity, point, tolerance) {
  if (entity.type === 'LINE') {
    return distanceToSegment(point, entity.start, entity.end) < tolerance;
  }
  if (entity.type === 'CIRCLE') {
    const d = Math.hypot(point.x - entity.center.x, point.y - entity.center.y);
    return Math.abs(d - entity.radius) < tolerance;
  }
  if (entity.type === 'ARC') {
    // same as circle but also check angle range
  }
  // etc.
}
```

This two-phase approach (coarse bbox via R-tree → precise geometry check on candidates) is what every professional CAD and GIS tool does internally.

---

## Additional wins while you're at it

**Throttle mousemove.** Even with an R-tree, hit-testing 60 times/second is wasteful. Use `requestAnimationFrame` to gate it:

```js
let pendingMousePos = null;

canvas.addEventListener('mousemove', e => {
  pendingMousePos = getSVGPoint(e);
});

function renderLoop() {
  if (pendingMousePos) {
    doHitTest(pendingMousePos);
    pendingMousePos = null;
  }
  requestAnimationFrame(renderLoop);
}
```

**Keep the tree in sync.** When an entity is moved/deleted, update the R-tree:
```js
tree.remove(oldItem, (a, b) => a.entity.id === b.entity.id);
tree.insert(newItem);
```

**For selection box (rubber band select)**, the R-tree is even more valuable — `tree.search(selectionRect)` returns all candidates instantly instead of checking every entity.

---

## Expected result

With rbush, a drawing with 50,000 entities should hover-hit-test in under 0.1ms per frame. This fix alone will almost certainly make the performance problem disappear without any rendering changes.