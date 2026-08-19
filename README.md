# Nanquim

**A browser-based 2D CAD editor built around editable SVG.**

[Live demo](https://nanquim.vercel.app/) · [Report a bug](https://github.com/elschilling/nanquim/issues) · [Source code](https://github.com/elschilling/nanquim)

> [!WARNING]
> Nanquim is in active, pre-1.0 development. Features and saved metadata may still change, and some CAD and file-format edge cases are not covered by automated tests. Use copies of important drawings and please report anything that breaks.

## About

Nanquim is an open-source 2D CAD editor for creating technical drawings directly in the browser. Its document model is SVG, so drawings remain inspectable, portable vector files rather than being locked into an opaque project format. Nanquim adds CAD-oriented precision tools, organization, Paper Space, reusable content, and procedural geometry on top of that SVG foundation.

The name is a reference to the technical ink pens (*canetas nanquim*) traditionally used by architects and engineers. The long-term vision is to explore a lightweight technical drawing workflow that can interoperate well with open design tools such as Blender and Bonsai. Direct Blender/Bonsai integration is not implemented yet.

## Current capabilities

### Drawing and annotation

- Lines, circles, rectangles, arcs, ellipses, polylines, and splines.
- Live text creation and editing.
- Hatches with selectable patterns, scale, color, opacity, and island-aware boundaries.
- Linear and aligned dimensions with reusable dimension styles.
- Distance measurement and enclosed-area calculation.

### Editing and modification

- Move, Copy, Rotate, Scale, Offset, Fillet, Mirror, Erase, Trim, and Extend.
- Group and Ungroup for ordinary SVG geometry.
- Directional window/crossing selection, multi-selection, and disambiguation when elements overlap.
- Direct editing grips for supported element types, including transformed geometry.
- Editable names, coordinates, geometry, stroke, fill, opacity, and dash properties.
- Match Properties and a shared Undo/Redo history for the main editing operations.

### Precision workflow

- AutoCAD-style command terminal with aliases, autocomplete, prompts, and repeat-last-command behavior.
- Numeric input plus `@x,y` relative coordinates and `#x,y` absolute coordinates.
- Ortho and polar tracking with on-canvas guides.
- Configurable endpoint, midpoint, center, quadrant, intersection, extension, perpendicular, tangent, nearest, and grid snaps.
- Dynamic grid and axes, configurable interaction tolerances, and zoom-independent handles and snap markers.

### Organization and reusable content

- Collections/layers with an active destination, inherited styles, visibility, locking, and opacity.
- A Blender-style Outliner synchronized with viewport selection.
- Nested SVG groups and element type indicators.
- Reusable Blocks that can be created, inserted as instances, and edited in place with Save or Discard.
- Reusable text and dimension styles, bundled with Inter, DM Sans, JetBrains Mono, and Fira Code variants for PDF output.

### Paper Space and output

- A separate Paper Space with ISO A0–A4 and custom sheet sizes and portrait/landscape orientation.
- Multiple live model viewports with editable `1:N` scales and model origins.
- Paper annotations and per-color print mapping, including grayscale and black presets.
- Paper export to standalone SVG and PDF.

### SVG, DXF, and browser files

- Open and save editable SVG drawings with Nanquim metadata for collections, specialized geometry, styles, blocks, Paper Space, and Geometry Nodes.
- Import supported DXF geometry and export common DXF entities, including lines, circles, ellipses, arcs, polylines, and text. DXF text import is not supported yet.
- Copy and paste Nanquim SVG elements with ID cleanup.
- Welcome screen and recent disk files where the browser supports persistent file handles.
- `Ctrl+O` and `Ctrl+S` file shortcuts, with download/upload fallbacks when direct file access is unavailable.

DXF is a broad format and round-trip support is not complete. Real-world SVG and DXF compatibility reports are especially useful.

## Experimental Geometry Nodes

Nanquim includes a Blender-inspired Geometry Nodes MVP for procedural 2D SVG. A modifier can be attached non-destructively to selected SVG geometry, keeping its source while rendering an evaluated SVG result.

The current node library includes:

- Line, Circle, Rectangle, and Text primitives.
- Join Geometry, Transform Geometry, linear arrays, and polar arrays.
- Set Style.
- Float, Integer, Boolean, Vector 2D, Color, Math, Vector Math, Combine XY, and Separate XY utilities.

The node editor supports pan/zoom, Fit, a searchable `Shift+A` menu, `X`/Delete, typed sockets, and undoable graph edits. Pulling a connection into empty space opens a search filtered to compatible nodes and sockets. Dropping an unconnected node over a wire inserts it into the flow; overlapping neighbors move apart with a short collision-aware animation.

Node graphs are stored in saved SVG metadata, preserve a last-known rendered SVG result, and can be muted, removed, or applied back into ordinary editable SVG geometry. This system is experimental: standard SVG primitives are the primary target, and attaching a modifier currently requires the selected source elements to share a parent.

## Commands and aliases

Enter a command or alias in the terminal, then follow its prompt.

| Area | Commands |
| --- | --- |
| Draw | `LINE (L)`, `CIRCLE (C)`, `ELLIPSE (EL)`, `RECTANGLE (REC)`, `ARC (A)`, `POLYLINE (PL)`, `SPLINE (SP)`, `TEXT (T)`, `HATCH (H)` |
| Modify | `MOVE (M)`, `COPY (CO)`, `ROTATE (R)`, `SCALE (S)`, `OFFSET (O)`, `FILLET (F)`, `MIRROR (MI)`, `TRIM (TR)`, `EXTEND (EX)`, `ERASE (E)` |
| Organize | `GROUP (G)`, `UNGROUP (UG)`, `BLOCK (B)`, `INSERT (I)`, `MATCH_PROPERTIES (MA)` |
| Measure and annotate | `DIST (D)`, `AREA (AR)`, `DIMLINEAR (DM)`, `DIMALIGNED (DA)` |
| Paper Space | `VIEWPORT (VP)` |

### Useful keys

| Key | Action |
| --- | --- |
| `Space` or `Enter` | Confirm terminal input; blank Space repeats the previous command |
| `Esc` | Cancel the active command or interaction |
| `Delete` | Delete the current selection |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `F2` | Expand or restore the terminal |
| `F3` | Toggle all viewport overlays |
| `F7` | Toggle the grid |
| `F8` | Toggle Ortho |
| `F9` | Toggle object snapping |
| `F10` | Toggle polar tracking |

## Browser support and current limitations

- Chromium-based browsers are currently the most tested.
- Firefox and Safari should be treated as test targets; bug reports are welcome.
- Persistent recent-file handles and direct overwrite require a secure context (`https` or `localhost`) and the browser File System Access API. Other browsers use file upload/download fallbacks.
- Copy/paste through the system clipboard may also require a secure context and clipboard permission.
- DXF import/export supports common drawing entities, not every DXF feature or vendor extension.
- Automated coverage currently focuses on Geometry Nodes, SVG adaptation/rendering, modifier persistence, Undo/Redo edge cases, and terminal input. Much of the legacy CAD workflow still relies on manual testing.
- Real-time collaboration, geometric constraints, direct Blender/Bonsai connectivity, and desktop/PWA packaging are future ideas rather than current features.

## Local development

### Prerequisites

- Node.js 20.19+, 22.12+, or 24+.
- [pnpm](https://pnpm.io/).

### Run the editor

```bash
git clone https://github.com/elschilling/nanquim.git
cd nanquim
pnpm install
pnpm dev
```

Vite will print the local development URL in the terminal.

### Tests and production build

```bash
pnpm test
pnpm build
```

Use `pnpm test:watch` while developing.

## Road to 1.0.0

The immediate goal is reliability rather than adding every possible CAD command. The most valuable testing areas are:

- SVG and DXF round trips through real design applications.
- Trim, Extend, Fillet, and snaps on arcs, ellipse arcs, splines, transformed geometry, and block instances.
- Paper scales, annotations, dimensions, fonts, print-color mapping, and PDF output.
- Large architectural drawings, selection performance, and Outliner responsiveness.
- Save/reopen, recent-file behavior, and long Undo/Redo sessions across browsers.
- Geometry Nodes persistence, Apply/Remove, compatible-node search, wire insertion, and export behavior.
- International keyboard layouts and focus switching between the terminal, Properties, and node editor.

## Contributing and bug reports

Ideas, focused pull requests, and reproducible bug reports are welcome. Please use [GitHub Issues](https://github.com/elschilling/nanquim/issues) and include, when possible:

- Browser, browser version, and operating system.
- The steps needed to reproduce the problem.
- Expected and actual behavior.
- A small shareable SVG or DXF file.
- A screenshot or short recording.
- Relevant browser console errors.

## License

Nanquim is licensed under the [GNU General Public License v3.0](LICENSE).
