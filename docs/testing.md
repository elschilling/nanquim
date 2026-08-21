# Testing and coverage

Nanquim uses Vitest for deterministic unit and DOM tests and a separate
real-browser workflow harness for behavior that jsdom cannot prove. Run the
fast suite before the production build, then select the browser workflow that
matches the change:

```bash
pnpm test
pnpm test -- tests/<name>.test.js
pnpm test:coverage
pnpm test:browser:chromium
pnpm test:browser:firefox
pnpm qualify:interoperability
pnpm test:performance
```

Coverage uses Vitest's V8 provider. It includes all application JavaScript
under `src/js` so an untested module cannot disappear from the denominator.
Vendored source under `src/js/libs`, public browser libraries, generated build
output, coverage output, and browser-harness scripts are excluded. HTML and
machine-readable summary reports are written to the ignored `coverage`
directory.

## Coverage baseline and ratchet

The first Phase 2 report was recorded on 2026-08-21 with Node.js 22.22.2,
Vitest 4.1.11, and the V8 provider 4.1.11. Before the command lifecycle
contracts landed, all 348 tests across 38 files passed. The same-day Phase 2
ratchet report first passed all 437 tests across 43 files. The settled Phase
2+3 coverage report recorded on 2026-08-21 passes all 771 tests across 70
files.

| Metric | Initial result | Recorded covered / total | Ratcheted floor |
| --- | ---: | ---: | ---: |
| Statements | 34.32% | 15,741 / 26,064 (60.39%) | 60% |
| Branches | 35.19% | 8,374 / 15,988 (52.37%) | 52% |
| Functions | 43.04% | 2,565 / 3,696 (69.39%) | 69% |
| Lines | 35.37% | 14,521 / 23,119 (62.80%) | 62% |

The global floors began at the rounded-down initial baseline and the current
values record the settled Phase 2+3 upward ratchet. They prevent regression
while command lifecycle work raises the low legacy areas. The thresholds are
a one-way, reviewed ratchet: after a complete report improves a metric, round
its repeatable result down and raise the matching floor in `vite.config.js`
with the tests that earned it. Never lower a threshold merely to make a change
pass; add coverage or document and review an explicit exception. Automatic
threshold rewriting is intentionally disabled because it cannot safely infer
the minimum result required by exact one-file threshold entries.

The standalone modules introduced for Phase 2 report the following per-file
results in that same run:

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `CompositeCommand.js` | 85.71% | 93.54% | 100% | 85.07% |
| `EditRectangleCommand.js` | 100% | 100% | 100% | 100% |
| `TrimTransaction.js` | 90.90% | 88.88% | 90.90% | 91.54% |
| `VertexEditTransaction.js` | 100% | 100% | 100% | 100% |
| `geometryTransformQualification.js` | 92.85% | 87.50% | 100% | 100% |
| `hatchTransformQualification.js` | 83.58% | 80.39% | 96.15% | 88.98% |
| `invalidateSpatialIndexes.js` | 100% | 100% | 100% | 100% |
| `vertexCoordinateSpace.js` | 100% | 88.46% | 100% | 100% |

The standalone Phase 3 SVG numeric boundary is also protected by an exact
one-file floor derived from this complete report:

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `svgNumericBounds.js` | 85.16% | 76.60% | 97.26% | 93.15% |

Per-file floors protect the newer document boundary, visual-identity modules,
core state utilities, and sanitizer/geometry utilities at substantially higher
levels. Every protected module uses an exact one-file threshold entry; a broad
glob cannot let a fully covered helper hide regression in a neighboring file.
Phase 2 locks each standalone transaction module at no less than 85%
statements, 88% branches, 90% functions, and 85% lines, and each new
transform/index/coordinate utility at no less than 92% statements, 87%
branches, 100% functions, and 100% lines. The transform-aware HATCH
qualification boundary has its own 83% statements, 80% branches, 96%
functions, and 88% lines floor. The Phase 3 SVG numeric boundary has an 85%
statements, 76% branches, 97% functions, and 93% lines floor.

New standalone state-boundary, transaction, or geometry modules should receive
an exact one-file threshold entry with at least 80% statements, 70% branches,
80% functions, and 80% lines, or a stricter floor justified by their first
complete report. Changes inside large legacy-coupled command and editor modules
remain guarded by the global ratchet and focused semantic regression tests until
those surfaces can meet the standalone policy without excluding meaningful
code.

## Deterministic fixture harness

Reusable fixtures live in `tests/support/deterministic-harness.js` and are for
tests only. The primary entry point is `createDeterministicEditorFixture()`. It
uses real SVG.js elements and supplies stable command state, model and Paper
SVG roots, a collection, terminal hooks, History, lazy signals, spatial-index
spies, style managers, and a minimal draw-plugin shim. Tests remain responsible
for calling `fixture.dispose()`.

Additional helpers provide:

- js-signals-compatible `createSignalHarness()` bindings and listener counts;
- deterministic Clipboard and File System Access API substitutes;
- fake timers and animation frames without wall-clock sleeps;
- DOM listener accounting, including capture, one-shot, and aborted listeners;
- `snapshotInteractionState()` and `expectNoInteractionLeaks()` assertions for
  listeners, subscriptions, timers, transient SVG helpers, and editor flags.

Capture the interaction baseline after installing the trackers and before
starting a command. Complete or cancel the command, flush only the timers that
belong to it, and compare against the baseline. This makes repeated
start/cancel checks sensitive to cumulative leaks rather than only visible
geometry.

## File-interoperability qualification

Purpose-built SVG and DXF fixtures live under `tests/fixtures/`, outside
`public`. Focused Vitest suites protect the authored SVG inventory, sanitizer
degradation, DXF unit/layer conversion, bounded `INSERT` expansion, DXF export
mappings/diagnostics, Paper physical sizes and scale, reference closure, and
vector SVG/PDF output.

The settled local production harness also passes all nine workflows in both
Chromium 151.0.7922.137 and Firefox 153.0.3. Its exchange checks cover
sanitized foreign SVG import, centimetre/layer-aware DXF import and re-export,
and intercepted vector Paper SVG/PDF downloads with physical page size,
reference closure, no raster image fallback, and a nonempty embedded font.
These results do not replace the direct persistent-handle, external-renderer,
Safari, or exact-release-candidate records.

`pnpm qualify:interoperability` then runs the standalone SVG profile through
locally installed external tools. The 2026-08-21 record used Inkscape 1.4.4
and Blender 5.2.0 LTS. Inkscape retained the exact physical size, viewBox,
entity inventory, local references, and all 21 queried geometry bounds with
maximum delta 0 against the `0.01` limit. Blender imported 17 objects, 14
curves, and 14 splines. LibreCAD 2.2.1.2 remains a manual-required gate; a
version query is not a DXF round-trip result.

The command writes small ignored evidence below
`test-results/interoperability/local-profile/`. It requires Inkscape and
Blender on `PATH`, records their exact versions and the installed LibreCAD
package version, and exits non-zero when an automated profile check fails.
Candidate qualification must use the pinned profile versions and preserve the
exact source commit, versions, date, and result; an earlier local artifact does
not qualify a later change. See
[File interoperability and Paper output](file-interoperability.md) for format
scope, conversions, tolerances, and the manual LibreCAD checklist.

## Production-browser performance budgets

`pnpm test:performance` builds the application and measures the fixed 1,000-
and 10,000-element drawings through real production load/save, spatial-index,
viewport, snapping, Outliner, and Geometry Nodes paths. It records five samples
after one warm-up, checks both median and nearest-rank p95 against tolerant
explicit budgets, and writes ignored JSON evidence below
`test-results/performance/chromium/`.

The generator never writes its SVG drawings to disk or production output.
Methodology, current budgets, diagnostic options, artifact safety, and result
interpretation are documented in [Performance budgets](performance.md).
