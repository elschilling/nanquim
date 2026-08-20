# Native Nanquim SVG documents

Last reviewed: 2026-08-20

Nanquim's editable project format is SVG with bounded Nanquim metadata. The
current native document schema is **3**. It is versioned independently from the
application and from Geometry Nodes metadata.

This page describes the compatibility contract rather than every internal SVG
attribute. The executable source of truth is `DocumentSerializer.js`,
`DocumentParser.js`, the staged loader, and their fixture tests.

## Native document boundary

A native document has an SVG root with `data-nanquim-version="3"`. Schema 3
stores:

- the model `viewBox`, element allocator, and active model collection;
- model collections and nested editable SVG geometry;
- canonical metadata for arcs, trimmed circles, ellipse arcs, splines,
  hatches, dimensions, and styled text;
- dimension styles, text styles, reusable block definitions and instances;
- document-owned gradients, patterns, clip paths, masks, markers, symbols,
  and scoped styles;
- Paper configuration, stable viewport IDs, visibility and lock state, plus a
  separate editable Paper-annotation collection; and
- Geometry Nodes metadata in a `<metadata id="nanquim-geometry-nodes">`
  element, including graph canvas views but excluding transient canvas
  selection.

Geometry Nodes currently has its own schema version 1. Its version is checked
independently; changing the native SVG schema does not implicitly change a
graph schema.

Native serialization is structured with DOM APIs and `XMLSerializer`. It does
not use string concatenation for user-controlled names or text. Helpers,
selection/hover classes, edit handles, previews, and other transient UI state
are excluded. Serialization is side-effect free and refuses to run while an
interactive mutation is unfinished. The serializer applies the same SVG,
metadata, element-count, XML-character, and UTF-8 file-size boundaries as the
loader, so it cannot knowingly write a file that its own parser would alter or
reject.

## Compatibility policy

| Input | Behavior |
| --- | --- |
| Schema 3 | Open as the current native format. A fully valid document starts clean. |
| Schema 1 or 2 | Migrate in memory to schema 3, report the migration, retain the native file association, and start dirty so an explicit Save writes the new format. |
| Future or invalid schema marker | Reject before changing the active drawing, history, dirty state, or file handle. |
| SVG without a Nanquim schema marker | Treat as sanitized foreign SVG import, start dirty, and do not associate its disk handle with native Save. |
| DXF | Convert and sanitize as an interchange import, start dirty, and do not associate its disk handle with native Save. |

Optional corrupt metadata is isolated where safe geometry can still be
recovered. The affected subsystem is reset, a bounded diagnostic is shown, and
the opened document starts dirty. Unsafe roots, malformed XML, invalid schema
claims, excessive input, and unsupported future schemas fail closed.

All SVG, CSS, JSON metadata, Geometry Nodes payloads, and local references are
treated as untrusted. Parsing, sanitization, schema checks, bounds, ID planning,
manager hydration, and Paper validation occur on detached candidate state.
Only a fully prepared candidate can replace the live session.

## Document lifecycle

New and successful Open operations replace the session as one transaction.
They reset selection, command helpers, mode-specific interaction state,
managers, collections, both spatial indexes, and Undo/Redo history. A command
from a previous document cannot act on the new document. Preparation or commit
failure preserves the prior session and file association.

Dirty state uses a session-and-revision token. Save captures one canonical
snapshot and marks it clean only after a writable file handle closes
successfully. An edit or document replacement that occurs while a write is
pending makes that completion stale, so it cannot clean or retarget the newer
session. Cancellation, permission denial, and write failure keep the prior
handle and dirty state.

- **Save** writes the current editable native document, using its writable
  handle when one is safely associated.
- **Save As** writes the same canonical bytes to a new writable handle and
  adopts that association only after the write closes. Where the browser only
  offers a portable download, Nanquim cannot observe whether the user kept the
  file: it initiates the download but deliberately keeps the session dirty and
  does not claim a disk association.
- **Export SVG** creates a markerless presentation copy, omits Paper/session
  metadata, and converts white model paint to black on the detached copy for
  light-background interoperability.
- **Export DXF**, Paper SVG, and Paper PDF are interchange/output operations;
  they never mark the editable document clean or replace its native handle.

Persistent serialized Undo history is intentionally not part of the format.

## Compatibility fixtures and tests

Purpose-built fixtures live in `tests/fixtures`:

- `native-v1.svg` and `native-v2.svg` protect historical migration;
- `native-v3.svg` spans current collections, specialized geometry, XML-special
  text and names, definitions/references, blocks, Paper state, and cached
  Geometry Nodes output; and
- `basic-entities-r2000.dxf` is the bounded DXF parser baseline.

The semantic round-trip gate is `create/open -> serialize -> fresh open ->
serialize`, with normalized DOM comparison, unique-ID checks, and local
reference resolution. Lifecycle tests separately cover failed preparation,
late commit rollback, stale saves, permission/cancellation paths, and
direct-handle versus download equivalence.
