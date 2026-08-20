# Changelog

Notable changes to Nanquim are recorded in this file. The project follows
[Semantic Versioning](https://semver.org/) while it is pre-1.0, so minor
versions may still contain compatibility changes.

## [Unreleased]

## [0.1.0-alpha.1] - Unreleased

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
- Repeated welcome-screen dismissal around Firefox's file chooser no longer
  raises an uncaught error.

### Security

- SVG imports and clipboard content pass through bounded sanitization and
  reference remapping before entering the live document.
- Dependency overrides address known high-severity issues in transitive
  packages.

[Unreleased]: https://github.com/elschilling/nanquim/commits/master
[0.1.0-alpha.1]: docs/releases/v0.1.0-alpha.1.md
