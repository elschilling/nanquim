# Changelog

Notable changes to Nanquim are recorded in this file. The project follows
[Semantic Versioning](https://semver.org/) while it is pre-1.0, so minor
versions may still contain compatibility changes.

## [Unreleased]

### Added

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
  explicit lifecycle and Model/Paper availability contract for all 30
  registered commands.
- Production-build browser workflows for current Chromium on pull requests
  and scheduled/prerelease current/previous Chromium plus Firefox stable/ESR
  qualification, with isolated profiles and actionable failure artifacts.

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
- ROTATE and SCALE now reject transformed primitives or selections beneath a
  transformed ancestor while retaining lossless composition for selected
  groups and Block instances whose ancestors are untransformed. MIRROR rejects
  selected geometry with its own or an inherited transform before creating
  previews.
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

### Fixed

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
