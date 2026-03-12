# Paper Editor Implementation Plan

## Overview
The Paper editor is a layout/printing workspace that allows users to create printable sheets with viewports into the model space, similar to AutoCAD's Paper Space. Users can configure paper size, create viewports with scalable model views, add annotations, and export to PDF/SVG for printing.

---

## Current Architecture Analysis

### Existing Components
- **Editor.js**: Core editor class managing SVG canvas, selection, history, signals
- **Viewport.js**: Handles grid, pan/zoom, mouse interactions, drawing operations
- **Outliner.js**: Tree view of collections and elements
- **Properties.js**: Transform and style property panels
- **Collection.js**: Collection management (groups with visibility, lock, default styles)
- **Terminal.js**: Command line interface
- **Commands**: Individual tool implementations (DrawLine, DrawCircle, etc.)

### UI Structure
- Single-page application with Pug templates
- Layout: Navbar + Editor area + Outliner + Properties + Terminal
- Editor header contains `icon-editor-svgcad` dropdown (currently placeholder)

---

## Proposed Architecture

### 1. Editor Mode System

**Problem**: Currently only one editor mode exists. Need to switch between "Model" (free drawing) and "Paper" (layout) modes.

**Solution**: Create an `EditorMode` base class and concrete implementations:
```
src/js/editor-modes/
  EditorMode.js          - Abstract base class
  ModelEditorMode.js     - Current behavior (free drawing)
  PaperEditorMode.js     - Paper layout mode
```

The main `Editor` class will delegate to the active mode. Mode switching triggered by dropdown.

**Key responsibilities per mode**:
- Canvas rendering (what background shows)
- Tool availability (which commands are active)
- Outliner content (additional collections)
- Properties panel (mode-specific tabs)
- Export behavior

### 2. Paper Editor Core Components

#### 2.1 PaperEditorMode.js
- Manages paper configuration (size, margins, orientation)
- Renders paper sheet as a white rectangle on canvas
- Maintains two special collections: `Viewports` and `Annotations`
- Switches active collection between Model collections (read-only) and Annotations (editable)
- Handles viewport creation and management

#### 2.2 ViewportObject.js
Represents a viewport window into model space:
```javascript
class ViewportObject {
  constructor(x, y, width, height, scale, modelView) {
    this.x = x; this.y = y;
    this.width = width; this.height = height;
    this.scale = scale;  // e.g., 1:50, 1:100
    this.modelView = { center: {x,y}, zoom: ... }; // What portion of model to show
    this.clipPath = ...; // SVG clipPath for viewport window
    this.contentGroup = ...; // Group containing model snapshot/reference
  }
  render() { /* Draw border + clipped model content */ }
  updateModelView() { /* Re-render model content at current scale */ }
}
```

**Implementation approach**:
- Viewport is an SVG `<g>` with a `<clipPath>` containing a `<rect>`
- Inside the group: a snapshot of the model drawing (clone of elements from model collections)
- The snapshot is transformed (scaled/translated) to match the viewport's scale and view center
- When model changes, all viewports need to update (signal-driven)

#### 2.3 PaperSettings.js
Manages paper configurations:
```javascript
const PAPER_SIZES = {
  A0: { width: 841, height: 1189, units: 'mm' },
  A1: { width: 594, height: 841, units: 'mm' },
  A2: { width: 420, height: 594, units: 'mm' },
  A3: { width: 297, height: 420, units: 'mm' },
  A4: { width: 210, height: 297, units: 'mm' },
  'Custom': { width: 0, height: 0, units: 'mm' }
};
```
- Stored in editor preferences or document metadata
- Properties panel allows selection and custom dimensions

### 3. Outliner Enhancements

**In Paper mode**, the Outliner shows:
1. All Model collections (read-only, grayed out, no add/delete)
2. **Viewports** collection (special, contains viewport objects)
3. **Annotations** collection (editable, for paper-specific drawings)

**Implementation**:
- Outliner.js checks `editor.activeMode.type === 'paper'`
- Renders model collections with disabled controls
- Adds two pseudo-collections for viewports and annotations
- Viewport objects appear as children of Viewports collection
- Annotations collection maps to a real SVG group in PaperEditorMode

### 4. Properties Panel Enhancements

#### 4.1 Settings Tab (Paper Mode)
When no element selected in Paper mode, show:
- Paper Size dropdown (A0-A4, Custom)
- Paper Width/Height inputs (enabled if Custom)
- Orientation (Portrait/Landscape)
- Margins (top, bottom, left, right)
- Export buttons: "Export as PDF", "Export as SVG"

#### 4.2 Viewport Properties
When a viewport object is selected:
- Scale (numeric input or preset: 1:1, 1:10, 1:50, 1:100, custom)
- View center X/Y (read-only, updated by "Set View" tool)
- Zoom level (read-only)
- Lock viewport (prevents accidental changes)

#### 4.3 Color Translation Tab
New tab in Properties panel (or separate panel):
- Lists all unique colors used in the drawing (from model elements)
- For each color, dropdown to map to a print color (black, grayscale, custom)
- Presets: "Color", "Monochrome", "Grayscale"
- Applied during PDF/print export

**Data structure**:
```javascript
colorMap = {
  '#ff0000': { printColor: '#000000', enabled: true },
  '#00ff00': { printColor: '#808080', enabled: true },
  ...
}
```
Stored in document metadata or preferences.

### 5. Export System

#### 5.1 SVG Export (Enhanced)
- Current `saveSVG()` exports model only
- New `exportPaperSVG()`:
  - Includes paper sheet rectangle
  - Includes viewports with their clipped model content
  - Includes annotations
  - Option to flatten or preserve layers

#### 5.2 PDF Export (New)
Use `jspdf` library (add to package.json):
```javascript
import jsPDF from 'jspdf'

function exportToPDF(paperSize, orientation, colorMap) {
  const doc = new jsPDF({
    orientation: orientation,
    unit: 'mm',
    format: [paperSize.width, paperSize.height]
  })
  // Convert SVG to canvas/image, then to PDF
  // Or use vector-based approach with svg2pdf
}
```

**Recommended library**: `svg2pdf.js` (vector preservation) or `canvg` (rasterization)

### 6. Command Additions

New commands for Paper mode:
- `PAPER`: Switch to Paper editor mode
- `VIEWPORT`: Create a new viewport rectangle
- `SETVIEW`: Set the view center/zoom for selected viewport (captures current model view)
- `EXPORTPDF`: Export paper as PDF
- `EXPORTSVG`: Export paper as SVG (with paper sheet)

Modified commands:
- Drawing commands (LINE, CIRCLE, etc.) → in Paper mode, create elements in `Annotations` collection
- All model editing commands → disabled in Paper mode (viewports are read-only)

### 7. UI Integration

#### 7.1 Dropdown Menu (icon-editor-svgcad)
Update Canvas.pug:
```pug
.editor-header
  .wgt.wgt-menu
    span.icon.icon-editor-svgcad
    .icon.icon-dropdown
    .dropdown-menu(style='...')
      .menu-item(data-mode='model') Model Space
      .menu-item(data-mode='paper') Paper Space
```

#### 7.2 Mode Switching Logic
```javascript
// In Navbar.js or new EditorModeManager.js
document.querySelector('.dropdown-menu').addEventListener('click', (e) => {
  if (e.target.classList.contains('menu-item')) {
    const mode = e.target.dataset.mode;
    editor.setMode(mode); // 'model' or 'paper'
  }
});
```

#### 7.3 Visual Indicators
- Editor header shows current mode name
- Canvas background changes (grid in Model, white paper in Paper)
- Outliner shows mode-specific collections

---

## File Structure

```
src/js/
  EditorMode.js                    (new)
  editor-modes/
    EditorMode.js                  (new - abstract)
    ModelEditorMode.js             (new - wraps current behavior)
    PaperEditorMode.js             (new)
  PaperViewport.js                 (new)
  PaperSettings.js                 (new)
  ColorTranslator.js               (new)
  commands/
    CreateViewportCommand.js       (new)
    SetViewCommand.js              (new)
    ExportPDFCommand.js            (new)
    ExportPaperSVGCommand.js       (new)
  modes/                           (optional: if large, split by mode)
    paper/
      PaperOutlinerExtensions.js   (new)
      PaperPropertiesExtensions.js (new)
      PaperCanvasRenderer.js       (new)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. Create `EditorMode` abstraction
2. Refactor current code into `ModelEditorMode`
3. Implement mode switching in Editor
4. Add dropdown UI and basic mode toggle
5. Tests: Switch modes, verify isolation

### Phase 2: Paper Mode Core (Week 2)
1. Implement `PaperEditorMode` with paper rendering
2. Add `Viewports` and `Annotations` collections
3. Modify Outliner to show mode-specific structure
4. Implement viewport object creation (simple rectangle first)
5. Tests: Create viewport, see it in outliner

### Phase 3: Viewport Functionality (Week 3)
1. Implement `ViewportObject` with clipping and model snapshot
2. Add scale property and view capture
3. Implement `SETVIEW` command
4. Update viewport when model changes (signal chain)
5. Tests: Viewport shows model content at correct scale

### Phase 4: Properties & Settings (Week 4)
1. Add Settings tab to Properties panel (Paper mode)
2. Implement paper size configuration (A0-A4, custom)
3. Add viewport properties (scale, view center)
4. Implement color translation UI and mapping
5. Tests: Change paper size, set viewport scale, map colors

### Phase 5: Export System (Week 5)
1. Add `svg2pdf` or `jspdf` dependency
2. Implement `EXPORTPDF` command
3. Enhance `EXPORTSVG` for paper layout
4. Apply color translation during export
5. Tests: Export to PDF/SVG with correct paper size and colors

### Phase 6: Drawing Tools & Polish (Week 6)
1. Ensure all drawing commands work in Annotations collection
2. Add margin guides and title block templates (optional)
3. Keyboard shortcuts for mode switching (e.g., Ctrl+Shift+P)
4. UI polish: icons, tooltips, visual feedback
5. Performance optimization: viewport update throttling
6. Comprehensive testing and bug fixes

---

## Technical Considerations

### Viewport Rendering Strategy
**Option A: Live Reference** (preferred)
- Viewport contains a live reference to model elements (not a static snapshot)
- When model changes, viewport updates automatically via signals
- Implementation: viewport's content group is a `<g>` with `<use>` elements referencing model elements
- Pros: Real-time updates, smaller file size
- Cons: Complex coordinate transforms, clipping performance

**Option B: Snapshot Clone**
- When viewport created, clone model elements into viewport group
- Updates require manual "Refresh Viewport" command
- Pros: Simpler, isolated
- Cons: Stale views, larger file size, sync issues

**Recommendation**: Start with Option B (snapshot) for MVP, implement Option A (live) later.

### Coordinate Systems
- Model space: World coordinates (floating point, arbitrary)
- Paper space: Millimeters (or inches) based on paper size
- Viewport: Converts model world → paper coordinates via scale and translation
- Need transformation matrix utilities

### Color Translation
- Applied at export time, not during editing
- Map: source color (hex) → print color (hex)
- Support for:
  - Exact mapping
  - Grayscale conversion (luminance formula)
  - Threshold (binary B/W)
- UI: Color picker for each unique color found in document

### Performance
- Large drawings with many viewports could be slow
- Use spatial indexing for viewport hit-testing
- Debounce viewport updates during model editing
- Consider Web Workers for PDF generation

---

## Dependencies

**New npm packages**:
- `jspdf` or `svg2pdf` (for PDF export)
- Possibly `pdf-lib` (more control)

**Existing dependencies**:
- `svg.js` (already used)
- `signals.js` (already used)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Viewport rendering performance | High | Use clipping, limit redraws, virtualize large viewports |
| PDF export quality | High | Test multiple libraries, vector vs raster approach |
| Color translation complexity | Medium | Start simple (1:1 mapping), add advanced later |
| Mode switching bugs | Medium | Comprehensive tests, isolate state per mode |
| Backward compatibility | High | Ensure existing SVG files open in Model mode unchanged |

---

## Success Criteria

1. User can switch to Paper mode via dropdown
2. Paper sheet renders at selected size (A4 default)
3. User can create a viewport, set its scale, and see model content
4. Outliner shows Viewports and Annotations collections
5. Properties panel shows paper settings when in Paper mode
6. User can map colors for print
7. Export to PDF produces correct paper size with content
8. All existing Model mode functionality remains intact
9. No regression in existing tests (if any)

---

## Next Steps

1. **Review this plan with the user** - Confirm approach, priorities, and any missing requirements
2. **Create detailed technical specs** for each component (class diagrams, API contracts)
3. **Set up development branch** `feature/paper-editor`
4. **Add test fixtures** - sample drawings with multiple colors, collections
5. **Begin Phase 1 implementation**

---

## Questions for User

1. Should viewports be **live** (auto-update) or **static** (manual refresh)?
2. What is the primary use case: **printing** or **plotting**? (affects color handling)
3. Should annotations be a separate collection or just part of the drawing?
4. Do you need **title block** templates or just blank paper?
5. What is the maximum paper size expected? (A0 is ~1m×1.4m)
6. Should PDF export be **vector** (scalable) or **raster** (image-based)?
7. Any specific **line weight** requirements for printing? (e.g., pen widths)

---

## Estimated Effort

- **Total**: ~6 weeks (assuming 1 developer, part-time)
- **Breakdown**:
  - Foundation: 1 week
  - Paper core: 1 week
  - Viewports: 1 week
  - Properties: 1 week
  - Export: 1 week
  - Polish: 1 week

*Note: This is a rough estimate; actual effort may vary based on complexity of viewport rendering and PDF export quality requirements.*
