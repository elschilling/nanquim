# Nanquim

**A browser-based 2D CAD editor built around editable SVG.**

[Live demo](https://nanquim.vercel.app/) · [Report a bug](https://github.com/elschilling/nanquim/issues) · [Source code](https://github.com/elschilling/nanquim)

[Public-beta plan](plans/v0.1-public-beta-plan.md) · [Changelog](CHANGELOG.md) · [Capability status](docs/capabilities.md) · [Visual identity](docs/visual-identity.md) · [Native document format](docs/native-document-format.md) · [Editing transactions](docs/editing-transactions.md) · [Testing](docs/testing.md) · [Browser support](docs/browser-support.md)

> [!WARNING]
> Nanquim is in active, pre-1.0 development. Features and saved metadata may still change, and some CAD and file-format edge cases are not covered by automated tests. Use copies of important drawings and please report anything that breaks.

## About

Nanquim is an open-source 2D CAD editor for creating technical drawings directly in the browser. Its document model is SVG, so drawings remain inspectable, portable vector files rather than being locked into an opaque project format. Nanquim adds CAD-oriented precision tools, organization, Paper Space, reusable content, and procedural geometry on top of that SVG foundation.

The name is a reference to the technical ink pens (*canetas nanquim*) traditionally used by architects and engineers. The long-term vision is to explore a lightweight technical drawing workflow that can interoperate well with open design tools such as Blender and Bonsai. Direct Blender/Bonsai integration is not implemented yet.

### Appearance and identity

Nanquim keeps its editor-oriented CAD workspace while using an original visual
language based on technical ink, drafting marks, and restrained paper-like
surfaces. Its project-authored SVG icons replace the prototype's inherited
icon artwork and remain crisp and theme-aware at compact UI sizes.

Open **Preferences → Appearance** to choose **Oxide Red**, **Verdigris Green**,
or **Blueprint Blue**. Selecting either color field creates a custom theme with
independent accent and background colors; the interface automatically chooses
a readable light or dark foreground. Appearance is stored only in the browser
and never changes or dirties the drawing document. See the
[visual-identity guide](docs/visual-identity.md) for the design and icon rules.

## Current capabilities

The list below describes the available surface. The
[capability ledger](docs/capabilities.md) records which areas are stable,
partial, experimental, or planned, together with their current evidence and
limitations.

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
- Reusable text and dimension styles, with locally bundled Inter, DM Sans,
  JetBrains Mono, and Fira Code families available to both the browser UI and
  PDF embedding. The provenance inventory documents portable variants and
  output limitations.

### Paper Space and output

- A separate Paper Space with ISO A0–A4 and custom sheet sizes and portrait/landscape orientation.
- Multiple live model viewports with editable `1:N` scales and model origins.
- Paper annotations and per-color print mapping, including grayscale and black presets.
- Paper export to standalone SVG and PDF.

### SVG, DXF, and browser files

- Create, open, save, and Save As editable schema-v3 SVG documents with
  transactional replacement, dirty-state protection, and metadata for
  collections, specialized geometry, styles, blocks, Paper Space, and Geometry
  Nodes. Historical schema-v1/v2 documents migrate on Open.
- Import supported DXF geometry and export common DXF entities, including lines, circles, ellipses, arcs, polylines, and text. DXF text import is not supported yet.
- Copy and paste Nanquim SVG elements with ID cleanup.
- Welcome screen and recent disk files where the browser supports persistent file handles.
- `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, and `Ctrl+Shift+S` cover New, Open, Save, and
  Save As, with download/upload fallbacks when direct file access is
  unavailable. Because browsers cannot confirm a portable download was kept,
  download-only Save As conservatively leaves the drawing marked unsaved.

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

The left command palette exposes the same registry-backed commands as the
terminal through icon buttons. Drag its right edge to resize it: the compact
rail shows icons, while widths of 168px or more reveal tool names grouped by
category. Use **Tools** in the application bar or press `F4` to show or hide it.

| Area | Commands |
| --- | --- |
| General | `HELP (?)` |
| Draw | `LINE (L)`, `CIRCLE (C)`, `ELLIPSE (EL)`, `RECTANGLE (REC)`, `ARC (A)`, `POLYLINE (PL)`, `SPLINE (SP)`, `TEXT (T)`, `HATCH (H)` |
| Modify | `MOVE (M)`, `COPY (CO)`, `ROTATE (R)`, `SCALE (S)`, `OFFSET (O)`, `FILLET (F)`, `MIRROR (MI)`, `TRIM (TR)`, `EXTEND (EX)`, `ERASE (E)` |
| Organize | `GROUP (G)`, `UNGROUP (UG)`, `BLOCK (B)`, `INSERT (I)`, `MATCH_PROPERTIES (MA)` |
| Measure and annotate | `DIST (D)`, `AREA (AR)`, `DIMLINEAR (DM)`, `DIMALIGNED (DA)` |
| Paper Space | `VIEWPORT (VP)` |

### Useful keys

| Key | Action |
| --- | --- |
| `F1` | Open the command and keyboard shortcut reference |
| `Space` or `Enter` | Confirm terminal input; blank Space repeats the previous command |
| `Esc` | Cancel the active command or interaction |
| `Delete` | Delete the current selection |
| `Ctrl+N` | Create a new drawing |
| `Ctrl+O` | Open an SVG or DXF drawing |
| `Ctrl+S` | Save the editable native SVG document |
| `Ctrl+Shift+S` | Save the editable document under a new name |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `F2` | Expand or restore the terminal |
| `F3` | Toggle all viewport overlays |
| `F4` | Show or hide the command tools palette |
| `F7` | Toggle the grid |
| `F8` | Toggle Ortho |
| `F9` | Toggle object snapping |
| `F10` | Toggle polar tracking |

## Browser support and current limitations

- Desktop Chromium stable and the previous stable release are the primary beta
  target. Firefox stable and ESR are supported through the upload/download file
  workflow. Safari/WebKit is currently best-effort and checked manually before
  prereleases; mobile and touch-first editing are not supported yet.
- Persistent recent-file handles and direct overwrite require a secure context
  (`https` or `localhost`) and Chromium's File System Access API. The portable
  path uses file upload and download.
- System clipboard access depends on browser permissions, a secure context, and
  user activation; native paste events remain the fallback where available.
- DXF import/export supports common drawing entities, not every DXF feature or vendor extension.
- Every registered command has a deterministic invocation/cancellation
  contract, with deeper geometry and Undo/Redo cases for high-risk editing
  tools. Coverage is ratcheted in CI, and stock Chromium and Firefox run the
  same production-build workflow harness. Specialized geometry and
  interoperability combinations still require broader qualification.
- Real-time collaboration, geometric constraints, direct Blender/Bonsai connectivity, and desktop/PWA packaging are future ideas rather than current features.

See the [browser and file-API support policy](docs/browser-support.md) for the
exact tiers, fallbacks, and per-release verification record.

## Local development

### Prerequisites

- Node.js 22.22.2 or newer in the 22.x line.
- [pnpm](https://pnpm.io/) 8.15.5 (the version pinned in `package.json`).

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
pnpm test:coverage
pnpm test:browser:chromium
pnpm test:browser:firefox
pnpm build
```

Use `pnpm test:watch` while developing. See [Testing and
coverage](docs/testing.md) for the fixture contract, current ratchet, browser
requirements, and failure artifacts.

Release maintainers should use the
[release, deployment, and rollback checklist](docs/release-process.md).

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

Contributors and coding agents should also read [AGENTS.md](AGENTS.md).

## License

Nanquim is licensed under the [GNU General Public License v3.0](LICENSE).
Bundled third-party code, fonts, and artwork retain their respective licenses;
see [Third-party notices](THIRD_PARTY_NOTICES.md) and the
[asset provenance inventory](docs/asset-provenance.md).
