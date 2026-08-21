# Nanquim capability ledger

Last reviewed: 2026-08-21

This ledger describes the current `v0.1` public-beta surface. A feature being
present in the interface does not by itself make it release-qualified.

## Status meanings

| Status | Meaning |
| --- | --- |
| **Stable** | The current contract is documented and protected by focused automated tests. Breaking changes require an explicit compatibility decision. |
| **Partial** | A useful workflow exists, but known edge cases, persistence gaps, or missing browser coverage prevent a stable guarantee. |
| **Experimental** | The feature is available for evaluation, but its behavior or saved representation may change before `v1.0`. |
| **Planned** | The feature is not part of the shipped product. |

These labels describe project confidence, not the maturity of the underlying
web standards or third-party libraries.

## Current capabilities

| Area | Status | Available now | Qualification boundary |
| --- | --- | --- | --- |
| Command discovery and Help | **Stable** | The terminal and resizable left command palette expose the same 30 registered commands. F1 Help is searchable and gives every command an illustration, aliases, category, and description. | The registry is the command source of truth. Adding or changing a command requires the registry, palette-icon, and Help completeness tests to remain green. |
| Appearance and visual identity | **Stable** | Project-authored SVG icons and semantic interface tokens provide Oxide Red, Verdigris Green, Blueprint Blue, and custom accent/background themes. Preferences preview safely, persist locally, adapt foreground contrast, and remain independent from drawing dirty state. | The existing editor layout is retained. Theme and icon inventory tests protect the token contract and prevent accidental return of the retired borrowed artwork; real-browser checks cover normal, narrow, and light-custom rendering. |
| Drawing and annotation | **Partial** | Line, circle, ellipse, rectangle, arc, polyline, spline, text, hatch, linear dimension, and aligned dimension workflows are present. Every registry command has a declared invocation, mode, and repeated-cancellation contract. HATCH traces untransformed visible Model geometry and may ignore transformed geometry only when its root-space bounds are provably remote from the clicked region. | HATCH rejects a clicked or detected region that may involve transformed boundary geometry, and fails safe when those bounds cannot be qualified. Pointer and typed completion semantics still need broader geometry-specific coverage beyond the current high-risk and representative completion cases. |
| Modification tools | **Partial** | Move, Copy, Rotate, Scale, Offset, Fillet, Mirror, Trim, Extend, Erase, and Match Properties are present. The main transforms, replacement trims, and Delete/Erase have deterministic History, cancellation, exact identity/order restoration, spatial-index, and Undo/Redo regressions. ROTATE and SCALE remain qualified for selected groups and Block instances with their own transforms when their ancestors are untransformed. OFFSET is qualified for untransformed lines, circles, and square-corner rectangles. | ROTATE/SCALE reject transformed primitives and selections inside transformed ancestors; MIRROR rejects a selected element's own transform or a transformed ancestor. TRIM/EXTEND reject transformed targets or boundaries, FILLET rejects transformed lines, and OFFSET rejects transformed, rounded-rectangle, or other unqualified input before mutation. Specialized nested and transformed geometry remains an expansion area; an explicit diagnostic is preferable to an unqualified approximation. |
| Measurement | **Partial** | Distance and enclosed-area commands are present. | Unit presentation, transformed/specialized geometry, and browser-visible reporting need broader workflow coverage. |
| Precision and selection | **Partial** | Relative and absolute coordinate input, Ortho, polar tracking, grid, object snaps, directional selection, multi-selection, and editing grips are present. Nested transforms are converted between active-root and element-local coordinates for qualified grips and line/arc/ellipse-arc/spline snaps; Model and Paper expose only their own selectable content. | Block snap targets are limited to the insertion point and measurable bounds rather than referenced internals. Spline nearest is sampled, and circle-only advanced solvers are withheld after transforms that make the curve non-circular. The full release browser matrix is still pending. |
| Collections and Outliner | **Partial** | Active destinations, inherited style, visibility, locking, opacity, nesting, and synchronized selection are present. Model selection excludes hidden or locked Model content and all Paper annotations; Paper selection excludes Model content and respects hidden/locked viewport and annotation state. Visible locked Model geometry remains available to Model boundary discovery even though it cannot be selected. Canonical native round-trip coverage protects ownership, style, visibility, locking, and opacity. Transactional Delete restores elements to their exact separate parents and sibling positions. | Destructive-edit interactions still need broader geometry-specific coverage outside the qualified command set. |
| Groups and Blocks | **Partial** | Same-parent SVG geometry can be grouped without changing sibling order. Ordinary untransformed groups without group-level presentation styling can be ungrouped. BLOCK accepts same-parent selections only after proving the selected nodes, their ancestors, and their descendant trees are untransformed; it records definition children in document order, places the instance at the earliest selected slot, and restores exact source positions and selection order. Reusable block definitions can be inserted, edited, and persisted with opaque reference IDs and exact display names. | Mixed-parent grouping/BLOCK and appearance-flattening Ungroup operations are rejected rather than changing coordinate systems or geometry silently. Complex nested-reference interoperability and presentation-export behavior still need broader qualification. |
| Undo and Redo | **Partial** | Shared History is failure-atomic at its stack boundary, clears Redo after a new edit, and advances dirty state once per completed Execute, Undo, or Redo. Registered mutating commands commit only after interactive input is complete; composite grips, Delete, Paste, grouping, transforms, and trim replacements restore their covered semantic state atomically. Paper viewport Redo rehydrates the same persisted id and geometry into a fresh live viewport object with interaction wiring restored. New/Open discard the prior session's history. | Inspector fields, collection settings, and continuous saved-view navigation mark the document dirty but are not individual Undo entries. Persisted History and JavaScript object identity across a successful viewport Undo/Redo are intentionally out of scope. |
| Native Nanquim SVG | **Stable** | Schema-v3 is the canonical editable format. A single structured serializer preserves model geometry, imported definitions, collections, specialized metadata, styles, blocks, Paper annotations/viewports, and Geometry Nodes metadata. Schema-v1/v2 fixtures migrate to v3. | Future schemas are rejected before mutation. Corrupt optional metadata is bounded and reported. Interchange SVG remains a separate, potentially lossy export rather than a native document. |
| Foreign SVG import | **Partial** | Safe SVG geometry, local references, selected definitions, and scoped styles can be sanitized and imported. | Complex authoring-tool output and complete definition/style round trips still need curated interoperability profiles. Active content and external resources are deliberately removed. |
| DXF import and export | **Partial** | Common drawing entities can be imported, and common line, circle, ellipse, arc, polyline, and text entities can be exported. | DXF is not lossless, many entities/vendor extensions remain unsupported, and text import is not supported. `tests/fixtures/basic-entities-r2000.dxf` is a parser baseline rather than a broad conformance file. |
| Paper Space and PDF/SVG output | **Partial** | ISO/custom sheets, orientation, scaled model viewports, editable persisted Paper annotations, print color mapping, SVG export, and PDF export are present. Viewport groups retain a live link to their owning `PaperViewport`; saved state and viewport-command Redo rebuild that link, while a failed staged Open restores the exact prior viewport objects, SVG nodes, listeners, selection, and collection entry. Paper selection is isolated from Model content and respects viewport/annotation visibility and locking. The current-browser workflow covers pointer selection plus annotation Move/Undo/Redo and parsed SVG output. | Fonts, physical scales, print mapping, PDF equivalence, and the remote release browser matrix still require broader real-renderer qualification. |
| Browser file workflows | **Partial** | New/Open/Save/Save As, dirty-state warnings, File System Access handles where available, recent handles, and upload/download fallbacks share one lifecycle controller. On Fedora 44, Chromium 151.0.7922.137 and Firefox 153.0.3 each pass all nine production workflows, including exact native save/reopen/resave bytes, geometry/ownership, clean state, empty reopened History, and no retained fallback handle. CI targets current Chromium per PR and scheduled/prerelease current/previous Chromium plus Firefox stable/ESR. | A candidate still needs recorded remote previous-Chromium and Firefox-ESR results, direct persistent-handle overwrite/reopen, best-effort Safari, and the remaining [browser qualification](browser-support.md#release-qualification-record) and [release-process](release-process.md) checks. Download-only Save As remains dirty because browsers cannot confirm that the file was kept. |
| Clipboard | **Partial** | Nanquim SVG elements can be copied and pasted with bounded sanitization, scoped styles, canonical wrapper/imported IDs, repaired local references, and stable Undo/Redo identity. A delayed Clipboard API read is discarded if either the command session or captured document state changes before it resolves, and the portable production workflow covers a representative save/reopen round trip. | Real permission denial, unavailable Clipboard API behavior, more complex definitions, and engine-specific activation still need release-candidate checks. |
| Geometry Nodes | **Experimental** | A non-destructive procedural 2D graph editor, typed sockets, primitives, transforms, arrays, styling, cached output, and Apply/Remove workflows are available. | Standard SVG primitives are the primary target. Schema and editor behavior may change, and source elements currently need a shared parent when attaching a modifier. |
| Onboarding | **Partial** | A welcome screen, terminal prompts, command autocomplete, and F1 Help are present. | A first-drawing guide, versioned sample documents, accessibility qualification, and caption-first tutorials are planned for later milestones. |
| Constraints, collaboration, cloud storage, plugins, PWA/desktop, touch-first editing, and direct Blender/Bonsai connectivity | **Planned** | Not shipped. | These remain outside the `v0.1` beta scope until the document and entity models are stable. |

## Sources of truth

- `src/js/commands/_commands.js` defines user-facing terminal commands and
  aliases.
- `src/js/HelpSession.js` and `src/js/CommandIllustrations.js` render the Help
  catalog.
- `tests/command-lifecycle-contracts.test.js` checks registry, Help, icon,
  declared-mode, invocation, and cancellation parity for all commands; focused
  command tests provide deeper mutation semantics.
- `docs/visual-identity.md`, `tests/theme-preferences.test.js`,
  `tests/theme-styles.test.js`, and `tests/icon-system.test.js` define and
  protect the appearance system.
- `tests/document-parser.test.js`, `tests/document-lifecycle.test.js`, and
  `tests/document-roundtrip.test.js` protect native schema parsing, atomic
  replacement, migrations, and semantic round trips.
- `docs/testing.md`, `vite.config.js`, and `scripts/browser/run-workflows.mjs`
  define the coverage ratchet and real-browser workflow boundary.
- `plans/v0.1-public-beta-plan.md` defines the work required to promote partial
  or experimental areas.

When this ledger, Help, README, source, or tests disagree, verify behavior
against the source and tests, then update all affected documentation in the
same change.
