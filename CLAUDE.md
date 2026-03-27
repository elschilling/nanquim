# Nanquim — Claude Code Guide

## Project Overview

**Nanquim** is a browser-based 2D CAD editor built entirely on SVG. It provides AutoCAD-style drawing commands, snapping, layers, and a command-line interface — all running in the browser without a server backend.

## Tech Stack

- **Vanilla JavaScript** (ES modules, no framework)
- **SVG.js** v3.2.5 — SVG manipulation (with panzoom, drawing, selection plugins)
- **Vite** v5.0.8 — build tool
- **Pug** — HTML templating
- **SASS** — stylesheets
- **pnpm** — package manager (use pnpm, not npm)
- **rbush** — R-tree spatial indexing for fast selection queries
- **vecks** — vector math
- **lodash** — utilities

## Commands

```bash
pnpm dev        # development server (hot reload, http://localhost:5173)
pnpm build      # production build → /dist
pnpm preview    # preview production build
```

## Architecture

### Core Modules (`src/js/`)

| File | Role |
|------|------|
| `Editor.js` | Central state: signals (pub/sub), snap settings, collections, history, mode |
| `Viewport.js` | Canvas rendering, mouse/keyboard events, selection, ghosting, snap visualization |
| `Terminal.js` | Command-line interface with AutoCAD-style aliases |
| `Outliner.js` | Hierarchical layer/element tree panel |
| `Properties.js` | Live element properties inspector |
| `Collection.js` | Layer system — groups SVG `<g>` elements with visibility/lock/style |
| `History.js` | Undo/redo stack |
| `Command.js` | Base class for all commands |

### Commands (`src/js/commands/`)

50+ command modules, each extending `Command.js`:
- **Draw**: Line, Circle, Rectangle, Arc, Spline, Text
- **Modify**: Move, Copy, Rotate, Scale, Offset, Mirror
- **Edit**: Trim, Extend, Fillet, EditVertex, Erase
- **Annotate**: LinearDimension, AlignedDimension, MeasureDistance

### Utilities (`src/js/utils/`)

- `snapSystem.js` — OSNAP point detection (endpoint, midpoint, center, intersection, perpendicular, tangent, nearest, quadrant)
- `gridDraw.js` — grid rendering
- `toolbarHandlers.js` — toolbar button wiring
- `DXFloader.js` — DXF import → SVG conversion
- `intersection.js` — geometric intersection for trim/extend
- `calculateDistance.js` — point-to-line, point-to-circle distances
- `transformGeometry.js` — matrix-based transforms
- `boundaryDetection.js` — selection boundary logic
- `SpatialIndex.js` — rbush wrapper for viewport hit queries

### Signal System

`Editor.js` owns a signals object (custom pub/sub). Key signals:
- `updatedSelection`, `clearSelection` — selection state changes
- `updatedOutliner` — layer/hierarchy changes
- `commandStarted`, `commandEnded` — command lifecycle

### Dual-Mode Editor

- **Model space** — infinite canvas for drawing
- **Paper space** — page layouts for printing/export, managed by `PaperEditor.js` / `PaperViewport.js`

## Code Conventions

- No linting or formatting tools configured — follow the style of surrounding code
- ES modules throughout (`import`/`export`)
- DOM manipulation is direct (no virtual DOM)
- Each command class manages its own undo/redo state by implementing `undo()`/`redo()` methods
- Snap and ortho state live in `Editor.js` and are read by `Viewport.js` during pointer events
- SVG elements are manipulated via SVG.js API, not raw DOM

## File Import / Export

- Import: SVG, DXF
- Export: SVG, PDF (via jsPDF + svg2pdf.js)

## No Test Framework

There are ad-hoc test scripts (`test-*.js`) in the project root for manual exploration, but no automated test runner is configured.
