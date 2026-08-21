# File interoperability and Paper output

Last reviewed: 2026-08-21

Qualification status: **Partial — Phase 3 is in progress.**

Nanquim uses SVG for both its editable native document and some interchange
output, but those are different contracts. Native schema-v3 SVG is the only
format intended to reopen every supported Nanquim feature. Foreign SVG, DXF,
Paper SVG, and Paper PDF are exchange or presentation formats with the
documented conversion boundaries below.

## Format status

| Format or workflow | Current contract | Status |
| --- | --- | --- |
| Native Nanquim SVG | Editable schema-v3 document, with tested schema-v1/v2 migration and atomic rejection of unsupported future schemas. | **Stable** |
| Foreign/presentation SVG | Sanitized vector import/export for the qualified profile; active content, external resources, and unsupported foreign content are removed and reported. | **Partial** |
| ASCII DXF import/export | Centimetre-based Model exchange for the supported entity and layer profile, with bounded diagnostics for skipped or approximated content. | **Partial** |
| Paper SVG/PDF | Vector output for one configured sheet containing annotations and one or more Model viewports. | **Partial** |

“Partial” means that the useful path is implemented and protected by focused
tests, not that it is lossless for arbitrary files from another authoring
tool. A native Save and an interchange Export must never be treated as the
same operation.

## Paper beta scope

The `v0.1` beta scope is **one Paper sheet per native document**. That sheet may
contain multiple Model viewports and editable Paper annotations. The current
contract includes:

- ISO A0 through A4 and bounded custom sizes, in portrait or landscape;
- physical `mm` output and `viewBox` dimensions derived from the configured
  SVG units per centimetre;
- physical 1:N viewport scale and Model origin independent of that SVG unit
  density;
- persisted viewport and annotation visibility/locking, with accessible
  Outliner controls;
- detached print-color remapping that preserves ordinary SVG stroke widths,
  paint-server references, metadata, and the live Model/Paper roots;
- dependency-closed safe definitions in standalone Paper SVG, with transient
  handlers and selection helpers removed; and
- vector PDF output that expands each Model viewport independently, remaps
  cloned IDs/references, preserves clipping and transforms, and embeds the
  qualified bundled Inter 400 font. Automated inspection recovers the
  dimension text `100 cm` and representative linework from the PDF.

Viewport bounds are persisted as Paper SVG user units; one physical centimetre
contains `unitsPerCm` of those units. Properties converts viewport bounds to and
from centimetres for display and editing. Coordinate density should be chosen
before arranging a sheet: changing it preserves stored user-unit coordinates
rather than destructively resampling annotations, so existing Paper positions
and sizes change physically.

Color mapping changes enabled stroke/fill colors only. It does **not** map
colors to plot lineweights, and it does not change an element's existing
`stroke-width`. Per-color plot-lineweight tables and multi-sheet/title-block
workflows are deferred beyond the first beta.

Automated tests cover every A0-A4 orientation at 1 and 2.5 SVG units per
centimetre, viewport scale/origin behavior, persisted Paper state, detached
SVG export, multiple PDF viewports, line-only geometry, reference closure,
stroke widths, the embedded font, and vector dimension output. The settled
local production harness passes all nine workflows in Chromium
151.0.7922.137 and Firefox 153.0.3, including intercepted Paper SVG/PDF
downloads with exact physical page bounds, vector-only output, closed local
references, and a nonempty embedded font. External visual comparison in
representative renderers, direct persistent-handle coverage, Safari, and an
exact-release-candidate rerun remain open release checks.

## SVG qualification profile

The purpose-built `nanquim-svg-interoperability-v1` fixture is 210 mm by
148 mm with `viewBox="0 0 210 148"`. It covers primitives, circular and cubic
paths, text, transforms, reusable symbols, gradients, hatches, markers, and
clips. Its authored inventory is:

| Element | Count | Element | Count |
| --- | ---: | --- | ---: |
| `circle` | 2 | `ellipse` | 1 |
| `line` | 2 | `path` | 6 |
| `polygon` | 1 | `polyline` | 1 |
| `rect` | 4 | `text` | 1 |
| `use` | 2 |  |  |

The profile references `profile-arrow`, `profile-block`, `profile-clip`,
`profile-gradient`, and `profile-hatch`. Nanquim's automated import tests
require those local references to remain intact and separately verify that an
unsupported profile loses active/external content while retaining its safe
fallback geometry and producing diagnostics. The shared SVG numeric boundary
also rejects non-finite or over-contract geometry, cumulative transforms,
paths, paint extents, marker/use reference expansion, and CSS geometry before
untrusted nodes can enter the live document; safe siblings remain available
with a bounded diagnostic.

The local qualification recorded on 2026-08-21 produced these results:

| Tool | Version | Recorded result |
| --- | --- | --- |
| Inkscape | 1.4.4 | Plain-SVG export retained the exact element inventory, physical `210mm` × `148mm` size, viewBox, and all local references, with no dangling reference. All 21 renderer-query geometry bounds matched with maximum delta 0 against the `0.01` limit. |
| Blender | 5.2.0 LTS | SVG curve import returned `FINISHED` with 17 objects, 14 curves, and 14 splines. |
| LibreCAD | 2.2.1.2 | Installed, but manual qualification is still required because the application has no supported headless semantic inspection interface. |

The manifest records absolute bounds tolerance `0.01` for the external
renderer comparison. The Inkscape runner checks renderer-query bounds,
inventory, physical size, viewBox, and reference
closure. The Blender result is a first curve-import profile, not a lossless
editable round trip or direct Blender/Bonsai integration.

## DXF import profile

DXF import is staged and sanitized before it replaces the live document. The
qualified conversion recognizes `$INSUNITS` for inches, feet, millimetres,
centimetres, metres, and yards and converts geometry to Nanquim's centimetre
Model coordinate contract. Unitless or unknown unit codes remain at factor 1
and produce a diagnostic rather than an invented conversion.

After bounded `INSERT` expansion, the SVG conversion path supports `LINE`,
`CIRCLE`, `ELLIPSE`, `ARC`, `SPLINE`, `LWPOLYLINE`, and `POLYLINE`. It rejects
cyclic, too-deep, oversized-array, and over-budget insert expansion before a
live-document commit. Non-finite, negative-radius, and coordinate data outside
the native `±1,000,000,000` bound are skipped or cause a bounded, atomic
rejection before staging; malformed `INSERT` transforms reject the candidate
instead of relocating block geometry. Missing blocks, invalid numeric entities,
and unsupported entity types are reported through bounded aggregate
diagnostics. DXF text import and unlisted entities are not part of the qualified
import profile.

Layers become direct Model collections. Names are XML-escaped, colors are
retained where representable, and layer visibility/locking is preserved. The
millimetre qualification fixture converts with
`matrix(0.1,0,0,-0.1,0,0)`, produces viewBox `0 -8 9 8`, and preserves the
three layer names `A&B`, `Hidden`, and `Locked` with their expected state.

## DXF export profile

DXF export writes ASCII R2000 and declares `$INSUNITS=5` (centimetres). It
exports only direct Model collections: Paper annotations/viewports and the
temporary block-edit collection are excluded. Collection names become DXF
layers, and representable color, visibility, and locking state are encoded in
the layer table.

The current export mappings are:

| Nanquim geometry | DXF result |
| --- | --- |
| line, circle, ellipse | `LINE`, `CIRCLE`, or `ELLIPSE` |
| rectangle | closed `LWPOLYLINE`, reported as an approximation |
| polyline, polygon, straight SVG path | open/closed `LWPOLYLINE` |
| semantic arc path | `ARC` |
| semantic spline path | sampled `LWPOLYLINE`, reported as an approximation |
| text | `TEXT`; content is bounded and unsupported shear/nonuniform scale is reported as approximated |
| dimension group | ordinary component geometry/text, reported as exploded |
| supported transformed geometry | transforms baked into a detached clone when the target DXF entity remains exact; circles/arcs require a similarity transform and general ellipses require axis-aligned scaling/translation |
| unsupported SVG entity/path/affine curve transform, or invalid/out-of-range numeric geometry | skipped before entity emission with a bounded user-visible summary |

Export never mutates the live drawing. Diagnostics are aggregated by category
and bounded, and the terminal summary reports emitted, approximated, and
skipped counts. DXF remains a lossy exchange format; nested SVG semantics,
paint servers, arbitrary curves, metadata, Paper, and Geometry Nodes graphs do
not become native DXF features.

### Required LibreCAD round trip

LibreCAD 2.2.1.2 is the pinned manual target for this profile. Before Phase 3
or a beta candidate can claim DXF round-trip qualification:

1. Export a representative Nanquim drawing with known line, circle,
   rectangle, and polyline geometry plus visible, hidden, and locked layers;
   record the candidate commit and application version.
2. Open it in LibreCAD 2.2.1.2 and verify centimetre units, layer names,
   visibility/locking, colors, entity counts, and bounds.
3. Edit one supported entity, save a new ASCII R2000 file, and reopen that file
   in Nanquim.
4. Compare units, layers, supported entity counts, and bounds against the
   recorded expectations. Confirm that every degradation appears in Nanquim's
   summary.
5. Store the input/output files, screenshots, tool version, date, and pass/fail
   notes under the ignored `test-results/interoperability/` tree or in the
   candidate release record.

This checklist has not yet been completed; installing or version-querying
LibreCAD does not satisfy it.

## Performance qualification

`pnpm test:performance` provides the Phase 3 regression baseline for fixed
1,000- and 10,000-element drawings. It measures production load, canonical
save, index rebuild/query, pan, zoom, window selection, snapping, Outliner
synchronization, and Geometry Nodes evaluation using one warm-up and five
recorded samples. Both median and nearest-rank p95 must remain below explicit
budgets.

The 2026-08-21 local Chromium 151.0.7922.137 run passed every budget for both
datasets. This is reproducible evidence on the recorded Linux/AMD machine, not
a cross-browser or universal hardware guarantee. See
[Performance budgets](performance.md) for measurements, checksums, budgets,
artifact safety, and interpretation.

## Running and recording qualification

Run the repository checks with:

```bash
pnpm test -- tests/svg-interoperability.test.js \
  tests/dxf-denormalise.test.js \
  tests/dxf-export-interoperability.test.js \
  tests/paper-document-state.test.js \
  tests/paper-viewport.test.js \
  tests/export-paper-pdf.test.js
pnpm qualify:interoperability
pnpm test:performance
pnpm test:browser:chromium
pnpm test:browser:firefox
```

The external SVG command requires Inkscape and Blender on `PATH`, records their
exact installed versions, and reports LibreCAD as a manual gate. The current
profile is qualified with the versions listed above; a candidate run must not
silently substitute different versions. Small JSON/tool outputs go
below ignored `test-results/interoperability/`, and performance evidence goes
below ignored `test-results/performance/`. Purpose-built source fixtures and
their expected manifests remain under `tests/fixtures/`; generated exports,
third-party project files, and screenshots must not be placed in `public`.

Every release candidate must rerun qualification against its exact commit.
Earlier local or scheduled results do not qualify a later tree. Phase 3 remains
open until the LibreCAD manual round trip, representative external Paper
SVG/PDF review, and applicable exact-candidate browser/release gates are
recorded. Direct persistent-file-handle and Safari checks remain governed by
[Browser and file API support](browser-support.md) and the
[release process](release-process.md).
