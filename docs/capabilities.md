# Nanquim capability ledger

Last reviewed: 2026-08-20

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
| Command discovery and Help | **Stable** | The terminal exposes 30 registered commands. F1 Help is searchable and gives every registered command an illustration, aliases, category, and description. | The registry is the command source of truth. Adding or changing a command requires the registry-completeness tests to remain green. |
| Drawing and annotation | **Partial** | Line, circle, ellipse, rectangle, arc, polyline, spline, text, hatch, linear dimension, and aligned dimension workflows are present. | Most command lifecycles still need complete pointer/typed-input, cancellation, helper-cleanup, and Undo/Redo coverage. |
| Modification tools | **Partial** | Move, Copy, Rotate, Scale, Offset, Fillet, Mirror, Trim, Extend, Erase, and Match Properties are present. | Intersections, transformed geometry, specialized elements, redo invalidation, and repeated cancellation are not yet qualified across the full command set. |
| Measurement | **Partial** | Distance and enclosed-area commands are present. | Unit presentation, transformed/specialized geometry, and browser-visible reporting need broader workflow coverage. |
| Precision and selection | **Partial** | Relative and absolute coordinate input, Ortho, polar tracking, grid, object snaps, directional selection, multi-selection, and editing grips are present. | Snap and selection behavior is not yet covered by a deterministic real-browser matrix for all supported geometry and transforms. |
| Collections and Outliner | **Partial** | Active destinations, inherited style, visibility, locking, opacity, nesting, and synchronized selection are present. | Save/reopen and destructive-edit interactions still need canonical document fixtures and broader regression coverage. |
| Groups and Blocks | **Partial** | Ordinary SVG groups can be grouped/ungrouped. Reusable block definitions can be created, inserted, and edited. | Definition/reference preservation, ID collision handling, export behavior, and historical-file compatibility are not yet release-qualified end to end. |
| Undo and Redo | **Partial** | Shared command history supports Undo/Redo for many editing operations. | Some interactive commands still bypass the canonical execution path, and New/Open reset isolation is not yet proven for every workflow. Persisted history is intentionally out of scope. |
| Native Nanquim SVG | **Partial** | Schema-v1 and schema-v2 SVG roots, collections, specialized metadata, styles, blocks, Paper settings/viewports, and Geometry Nodes metadata can be read by the current loader. | A canonical serializer and full semantic round-trip suite are still planned. Editable Paper annotations and some imported definitions are known persistence risks. The small fixtures in `tests/fixtures` establish parser baselines, not full compatibility. |
| Foreign SVG import | **Partial** | Safe SVG geometry, local references, selected definitions, and scoped styles can be sanitized and imported. | Complex authoring-tool output and complete definition/style round trips still need curated interoperability profiles. Active content and external resources are deliberately removed. |
| DXF import and export | **Partial** | Common drawing entities can be imported, and common line, circle, ellipse, arc, polyline, and text entities can be exported. | DXF is not lossless, many entities/vendor extensions remain unsupported, and text import is not supported. `tests/fixtures/basic-entities-r2000.dxf` is a parser baseline rather than a broad conformance file. |
| Paper Space and PDF/SVG output | **Partial** | ISO/custom sheets, orientation, scaled model viewports, Paper annotations, print color mapping, SVG export, and PDF export are present. | Annotation persistence, fonts, scales, print mapping, and output equivalence still require semantic and real-renderer qualification. |
| Browser file workflows | **Partial** | Open/Save shortcuts, File System Access handles where available, recent handles, and upload/download fallbacks are present. | Permission loss, cancellation, wrong-file prevention, atomic Open, dirty state, Save As, and cross-browser equivalence are not yet fully qualified. |
| Clipboard | **Partial** | Nanquim SVG elements can be copied and pasted with ID cleanup. | Clipboard permissions, fallbacks, complex definitions, and browser differences need real-browser coverage. |
| Geometry Nodes | **Experimental** | A non-destructive procedural 2D graph editor, typed sockets, primitives, transforms, arrays, styling, cached output, and Apply/Remove workflows are available. | Standard SVG primitives are the primary target. Schema and editor behavior may change, and source elements currently need a shared parent when attaching a modifier. |
| Onboarding | **Partial** | A welcome screen, terminal prompts, command autocomplete, and F1 Help are present. | A first-drawing guide, versioned sample documents, accessibility qualification, and caption-first tutorials are planned for later milestones. |
| Constraints, collaboration, cloud storage, plugins, PWA/desktop, touch-first editing, and direct Blender/Bonsai connectivity | **Planned** | Not shipped. | These remain outside the `v0.1` beta scope until the document and entity models are stable. |

## Sources of truth

- `src/js/commands/_commands.js` defines user-facing terminal commands and
  aliases.
- `src/js/HelpSession.js` and `src/js/CommandIllustrations.js` render the Help
  catalog.
- `tests/help-session.test.js` checks registry/Help completeness.
- `tests/phase0-fixtures.test.js` checks the small native SVG and DXF fixture
  baselines.
- `plans/v0.1-public-beta-plan.md` defines the work required to promote partial
  or experimental areas.

When this ledger, Help, README, source, or tests disagree, verify behavior
against the source and tests, then update all affected documentation in the
same change.
