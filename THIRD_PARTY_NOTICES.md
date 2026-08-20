# Third-party notices

Nanquim is distributed under the GNU General Public License v3.0. The following
third-party works retain their own copyright notices and licenses.

## Bundled fonts

The TTF files in `public/fonts/generated` are licensed under the SIL Open Font
License, Version 1.1:

- Inter 4.001: Copyright 2016 The Inter Project Authors
  (<https://github.com/rsms/inter>).
- DM Sans 4.004: Copyright 2014 The DM Sans Project Authors
  (<https://github.com/googlefonts/dm-fonts>).
- Fira Code 6.002: Copyright 2014-2021 The Fira Code Project Authors
  (<https://github.com/tonsky/FiraCode>).
- JetBrains Mono 2.211: Copyright 2020 The JetBrains Mono Project Authors
  (<https://github.com/JetBrains/JetBrainsMono>).

The copyright statements above and the exact version strings are also embedded
in the font binaries. See
[`third_party/licenses/fonts/NOTICE.md`](third_party/licenses/fonts/NOTICE.md)
and the [SIL OFL 1.1 text](third_party/licenses/fonts/OFL-1.1.txt).

## Blender-derived UI icons

`public/assets/img/blender_icons.svg` is a Blender 2.81-era icon sheet credited
primarily to Andrzej Ambroż (`jendrzych`) and later Blender contributors.
`nanquim-logo.svg` and `properties-element.svg` contain locally extracted paths
from that sheet. Blender's individual UI icons are GPL material. Nanquim
distributes these derivatives under GPLv3; the repository's [`LICENSE`](LICENSE)
contains the applicable license text.

The retained sheet does not identify its exact upstream source commit. See the
[Blender icon notice](third_party/licenses/blender-icons/NOTICE.md) and the
[asset provenance inventory](docs/asset-provenance.md) before updating it.

## Vendored browser libraries

- JS Signals 1.0.0 build 268, Miller Medeiros — MIT.
- SVG.js 3.2.0, Wout Fierens and contributors — MIT.
- svg.panzoom.js 2.1.2, Ulrich-Matthias Schäfer and contributors — MIT.
- svg.draw.js 3.0.0, Ulrich-Matthias Schäfer and contributors — MIT.
- svg.select.js 3.0.1, Ulrich-Matthias Schäfer and contributors — MIT.

The distributed files retain their upstream headers. Nanquim carries local
integration changes in JS Signals, svg.draw.js, and svg.select.js. See the
[MIT license text](third_party/licenses/MIT.txt).

## Vendored DXF parser

The tailored source under `src/js/libs/dxf/src`, including its geometry diagram,
is based on `dxf` 5.1.0 by Ben Nortier and is licensed under MIT. Its copyright
notice and license are retained in [`src/js/libs/dxf/LICENSE`](src/js/libs/dxf/LICENSE).

## Package-manager dependencies

JavaScript dependencies and their transitive licenses are defined by
`package.json` and `pnpm-lock.yaml`. Generate the release-time inventory with:

```bash
pnpm licenses list --prod
```

The current asset-oriented provenance record is in
[`docs/asset-provenance.md`](docs/asset-provenance.md).
