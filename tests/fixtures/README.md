# Format fixtures

These files are small, purpose-built compatibility fixtures for Nanquim's
automated tests. They are not user drawings, production assets, or exports from
third-party CAD applications.

| File | Purpose | Provenance | License |
| --- | --- | --- | --- |
| `native-v1.svg` | Minimal historical Nanquim schema-v1 document with a collection, geometry, and Paper configuration. | Authored for the Nanquim test suite on 2026-08-20. | GPL-3.0-only |
| `native-v2.svg` | Minimal historical Nanquim schema-v2 document with collections, styles, definitions, a block instance, Paper metadata, and empty Geometry Nodes metadata. | Authored for the Nanquim test suite on 2026-08-20. | GPL-3.0-only |
| `native-v3.svg` | Canonical schema-v3 semantic round-trip document spanning root title/description/custom metadata, nested geometry metadata, styles, definitions and references, opaque block names, Paper state, a valid Geometry Nodes modifier, and missing-graph cached-output fallback. | Authored for the Nanquim test suite on 2026-08-20. | GPL-3.0-only |
| `basic-entities-r2000.dxf` | ASCII DXF parser baseline with two layers and line, circle, and closed lightweight-polyline entities. | Authored from the public DXF group-code specification for the Nanquim test suite on 2026-08-20; no third-party drawing content was copied. | GPL-3.0-only |

Copyright 2026 Nanquim contributors.

The fixtures are distributed under the GNU General Public License version 3
only, matching the repository's [LICENSE](../../LICENSE). Their SPDX comments
are part of the fixture data and must be retained when the files are revised.

Keep fixtures deterministic and focused on semantic assertions. Larger
real-world interoperability samples require their own author, source, license,
tool version, and expected-degradation record before they may be added.
