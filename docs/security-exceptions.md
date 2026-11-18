# Temporary dependency audit exceptions

## picomatch: CVE-2026-112366

- Advisory: [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
- Approved by the maintainer on **2026-11-18** for the snapping hotfix deployment
  in [PR #39](https://github.com/elschilling/nanquim/pull/39).
- Review by **2026-12-02**, and remove the exception as soon as a compatible
  patched release is available.
- The upstream advisory affects versions through 4.0.7 and lists no patched
  release as of approval. The lockfile currently resolves picomatch 4.0.5.
- The lockfile records the affected package only as a development dependency,
  through Vite, Vitest, Sass, and their glob/file-watching dependencies. The
  unfiltered production audit before this exception reported no vulnerabilities.
- Exploitation requires attacker-controlled glob patterns evaluated against
  crafted strings and can block the Node.js event loop. The hosted editor is
  static browser code; imported CAD content does not enter these development
  glob APIs. The development-tool vulnerability itself remains unfixed.

`package.json` records this one CVE under `pnpm.auditConfig.ignoreCves`. The
existing `pnpm audit --audit-level high` CI command still checks all other
advisories. pnpm 8 scopes this exception by CVE only; it does not enforce the
review date or restrict the exception to a dependency path or environment.
Reassess the exception before introducing picomatch into production dependencies
or accepting untrusted glob patterns in development tooling.

The full audit before applying this exception reported exactly one high finding
and no critical, moderate, or low findings. With pnpm 8, JSON audit metadata can
still count the ignored advisory; the human audit command used by CI exits
according to the remaining, non-ignored findings.
