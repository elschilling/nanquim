# AGENTS.md

This file applies to the entire repository. It is operational guidance for
coding agents and contributors working on Nanquim.

## Project direction

Nanquim is a browser-based 2D CAD editor whose editable document model is SVG.
The current priority is a reliable `v0.1` public beta, not a larger command
count. For self-directed roadmap work, use this order; an explicit user task
still defines the active scope:

1. Prevent data loss, unsafe imports, and cross-document state leaks.
2. Preserve geometric, command, Undo/Redo, and export correctness.
3. Add regression and real-browser coverage for existing workflows.
4. Qualify Paper Space, SVG, DXF, and PDF interoperability.
5. Improve onboarding, accessibility, and documentation.
6. Add new features only after the protected workflow is stable.

Prefer FOSS and locally reproducible tooling. Do not introduce a paid or
cloud-only requirement for ordinary development, testing, or documentation.

The active roadmap is
[`plans/v0.1-public-beta-plan.md`](plans/v0.1-public-beta-plan.md).
Superseded roadmap drafts were consolidated there and remain recoverable from
Git history. `CLAUDE.md` points Claude tooling to these shared instructions.
Source, tests, `package.json`, and CI remain authoritative when documentation
disagrees with the implementation.

Product status and qualification live in
[`docs/capabilities.md`](docs/capabilities.md), browser and file-API support in
[`docs/browser-support.md`](docs/browser-support.md), and release operations in
[`docs/release-process.md`](docs/release-process.md). Do not promote a partial
or experimental area to stable in one document without updating its evidence
and the other user-facing references in the same change.

## Current stack and commands

- Node.js `22.22.2` and pnpm `8.15.5` are pinned.
- Use pnpm, not npm or yarn.
- The application uses vanilla JavaScript ES modules, direct DOM manipulation,
  Pug, indented Sass, SVG.js, Vite 6, and Vitest.
- There is no configured linter, formatter, or type-check command. Vitest uses
  the V8 coverage provider, and the production browser harness uses
  `puppeteer-core` with locally installed stock Chromium or Firefox.

Common commands:

```bash
pnpm install
pnpm dev
pnpm test
pnpm test -- tests/<name>.test.js
pnpm test:coverage
pnpm test:browser:chromium
pnpm test:browser:firefox
pnpm test:performance
pnpm test:watch
pnpm build
pnpm preview
```

CI also uses `pnpm install --frozen-lockfile` and
`pnpm audit --audit-level high`.

## Repository map

- `src/main.js`: composition root.
- `src/js/Editor.js`: shared state, signals, collections, modes, history, and
  spatial indexes.
- `src/js/Viewport.js`: pointer interaction, selection, snapping, helpers, and
  viewport rendering.
- `src/js/Terminal.js`: command resolution, prompts, aliases, and typed input.
- `src/js/Command.js`: canonical base class for new commands.
- `src/js/commands/_commands.js`: canonical user-facing command registry.
- `src/js/History.js`: Undo/Redo execution.
- `src/js/Collection.js`: collection state and inherited element styles.
- `src/js/SpatialIndex.js`: selectable/full drawing indexes.
- `src/js/DocumentController.js`: New/Open/Save/Save As, dirty-state guards,
  browser file capabilities, and download fallbacks.
- `src/js/document/DocumentSerializer.js`: canonical native schema writer.
- `src/js/document/DocumentParser.js`: bounded parsing, schema policy, and
  detached candidates.
- `src/js/document/DocumentState.js`: session identity and dirty/save tokens.
- `src/js/Navbar.js`: thin UI bindings for document and export actions.
- `src/js/utils/DXFloader.js`: staged SVG/DXF hydration and transactional
  session replacement.
- `src/js/PaperEditor.js`, `src/js/PaperViewport.js`, and
  `src/js/utils/ExportPaper.js`: Paper Space and output.
- `src/js/geometry-nodes/`: Geometry Nodes model, evaluation, persistence, and
  SVG adaptation.
- `src/js/CommandIllustrations.js` and `src/js/HelpSession.js`: Help content and
  decorative command diagrams.
- `src/js/ToolPalette.js` and `src/js/CommandIcons.js`: registry-driven command
  palette behavior and its project-authored icon metadata.
- `src/js/ThemeController.js`, `src/js/Preferences.js`, and
  `src/js/PreferencesUI.js`: local appearance/interaction preferences and
  theme application.
- `tests/support/deterministic-harness.js`: shared Editor, SVG, signal, timer,
  listener, clipboard, and file-API fixtures for command contracts.
- `scripts/browser/run-workflows.mjs`: isolated production-build workflows for
  Chromium and Firefox; failure artifacts go under ignored `test-results/`.
- `src/styles/main.sass`: active style entry point.
- `src/styles/_identity.sass` and `src/styles/components/_icon.sass`: Nanquim's
  semantic visual layer and original icon mappings.
- `tests/`: all automated tests.
- `public/`: files copied verbatim into production.
- `dist/`: generated and ignored; never hand-edit or commit it.

## Working rules

### Scope and existing work

- Inspect `git status` before editing and preserve unrelated user changes.
- Keep changes focused on the requested behavior. Do not combine a feature,
  broad cleanup, and architectural rewrite without explicit scope.
- Search with `rg`/`rg --files` and read the relevant implementation and tests
  before changing behavior.
- Add characterization tests before modifying fragile legacy paths.
- Do not commit or push unless the user explicitly asks.
- Never commit `node_modules`, `dist`, recordings, generated exports, browser
  traces, local settings, or scratch files.
- Do not hand-edit `pnpm-lock.yaml`; update it through pnpm when dependency
  changes are authorized.

### Code style

- Follow surrounding indentation; newer application modules generally use two
  spaces, single quotes, and no semicolons.
- Use `const` by default and `let` only for reassignment.
- Keep imports and file naming consistent with neighboring modules; do not do a
  repository-wide style normalization as part of a functional change.
- Prefer small pure geometry/state helpers over adding more branches to large
  event-heavy classes.
- Do not rewrite `Viewport`, `Properties`, `Outliner`, `TrimCommand`, or Geometry
  Nodes modules wholesale without characterization tests and an explicit plan.
- Avoid new globals. Existing `window.*` entry points are integration debt, not
  a pattern to expand casually.

## Core invariants

### SVG and editor structure

- Persistent model geometry belongs below `editor.drawing`.
- `Overlays`, `Snap`, and `Handlers` are transient UI groups and must never be
  serialized as drawing content.
- Model/Paper is selected by `editor.mode`. Geometry Nodes is an editor surface
  selected through `editor.activeEditor`, not a third document mode.
- For interaction against the active SVG, account explicitly for Model versus
  Paper Space.
- Preserve semantic SVG elements, metadata, IDs, and internal references. Do
  not replace editable vectors with flattened pixels unless the operation is an
  explicit export.
- Keep previews and helpers outside persistent drawing content and exclude them
  from selection and snapping while active. Use a transient root/overlay and
  `pointer-events="none"` where appropriate, then remove them on every exit.

### Collections and styles

- New draw-command geometry goes to `editor.activeCollection`. The canonical
  Command base exposes the destination lazily through `command.drawing` so
  collection changes during a command are respected. Modification commands
  normally preserve source ownership unless their documented semantics choose
  another destination.
- Use `applyCollectionStyleToElement` for new geometry and previews where the
  command is expected to represent the current collection style.
- Do not introduce hardcoded blue dashed command previews. Follow the current
  collection/helper convention and existing global style variables unless a
  distinct UI overlay such as snapping genuinely requires another semantic
  style.
- Preserve collection visibility, locking, inheritance, groups, blocks, and
  Geometry Nodes wrapper/source semantics. Do not infer them from raw descendant
  scans when Collection helpers already encode the rules.

### Spatial indexes and signals

- Geometry changes that affect bounds must invalidate both
  `editor.spatialIndex` and `editor.fullSpatialIndex` unless the code can prove
  only one index is affected.
- Dispatch the narrow signals required by the change, such as
  `updatedOutliner`, `updatedSelection`, `updatedProperties`,
  `modelContentChanged`, or the relevant Paper/Geometry Nodes signal.
- Do not fix stale UI by dispatching every signal indiscriminately.

## Command implementation rules

The command registry in `src/js/commands/_commands.js` is the user-facing source
of truth.

For a new or materially changed command:

1. Use an uppercase canonical registry key.
2. Provide globally unique lowercase aliases, a valid category, and a concise
   description.
3. Keep the toolbar, terminal, keyboard, and repeat-last-command entry paths a
   command exposes behaviorally equivalent.
4. Use `resolveInputCoordinate` for coordinate input. `@x,y` is relative and
   `#x,y` is absolute.
5. Set terminal prompt `recordInput: true` when a typed value must remain
   visible in the terminal transcript.
6. Put created geometry in the active destination with the expected inherited
   style.
7. Make every exit path—success, invalid input, error, or Escape—remove exact
   signal/DOM/SVG listeners, stop ghosting, delete helpers, and reset interaction
   flags such as `isDrawing`, `isInteracting`, `selectSingleElement`, temporary
   handler suppression, and stored input state.
8. Prefer `editor.execute(command)` for new mutations. Direct writes to
   `history.undos`/`history.redos` are legacy debt and must not be copied. At
   commit time, structure the mutation command so `execute()` performs the
   document change exactly once; do not pre-insert geometry and then execute a
   command that inserts it again. Do not call `editor.execute()` merely to start
   an interactive session; enter history only when a completed mutation can
   execute and undo deterministically.
9. Undo/Redo must restore semantic metadata as well as visible geometry and
   must restore the affected index and UI state while dispatching only the
   relevant signals.
10. Update Help metadata, `CommandIllustrations.js`, registry-completeness
    tests, README/reference documentation, and tutorial impact where relevant.

Generated Geometry Nodes leaves are not ordinary destructive-edit targets.
Operate on the modifier wrapper or use Apply according to existing ownership
rules.

## Document, import, and security rules

Treat SVG, DXF, clipboard content, document metadata, CSS, and Geometry Nodes
payloads as untrusted.

Persistence is centralized through `DocumentController`,
`DocumentSerializer`, `DocumentParser`, and the staged `DXFloader` commit. A
persisted field is incomplete unless serialization, parsing, migration,
loading, validation, and round-trip tests are updated together. Do not add a
second save path to Navbar or another UI module.

- Reuse `sanitizeSvgDocument`, `parseSafeJson`, ID/reference remapping, CSS
  scoping, and existing length/depth/node-count limits.
- Validate and sanitize a complete candidate before mutating live editor state.
  Rejected input must leave the current drawing unchanged.
- Detached/inert parsing with `DOMParser` is allowed for inspection and
  sanitization. Never attach or import raw user-controlled nodes into the live
  application DOM through `innerHTML`, SVG.js `.svg()`, or equivalent APIs
  before sanitization, and never relax a sanitizer allowlist/budget without
  adversarial tests.
- A marker claiming that a file is a Nanquim document does not make its content
  trusted.
- Preserve safe imported definitions such as gradients, patterns, clip paths,
  masks, markers, symbols, and styles through save/reopen.
- Bound numeric values and metadata recursion before allocating or mutating the
  live document.
- Report user-relevant skipped, degraded, recovered, or unsupported entities;
  do not silently discard document content. Low-level removal of hostile input
  need not echo attacker-controlled details.
- Preserve capability checks and upload/download fallbacks for File System
  Access and Clipboard APIs. Secure context, permission, and persistent handles
  cannot be assumed; `AbortError` cancellation is normal, and a fallback must
  never overwrite the wrong file.
- Mark a native session clean only after a writable handle closes successfully.
  An anchor-triggered download has no completion signal, so it remains
  unverified, keeps the session dirty, and must not adopt a file association.

Any document-format change requires tests for:

- Current-schema save/reopen.
- Supported historical fixtures and migration behavior.
- Future/unknown schema policy.
- Corrupt and hostile metadata.
- Collections, styles, blocks, Paper annotations/viewports, imported defs, and
  Geometry Nodes when affected.
- ID uniqueness and internal-reference validity.
- Context-correct XML escaping and round trips for `&`, `<`, `>`, `"`, and `'`
  in text, collection/style names, block names, and metadata.
- New/Open reset of history and transient interaction state.

The application version, root document schema, and Geometry Nodes schema are
separate version domains. Never advance one as an accidental side effect of
another.

## SVG.js and vendored code

The current runtime mixes a vendored browser-global SVG.js 3.2.0/plugin stack
with npm `@svgdotjs/svg.js` 3.2.5 imports.

- Do not assume global and imported SVG.js instances or class registries are
  interchangeable.
- Do not remove or reorder vendor scripts without real-browser tests for draw,
  select, pan/zoom, transforms, paste, and Geometry Nodes.
- In jsdom tests, use `registerWindow(window, document)` and define
  `globalThis.SVG` only when the implementation actually expects the global.
- `public/js/libs` is vendored. Avoid hand-editing it unless the task explicitly
  targets the vendor integration.
- Runtime DXF imports use the tailored source snapshot in
  `src/js/libs/dxf/src`. Do not recreate a compiled `lib` tree, examples, or a
  CLI unless the project intentionally reintroduces and tests that distribution
  surface.

## UI, Sass, and accessibility

- Use indented Sass in `src/styles`; do not edit generated CSS in `dist`.
- Use the Sass module system (`@use`) and keep CSS-emitting modules in the
  deliberate cascade order established by `src/styles/main.sass`. Do not
  reintroduce `@import`; load built-in modules such as `sass:list` explicitly
  and call their functions through the module namespace.
- Avoid inline `//` comments after CSS declarations because they can leak into
  invalid generated CSS.
- Appearance is local UI state managed by `ThemeController`, `Preferences`, and
  `PreferencesUI`; it must not enter native documents or dirty `DocumentState`.
- Use the semantic tokens in `_variables.sass` and the final identity layer in
  `_identity.sass` for surfaces, text, borders, canvas, focus, and state colors.
  Test both dark and light custom backgrounds; do not reintroduce component-wide
  hardcoded gray palettes.
- Runtime icons come from the project-authored
  `public/assets/img/nanquim-icons.svg` and
  `public/assets/img/nanquim-command-icons.svg` mask sheets. Preserve
  `currentColor`, the 24-pixel construction grid, existing accessible labels,
  and icon/registry completeness coverage. Do not copy or extract glyphs from
  another application's icon artwork.
- Use existing variables for strokes, spacing, and zoom-independent UI geometry
  when they express the intended semantics.
- Test browser-visible helpers by computed appearance, not only DOM existence.
- Prefer semantic controls (`button`, inputs, labels) over clickable `div`
  elements. Preserve keyboard access, visible focus, focus restoration, and
  Escape behavior in dialogs.
- Decorative Help SVGs remain `aria-hidden` and unfocusable; visible text must
  carry the explanation.
- Check narrow and normal desktop layouts for Help or modal changes. Do not
  claim touch/mobile CAD support unless the interaction itself is qualified.

## Testing rules

- Automated tests belong under `tests/**/*.test.js`.
- Put reusable files in `tests/fixtures`, not the repository root or `public`.
- DOM suites start with `// @vitest-environment jsdom` when needed.
- Reset the DOM, globals, fake timers, signals, and mocks in hooks so tests
  remain order-independent. Call `registerWindow` for the current jsdom document
  where SVG.js is used.
- Prefer semantic SVG/state assertions over brittle serialized-whitespace or
  screenshot-only assertions.
- Test success, invalid input, cancellation, Undo/Redo, and cleanup for
  interactive commands.
- jsdom cannot prove paint visibility, pointer capture, browser file APIs,
  downloads, or layout. Perform a real-browser check for those changes until
  they are covered by an automated browser suite.
- Do not invent lint, type-check, Playwright, or another validation command in
  a handoff. Use only scripts that currently exist in `package.json`.

Validation by change type:

| Change | Minimum validation |
| --- | --- |
| Pure utility or state logic | Focused Vitest suite, then `pnpm test` |
| Command behavior | Focused lifecycle tests, full suite, and relevant Undo/Redo checks |
| UI/Sass/helper rendering | Focused tests, `pnpm test`, `pnpm build`, and real-browser desktop/narrow check |
| Persistence/import/export | Adversarial and semantic round-trip tests, full suite, build, and representative fixture check |
| Geometry or spatial behavior | Unit cases across supported element types/transforms plus full suite |
| Package/build/CI | Frozen install assumptions, coverage suite, build, browser workflow where affected, and dependency audit when network is available |
| Documentation only | Link/path review, consistency with source, and `git diff --check` |

## Public assets and performance

- Vite copies `public` verbatim. Do not place tests, backups, generated PDFs,
  recordings, or large source projects there.
- Keep only intentional runtime/download assets in `public`, with recorded
  provenance and licenses.
- The former `public/tests` scratch tree was removed after a reference audit.
  Do not recreate it; put purpose-built, licensed fixtures under
  `tests/fixtures` and exercise them with automated tests.
- Do not delete `public/fonts/generated` merely because of its name; the UI and
  Paper PDF export use those tracked runtime fonts. Audit references before
  removing any generated-looking public asset.
- Avoid synchronous full-document scans in pointer-move, snapping, selection,
  Outliner, or Geometry Nodes hot paths. Use the spatial indexes and bounded
  work where available.
- Do not claim a performance improvement without a representative fixture and
  before/after measurement.

## Documentation and roadmap discipline

- README is the product landing page; detailed workflows should live in future
  `docs/` guides rather than making README unbounded.
- Derive or validate command reference material from the command registry to
  avoid alias/category drift.
- Clearly label partial or experimental support, especially Geometry Nodes and
  file-format edge cases.
- Update the active roadmap when a milestone decision, dependency, or release
  gate materially changes.
- Do not mark a roadmap gate complete without an automated result or recorded
  manual fixture check.

## Releases and Git

- `master` is the canonical branch. GitHub's default branch, CI, and production
  deployments use it. A clone whose local `origin/HEAD` still advertises `dev`
  has stale remote metadata; refresh it rather than treating `dev` as the
  release branch.
- Follow [`docs/release-process.md`](docs/release-process.md) for validation,
  tagging, deployment verification, and rollback. Repository documentation
  does not replace the required GitHub branch rules or Vercel project setting.
- A release-version change must keep package metadata, visible application
  version, lockfile, changelog, tag, and release notes consistent.
- A release-version change must not implicitly bump the native SVG or Geometry
  Nodes schema.
- Inspect status and the staged diff before committing. Keep commits focused and
  use concise imperative messages.
- Do not commit, push, tag, publish, or deploy unless the user explicitly asks.

## Definition of done

Before handing off a change:

- The requested behavior is implemented without unrelated edits.
- Relevant focused tests pass, followed by the appropriate full validation from
  the table above.
- `git diff --check` passes.
- The worktree contains no accidental generated or scratch files.
- New warnings are resolved or explicitly identified.
- Persistence, Undo/Redo, cancellation, active collection/style, indexes,
  sanitization, accessibility, Help, and documentation impacts have been
  considered where applicable.
- The handoff states what changed, what was verified, known limitations, and
  whether anything remains uncommitted.
