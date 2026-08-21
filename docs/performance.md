# Performance budgets

Nanquim has a reproducible production-browser benchmark for the Phase 3
performance baseline. It generates fixed 1,000- and 10,000-element native SVG
drawings in memory, runs the application from `dist`, and writes bounded JSON
evidence without storing the generated drawings.

Run the complete Chromium budget gate with:

```bash
pnpm test:performance
```

The command builds the production application, uses an installed stock
Chromium, and exits non-zero when a median or p95 budget is exceeded. As with
the browser qualification harness, set `NANQUIM_PERFORMANCE_EXECUTABLE` when
the browser is not at a standard system path. A diagnostic subset can be run
after `pnpm build`:

```bash
node scripts/performance/run-benchmarks.mjs --sizes=1000 --samples=3 --report-only
```

`--sizes` accepts only `1000`, `10000`, or both comma-separated. The default is
one warm-up followed by five recorded samples. Three is the minimum recorded
sample count; `--report-only` records regressions without making them the
process exit status. The full two-size, five-sample command is the release
evidence; a diagnostic subset is not a replacement for it.

## Dataset and measurements

The deterministic generator uses a regular grid and cycles through lines,
rectangles, circles, and polylines. IDs, geometry, collection state, viewBox,
source bytes, and FNV-1a checksum are stable. The two sources are currently
about 50 KiB and 510 KiB, remain below Nanquim's document limits, and are
passed directly to the page rather than written to the repository or copied to
`public`/`dist`.

Each dataset measures these production paths:

- native SVG preparation, staged load, commit, Outliner synchronization, and a
  browser frame;
- canonical native serialization through `DocumentController`;
- selectable R-tree rebuild and a deterministic batch of 250 spatial queries;
- trusted middle-button pan, wheel zoom, and left-button window-selection
  gestures through `Viewport`;
- an object snap from a real pointer move and the production snap/index path;
- explicit Outliner signal/render synchronization and a browser frame;
- evaluation and SVG output rendering of a live default Geometry Nodes
  modifier attached to a fixture line.

Every metric records its raw samples, median, nearest-rank p95, explicit
budget, pass/fail result, and a small semantic detail such as indexed element
count. Fixture SVG and page contents are never included in the report.

## Initial tolerant budgets

The budgets are regression tripwires in milliseconds, not optimization
targets. They deliberately tolerate stock headless browsers on shared
developer and CI machines. Tighten them only after repeated full evidence on
representative machines; do not loosen them to hide a regression.

| Metric | 1,000 median / p95 | 10,000 median / p95 |
| --- | ---: | ---: |
| Load | 2,500 / 5,000 | 15,000 / 30,000 |
| Canonical save | 1,200 / 2,500 | 7,000 / 15,000 |
| Spatial-index rebuild | 1,200 / 2,500 | 8,000 / 18,000 |
| Spatial-index query batch | 100 / 300 | 500 / 1,500 |
| Pan | 500 / 1,200 | 1,500 / 4,000 |
| Zoom | 500 / 1,200 | 1,500 / 4,000 |
| Window selection | 1,800 / 4,000 | 7,000 / 18,000 |
| Snap | 700 / 1,800 | 2,500 / 7,000 |
| Outliner sync | 1,800 / 4,000 | 10,000 / 25,000 |
| Geometry Nodes evaluation | 1,800 / 4,000 | 10,000 / 25,000 |

The authoritative values live in
`scripts/performance/config.mjs`; this table must change with that file.

## Recorded local baseline

The complete run recorded on 2026-08-21 passed every budget. It used Node.js
22.22.2 and stock Chromium 151.0.7922.137 at 1440 × 900 on Linux
7.1.8-200.fc44.x86_64, with an AMD Ryzen 7 1800X (8 logical CPUs) and 32 GB of
memory. The 1,000-element checksum was `fnv1a-e81dcdcc`; the 10,000-element
checksum was `fnv1a-f55245f4`.

The values below are median / nearest-rank p95 in milliseconds from one warm-up
and five recorded samples:

| Metric | 1,000 measured | 10,000 measured |
| --- | ---: | ---: |
| Load | 70.8 / 79.0 | 563.6 / 615.4 |
| Canonical save | 137.2 / 138.1 | 1,470.4 / 1,506.7 |
| Spatial-index rebuild | 8.0 / 11.7 | 68.0 / 73.3 |
| Spatial-index query batch | 0.3 / 0.4 | 0.3 / 0.5 |
| Pan | 77.8 / 79.0 | 113.2 / 149.8 |
| Zoom | 69.7 / 79.8 | 48.4 / 54.0 |
| Window selection | 85.5 / 87.1 | 187.6 / 267.0 |
| Snap | 44.9 / 46.8 | 37.1 / 40.4 |
| Outliner sync | 199.0 / 202.1 | 1,944.7 / 2,151.1 |
| Geometry Nodes evaluation | 12.5 / 12.9 | 12.9 / 13.2 |

These timings qualify that exact local environment and dataset. They are not a
portable speed promise, and a later candidate or performance claim must record
a new comparable run rather than copying this result.

## Evidence and interpretation

The runner writes `test-results/performance/<browser>/summary.json`. The whole
`test-results` tree is ignored, and path guards require a strict child of the
performance artifact root before cleanup. Temporary browser profiles use a
dedicated `nanquim-browser-*` directory outside the repository and are removed
after the run. A failed run retains only small diagnostics and, when possible,
a screenshot.

Compare results only when browser version, viewport, CPU, operating system,
sample count, and dataset checksum are compatible. Headless timing does not
prove touch performance, GPU paint throughput, or every imported document
shape. The benchmark makes regressions measurable; a performance-improvement
claim still needs before/after evidence from the same representative setup.
