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
