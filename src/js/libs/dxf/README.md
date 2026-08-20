# Vendored DXF parser

Nanquim's DXF importer is based on the `dxf` 5.1.0 sources from
[skymakerolof/dxf](https://github.com/skymakerolof/dxf). The upstream code is
retained under the included MIT [LICENSE](LICENSE).

Nanquim imports `src/Helper.js` directly. This directory is a tailored source
snapshot, not a standalone npm package, command-line tool, example project, or
compiled distribution. Runtime dependencies and security updates are managed
by Nanquim's root manifest and lockfile.

The retained helper parses DXF text and exposes the parsed model, denormalized
entities, SVG conversion, and polyline conversion. Nanquim carries local
integration changes, so compare against upstream before replacing files.

## Maintenance

- Make importer changes in `src/` and verify them through Nanquim's tests and
  production build.
- Do not recreate `lib/`, examples, or the CLI unless Nanquim intentionally
  reintroduces a separately tested distribution surface.
- Keep `LICENSE` and any source-referenced assets with the vendored code.
