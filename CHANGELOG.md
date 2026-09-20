# Changelog

Notable changes to Nanquim are recorded in this file. The project follows
[Semantic Versioning](https://semver.org/) while it is pre-1.0, so minor
versions may still contain compatibility changes.

The dated history starts with `v0.1.0-alpha.1`. Table dates use the Git committer
date (`YYYY-MM-DD`, in the timezone recorded by Git), not a release or deployment
date. Commit links identify the implementation; several changes can share one
commit. Earlier development remains available in the Git history.

When updating this file, add the newest dated entry first and describe the user
impact under Added, Changed, Fixed, or Security. Use the actual full commit hash
in the link; leave a change marked **Pending commit** until that hash exists.
Keep changes under **Unreleased** until a version is published, then move their
entries into the dated version section without rewriting past release records.
The Welcome screen reads this dated table and the release-tag records directly;
keep their date, commit-link, and summary columns when adding entries.

## [Unreleased]

### Dated commits

These entries describe development history, not production availability. The
2026-09-17 entry is on `feat/image-outliner-editing`, proposed in
[PR #31](https://github.com/elschilling/nanquim/pull/31). The Unreleased comparison
link at the end of this file follows `master`; feature-branch commits are linked
directly here until merged.

| Commit date | Commit | Changes |
| --- | --- | --- |
| 2026-09-17 | [a656268](https://github.com/elschilling/nanquim/commit/a65626832de97487322e63720f2db58ca7499bcf) | Image import, resize, translation, and crop; Outliner drag-and-drop, M move dialog, and Shift-click ranges; COPY snapping fixes. |
| 2026-08-22 | [25f6847](https://github.com/elschilling/nanquim/commit/25f6847e78385299d1334fca3610123a96ca62b1) | Rotate affine-transformed geometry while preserving its local geometry, metadata, and Undo/Redo. |
| 2026-08-21 | [4c7d7c7](https://github.com/elschilling/nanquim/commit/4c7d7c78fd9d998b7b174c1e0b1eb042ea744763) | Qualify one-sheet Paper output and SVG/DXF/PDF exchange; add interoperability fixtures, diagnostics, and performance budgets. |
| 2026-08-21 | [e727f91](https://github.com/elschilling/nanquim/commit/e727f91cb334497648e876ec781d6db09b75655d) | Support Firefox ESR in the production browser harness and record browser qualification. |
| 2026-08-21 | [21ba97c](https://github.com/elschilling/nanquim/commit/21ba97cb275da0f867ba27f089172594baf684fb) | Make editing transactions, cancellation, Undo/Redo, and command lifecycle behavior predictable. |
| 2026-08-20 | [1c469b4](https://github.com/elschilling/nanquim/commit/1c469b492e5e00f066e079c2044405b6858d2fd6) | Add the resizable command palette with registry-backed tools and an F4 toggle. |
| 2026-08-20 | [45e775f](https://github.com/elschilling/nanquim/commit/45e775f69f98cf783c352ec743d801db56d7218a) | Add Nanquim's visual identity, original icons, appearance presets, and adaptive theme colors. |
| 2026-08-20 | [18825e0](https://github.com/elschilling/nanquim/commit/18825e0097315184b1b2e7ecc31db8d437266598) | Add the schema-v3 document lifecycle, safe New/Open/Save/Save As, and dirty/session tracking. |
| 2026-08-20 | [ec8d128](https://github.com/elschilling/nanquim/commit/ec8d128e68455addd3a64901e3b82a9b97ef5a21) | Record completion of the Phase 0 release baseline. |

### Added

- **Pending commit:** Click the Nanquim icon in the top bar to reopen Welcome
  without changing the drawing. Welcome includes dated changelog history and
  commit links, keyboard navigation, and a layout that adapts to narrow windows.
- Local PNG, JPEG, GIF, and WebP insertion with `IMAGE` (`IMG`, `IMAGEATTACH`)
  or viewport file drop. Images are embedded in the active Model collection.
- Image corner resize grips, a center translation grip, and flat side crop
  grips, with cancellation and Undo/Redo. Cropping preserves the original
  pixels and remains editable after native SVG save/reopen and clipboard copy.
- Outliner drag-and-drop and keyboard moves for elements, groups, and
  collections, preserving drawing positions, styles, and Undo/Redo.
- An **M** shortcut while the pointer is over the Outliner to move selected
  geometry into an existing or new collection. Creating the collection and
  moving its contents form one Undo step.
- Outliner **Shift-click** range selection in both directions, with an
  adjustable endpoint, independent selections preserved, and hidden or locked
  content excluded. See the [Outliner guide](docs/outliner.md).
- A canonical schema-v3 native SVG serializer and documented document-format
  contract covering model geometry, imported definitions, collections, styles,
  blocks, Paper annotations and viewports, and Geometry Nodes metadata.
- Explicit New, Open, Save, Save As, and presentation SVG Export workflows,
  including portable upload/download fallbacks and unsaved-change protection.
- Central document-state tracking for dirty revisions, file associations, and
  save/session race protection.
- Oxide Red, Verdigris Green, and Blueprint Blue appearance presets, plus
  custom accent/background colors with adaptive foreground contrast.
- A project-authored technical-drafting SVG icon set and original Nanquim
  pen-nib application mark.
- A resizable left command palette with distinct project-authored icons for all
  registered tools, compact and categorized labeled modes, and an `F4` toggle.
- A V8 coverage ratchet, deterministic command fixture/leak harness, and an
  explicit lifecycle and Model/Paper availability contract for all 31
  registered commands.
- Production-build browser workflows for current Chromium on pull requests
  and scheduled/prerelease current/previous Chromium plus Firefox stable/ESR
  qualification, with isolated profiles and actionable failure artifacts.
- Purpose-built SVG/DXF interoperability profiles with semantic expectations,
  sanitizer/degradation checks, unit/layer coverage, and a path-safe external
  qualification runner. The recorded Inkscape 1.4.4 and Blender 5.2.0 LTS
  checks pass; LibreCAD 2.2.1.2 remains an explicit manual gate.
- Deterministic in-memory 1,000- and 10,000-element performance fixtures and a
  production-Chromium budget runner for load/save, spatial indexes, viewport
  interactions, snapping, Outliner synchronization, and Geometry Nodes, with
  median/p95 checks and bounded ignored JSON evidence.

### Changed

- Native schema-v1 and schema-v2 documents now migrate through a bounded,
  detached preparation pipeline before the live editor is replaced.
- Opening or creating a document now resets command helpers, selection,
  managers, spatial indexes, and Undo/Redo history as one document lifecycle.
- Native Save is lossless and separate from presentation export conversions.
- The existing editor layout now uses Nanquim-specific ink-and-paper surfaces,
  focus states, and visual hierarchy across the workspace, dialogs, Help, and
  Geometry Nodes.
- The application rail and drafting viewport are darker, while toolbar and
  Properties icons have roomier pointer targets without scaling their glyphs.
- Drawing-aid icons now provide hover descriptions, native keyboard controls,
  accessible names, and synchronized pressed/disclosure state.
- Appearance previews apply immediately, persist locally only when saved, and
  remain independent from drawing document state.
- Terminal aliases, canonical command names, repeat-last, the tool palette,
  and cancellation now share one registry-backed command runner.
- Browser viewport sizing now occurs at browsing-context creation so Firefox
  ESR can run the qualification workflow without an unsupported optional BiDi
  screen-orientation command.
- History commits completed mutations only after a successful deterministic
  apply, preserves its stacks on failures, clears Redo on a new edit, and
  advances document dirty state once per Execute, Undo, or Redo.
- Multi-element grip edits now commit synchronously as one composite History
  transaction, with all previewed geometry restored if any child update fails.
- Move, Copy, Rotate, Scale, Mirror, Offset, Trim replacements, text edits,
  bounds edits, Delete/Erase, blocks, hatch, insert, match-properties, paste,
  grouping, and viewport creation now use deterministic History transactions
  for their qualified mutation paths.
- ROTATE now composes rotations onto affine-transformed primitives, groups,
  Block instances, and geometry inside transformed ancestors without flattening
  local geometry or metadata. Unsupported CSS transforms and non-invertible
  ancestor matrices are rejected before mutation. SCALE remains limited to
  untransformed primitives and selected groups/Block instances whose ancestors
  are untransformed. MIRROR rejects selected geometry with its own or an
  inherited transform before creating previews.
- Grouping now preserves same-parent document order, while Ungroup refuses
  transformed or presentation-styled groups that cannot yet be flattened
  without changing their appearance.
- BLOCK now requires a same-parent selection whose selected nodes, ancestors,
  and descendants are untransformed, records definition children in source
  order, replaces the earliest selected slot, and restores exact source and
  selection ordering.
- Grip editing now constrains points in the visible SVG root and converts each
  target through its complete nested transform before changing local geometry.
- Object snaps now qualify transformed line, arc, ellipse-arc, spline,
  intersection, and Block-instance bounds in root coordinates. Unsafe
  circle-only advanced snaps remain disabled when a transform makes a curve
  non-circular.
- OFFSET now has an explicit support policy: untransformed lines, circles, and
  square-corner rectangles use one stable History mutation, while transformed,
  rounded-rectangle, and other unqualified input is rejected before ghosting.
- Paper viewport Undo/Redo now persists semantic viewport state: Redo creates a
  fresh live object with the same id and geometry and reconnects selection and
  interaction ownership to it.
- Paper output now has an explicit one-sheet beta contract with multiple
  viewports: automated checks cover ISO A0-A4/custom physical sizing, scale and
  origin math, persisted lock/visibility state, detached color mapping that
  preserves existing stroke widths, dependency-closed vector SVG, and vector
  PDF with representative bundled-font/dimension output. Per-color plot
  lineweights and multi-sheet/title-block workflows remain deferred.
- DXF exchange now converts recognized import units to centimetres, preserves
  qualified layer names/colors/visibility/locking as direct Model collections,
  bounds `INSERT` expansion, exports ASCII R2000 Model layers with centimetre
  units, and summarizes every approximated or skipped export category.

### Fixed

- **Pending commit:** TRIM accepts window and crossing rectangles when selecting
  cutting boundaries. Overlapping rectangles keep existing boundaries selected;
  individual clicks toggle them, and confirming or cancelling clears highlights
  and unfinished selection rectangles. Quick pointer movements also preserve
  the correct window or crossing direction.
- **Pending commit:** MIRROR starts axis input immediately for preselected
  objects, enabling snaps to source and target geometry. Its axis and reflected
  preview follow the current snapped point, including stationary Snap toggles.
  The axis guide stays thin with screen-sized dashes at every zoom level.
  Axis-point clicks no longer select nearby objects when an invalid axis cancels
  the command, and zooming or refreshing keeps editing handles suppressed.
- COPY now starts base-point input immediately when geometry is preselected,
  allowing snaps to the source geometry and other elements without an extra
  selection-confirmation step. Toggling Snap refreshes the indicator and preview
  at the current pointer; previews use the snapped destination. Image snap
  targets follow the visible crop and transforms.
- Moving an element through the Outliner no longer moves its selected
  collection parent instead. The entire collection header accepts geometry
  drops, including its top and bottom edges.
- Failed, cancelled, malformed, or future-schema opens no longer replace the
  current drawing, dirty state, history, or file handle.
- Paper annotations, viewport state, imported SVG assets, semantic geometry
  metadata, collection opacity, and XML-special names now survive native
  save/reopen round trips.
- Fallback SVG/DXF imports can no longer retain a stale writable handle from a
  previously opened native document.
- Concurrent or delayed Open, New, Save, and Save As operations can no longer
  retarget a newer session, overwrite a stale handle, or mark unverified
  download-only saves clean.
- Repeated command start/cancel cycles no longer accumulate the drawing,
  signal, modal, and keyboard listeners covered by the registry lifecycle
  contracts.
- New/Open collections now reacquire wrappers from the live SVG.js runtime, so
  draw-plugin commands remain available after replacing a document.
- Paper SVG export now binds SVG.js metadata namespaces explicitly, avoiding a
  Firefox XML parser failure while preserving namespaced semantic data.
- Trim replacements and bounds-changing edit commands now restore exact node
  order and identity on Undo/Redo or failed first apply, and consistently
  invalidate both spatial indexes.
- Delete and Erase now collapse nested selections, mutate only after validation,
  and restore exact nodes, parents, sibling order, and prior selection if
  undone or if a multi-node operation fails. Delete reports Paper viewports as
  unsupported instead of partially changing either editor surface.
- Paste now gives every persistent scope wrapper a canonical ID and name,
  preserves remapped references and node identity through Undo/Redo and native
  save/reopen/resave, and cannot apply a delayed Clipboard API read to a newer
  document session.
- Native reopen now canonicalizes Paper annotation attributes and preserves a
  single paste-scope marker, so the qualified save/reopen/resave workflow emits
  identical bytes without changing geometry or collection ownership.
- TRIM and EXTEND now reject transformed targets or boundaries, and FILLET
  rejects transformed lines, before intersection calculation or History
  mutation.
- HATCH now excludes transformed leaves from local-coordinate boundary tracing,
  rejects transformed geometry that may affect the clicked/detected region,
  and still permits a hatch when transformed geometry is provably remote.
- Model and Paper selection indexes no longer expose the other editor surface's
  geometry. Hidden or locked viewport/annotation state is honored in Paper,
  hidden or locked Model content is not selectable, and visible locked Model
  geometry can still serve as a geometric boundary.
- Cancelled asynchronous command continuations and session-aware delayed
  callbacks no longer overwrite a successor command session, and delayed
  Clipboard API reads are discarded if either the command session or captured
  document state changes.

### Security

- Document parsing now enforces source, element, metadata depth/count, and
  numeric bounds before sanitized content reaches the live application DOM.
- Native serialization rejects unsupported SVG and XML-invalid characters
  before creating a file that could reopen with altered or missing content.

## [0.1.0-alpha.1] - 2026-08-20

Release tag: `v0.1.0-alpha.1`. Commit:
[0715d22](https://github.com/elschilling/nanquim/commit/0715d22ad99e41a89a7ccca93588b5a04a59656c)
(2026-08-20). See the [release notes](docs/releases/v0.1.0-alpha.1.md) for the
qualified candidate and its deployment record.

### Added

- An initial versioned prerelease baseline for the browser-based SVG CAD
  editor.
- Model Space drawing and modification commands available through the toolbar
  and terminal, with searchable command Help.
- Collections, reusable blocks, Paper Space, SVG and DXF exchange, PDF output,
  and experimental Geometry Nodes workflows.
- Automated tests and continuous integration for currently covered behavior.

### Changed

- The displayed application version now comes from package metadata at build
  time instead of duplicated hardcoded strings.
- Legacy production assets and duplicate sources were removed, and active Sass
  styles were migrated to the module system.

### Fixed

- Paper viewports and their SVG/PDF exports now scale model geometry around the
  SVG origin instead of shifting it outside the viewport clip.
- Paper PDF export now preserves stroke-only line geometry referenced by a
  viewport instead of clipping it to an incomplete PDF Form bound.
- Repeated welcome-screen dismissal around Firefox's file chooser no longer
  raises an uncaught error.

### Security

- SVG imports and clipboard content pass through bounded sanitization and
  reference remapping before entering the live document.
- Dependency overrides address known high-severity issues in transitive
  packages.

[Unreleased]: https://github.com/elschilling/nanquim/compare/v0.1.0-alpha.1...master
[0.1.0-alpha.1]: https://github.com/elschilling/nanquim/releases/tag/v0.1.0-alpha.1
