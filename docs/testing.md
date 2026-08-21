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
ratchet report first passed all 437 tests across 43 files. The integrated Phase
2 report now passes all 659 tests across 62 files.

| Metric | Initial result | Current covered / total | Ratcheted floor |
| --- | ---: | ---: | ---: |
| Statements | 34.32% | 13,624 / 24,248 (56.18%) | 56% |
| Branches | 35.19% | 6,970 / 14,429 (48.30%) | 48% |
| Functions | 43.04% | 2,330 / 3,507 (66.43%) | 66% |
| Lines | 35.37% | 12,612 / 21,588 (58.42%) | 58% |

The global floors began at the rounded-down initial baseline and the current
values record the first upward ratchet. They prevent regression while command
lifecycle work raises the low legacy areas. The thresholds are a one-way,
reviewed ratchet: after a complete report improves a metric, round its
repeatable result down and raise the matching floor in `vite.config.js` with
the tests that earned it. Never lower a threshold merely to make a change pass;
add coverage or document and review an explicit exception. Automatic threshold
rewriting is intentionally disabled because it cannot safely infer the minimum
result required by exact one-file threshold entries.

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

Per-file floors protect the newer document boundary, visual-identity modules,
core state utilities, and sanitizer/geometry utilities at substantially higher
levels. Every protected module uses an exact one-file threshold entry; a broad
glob cannot let a fully covered helper hide regression in a neighboring file.
Phase 2 locks each standalone transaction module at no less than 85%
statements, 88% branches, 90% functions, and 85% lines, and each new
transform/index/coordinate utility at no less than 92% statements, 87%
branches, 100% functions, and 100% lines. The transform-aware HATCH
qualification boundary has its own 83% statements, 80% branches, 96%
functions, and 88% lines floor.

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
