# Asset provenance and licensing

Last reviewed: 2026-08-20

This inventory covers tracked runtime fonts, images, and browser-global vendor
files. Package-manager dependencies remain pinned by `pnpm-lock.yaml`; their
production license summary can be regenerated with:

```bash
pnpm licenses list --prod
```

License texts and notices that are not already next to vendored source live in
`third_party/licenses/`. See also the repository-level
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Font distribution decision

Nanquim uses the bundled local TTF files under `public/fonts/generated` for
both browser rendering and Paper PDF embedding. The production UI must not
depend on Google Fonts or another font CDN. This gives the browser and PDF
exporter one reproducible font source, avoids a third-party request during
ordinary use, and keeps the application usable without a network connection
after its own assets have loaded.

The directory name `generated` predates this inventory. No download lockfile or
generation script survives in repository history, so the exact upstream
download commit and static-instance generation command are unresolved. The
family, version, authorship, and OFL license below come from each font's
embedded name metadata. Do not describe the retained binaries as byte-identical
to a particular upstream release until checksums have been matched.

| Tracked paths | Embedded version and source project | Purpose | License and local state |
| --- | --- | --- | --- |
| `public/fonts/generated/Inter-*.ttf` | Inter 4.001, `git-66647c0bb`; [rsms/inter](https://github.com/rsms/inter) | UI, editable text, PDF | SIL OFL 1.1. Eight retained static files: normal and italic at 400/500/600/700. Exact download revision unresolved. |
| `public/fonts/generated/DMSans-*.ttf` | DM Sans 4.004, generated with gftools 0.9.30; [googlefonts/dm-fonts](https://github.com/googlefonts/dm-fonts) | Welcome/Help UI, editable text, PDF | SIL OFL 1.1. Six retained static files: normal and italic at 300/400/700. Exact download revision unresolved. |
| `public/fonts/generated/FiraCode-*.ttf` | Fira Code 6.002; [tonsky/FiraCode](https://github.com/tonsky/FiraCode) | Monospace UI option, editable text, PDF | SIL OFL 1.1. Normal 400/600/700 are retained. UI weights 300 and 500 intentionally resolve to the same nearest local files used by PDF export. Exact download revision unresolved. |
| `public/fonts/generated/JetBrainsMono-*.ttf` | JetBrains Mono 2.211; [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) | Terminal/Help UI, editable text, PDF | SIL OFL 1.1. Six retained static files: normal and italic at 400/500/700. Exact download revision unresolved. |

Other families exposed by the text-style UI, including Arial, Helvetica,
Times New Roman, Georgia, Courier New, Fira Mono, and Cascadia Code, are
system-font choices and are not bundled. Their browser appearance depends on
local installation, and Paper PDF export may fall back to a PDF built-in or
another available font. Only the four families listed above have bundled
browser and PDF files.

Fira Code has no retained italic file. Selecting Fira Code Italic may use a
synthetic browser oblique while PDF export falls back to the upright local TTF,
so that combination is not portable or release-qualified. Use the normal Fira
Code style when browser/PDF parity matters; family-aware style choices are
tracked with later Paper-output qualification.

The font copyright notices and OFL text are in
[`third_party/licenses/fonts`](../third_party/licenses/fonts/NOTICE.md).

## Images and icons

| Path | Purpose and provenance | License and modification status |
| --- | --- | --- |
| `public/assets/img/blender_icons.svg` | Runtime UI sprite. Its document name identifies it as a Blender 2.81 icon sheet. The original Blender icon system is credited to Andrzej Ambroż (`jendrzych`) with later Blender contributors. Added to Nanquim in commit `7e90f13`. | Blender icon material is GPL. The retained file does not embed an exact source commit or license block, so its byte-level upstream revision remains unresolved. Nanquim redistributes it under GPLv3; see the Blender icon notice. |
| `public/assets/img/nanquim-logo.svg` | Pen-nib application mark extracted from a path that is also present in the retained Blender icon sheet. Added in `61e83eb` and later cleaned in `e81a5de`. It is not the Blender trademark/logo. | Derivative of the GPL icon sheet, locally cropped and edited. Distributed under GPLv3. |
| `public/assets/img/icons/properties-element.svg` | Properties-tab icon containing paths also present in the retained Blender icon sheet. Added in `80e796d`. | Derivative of the GPL icon sheet, locally extracted and transformed. Distributed under GPLv3. |
| `public/assets/img/icons/properties-textstyles.svg` | Simple text-style tab icon created for Nanquim by Eduardo Schilling in `b36ba414`. | Project-authored; distributed under Nanquim's GPLv3 license. |
| `src/js/libs/dxf/src/util/diagram.png` | Geometry diagram retained with the tailored `dxf` 5.1.0 source snapshot; referenced by `createArcForLWPolyline.js`. | Upstream `dxf` asset, MIT. The upstream license remains at `src/js/libs/dxf/LICENSE`. |

The Blender icon provenance caveat and upstream references are recorded in
[`third_party/licenses/blender-icons/NOTICE.md`](../third_party/licenses/blender-icons/NOTICE.md).
Replacing the large sheet with project-authored icons is allowed future work,
but must preserve the existing icon names and UI meaning.

## Browser-global JavaScript

These files are copied verbatim from `public` into production and execute before
the application module. They are separate from the npm SVG.js copy used by some
ES modules.

| Path | Identified upstream version | License and local state |
| --- | --- | --- |
| `public/js/libs/signals.js` | [JS Signals](https://github.com/millermedeiros/js-signals) 1.0.0, build 268, by Miller Medeiros | MIT; carries a small Nanquim integration change. |
| `public/js/libs/svg.js/svg.js` | [SVG.js](https://github.com/svgdotjs/svg.js) 3.2.0, Wout Fierens and contributors | MIT; vendored build, with no known content patch after import. |
| `public/js/libs/svg.js/svg.panzoom.js` | [svg.panzoom.js](https://github.com/svgdotjs/svg.panzoom.js) 2.1.2 | MIT; vendored build, with no known content patch after import. Its generated header has an undefined copyright field, so this inventory and the upstream package metadata supply the attribution. |
| `public/js/libs/svg.js/svg.draw.js` and `public/js/libs/svg.js/svg.draw.js.map` | [svg.draw.js](https://github.com/svgdotjs/svg.draw.js) 3.0.0 | MIT; locally patched, so do not replace from npm without interaction regression tests. The source map follows the same license. |
| `public/js/libs/svg.js/svg.select.js` | [svg.select.js](https://github.com/svgdotjs/svg.select.js) 3.0.1 | MIT; locally patched, so do not replace from npm without interaction regression tests. |

The bundled headers retain project/version attribution. The common MIT text is
at [`third_party/licenses/MIT.txt`](../third_party/licenses/MIT.txt).

## Dependency license snapshot

At this review, `pnpm licenses list --prod --json` reports 30 MIT packages, one
`(MPL-2.0 OR Apache-2.0)` package (`dompurify`), one `(MIT AND Zlib)` package
(`pako`), and one ISC package (`quickselect`). This is an observation of the
current lockfile, not a manually maintained substitute for a release-time
license scan.

## Adding or replacing assets

For every new tracked visual, font, fixture, or vendored browser file, record:

- its exact source URL and upstream version or commit;
- author/copyright attribution and SPDX license identifier;
- whether Nanquim modified or generated it;
- the reason it must ship at runtime; and
- any required license or notice text.

Do not add an asset with an unknown or incompatible license. Do not infer that a
generated-looking file is disposable without first auditing its runtime use.
