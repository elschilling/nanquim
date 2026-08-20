# Release and deployment process

This checklist covers application releases for the hosted Nanquim editor. The
package is private and is not published to npm.

## Repository and deployment policy

- `master` is the canonical branch. Pull requests, CI, and the Vercel
  production project must all target it.
- GitHub should protect `master` against deletion and force pushes, require an
  up-to-date pull request, and require the `Test, build, and audit` check. A
  zero-approval pull request rule permits a solo maintainer to merge after CI
  while retaining the reviewable change boundary.
- Vercel should have only the `nanquim` project connected for production. If a
  legacy `svgcad` project is still connected, disconnect or archive it after
  confirming that it owns no required domain.
- Local clones may retain an old remote default. Refresh it after the remote
  settings are verified:

  ```bash
  git remote set-head origin -a
  ```

GitHub and Vercel settings are external state. Verify them in both dashboards
before every tagged prerelease until that policy is enforced automatically.

## Independent version domains

Do not advance a document schema as part of an application release unless the
release deliberately changes that format and includes migration tests.

| Domain | Current source | Release rule |
| --- | --- | --- |
| Application | `package.json` | Use SemVer without a leading `v`. The build derives all visible application labels from this value. |
| Git tag and GitHub release | Git | Prefix the application version with `v`, for example `v0.1.0-alpha.1`. |
| Native SVG document | `DOCUMENT_SCHEMA_VERSION` in `src/js/document/DocumentSerializer.js` and `data-nanquim-version` in saved SVG | Version independently; currently schema 3. |
| Geometry Nodes metadata | Geometry Nodes manager and graph serializers | Version independently; currently schema 1. |

## Prepare a release

1. Start from an up-to-date, clean `master` branch.

   ```bash
   git switch master
   git pull --ff-only
   git status --short
   ```

2. Choose a SemVer prerelease. Before the public beta, increment the alpha
   number; do not overwrite an existing version or move an existing tag.
3. If `package.json` already names the prepared candidate, do not bump it
   again. Otherwise, update package metadata without creating a tag or commit
   automatically. For example:

   ```bash
   next_release_version=0.1.0-alpha.2
   pnpm version "${next_release_version}" --no-git-tag-version
   ```

4. Collect the candidate changes under its version heading in `CHANGELOG.md`
   and create or update `docs/releases/v<version>.md` with user impact,
   compatibility, limitations, and backup guidance. While qualification is in
   progress, keep the changelog heading marked `Unreleased` and the release
   note marked `Prepared`.
5. Confirm that the native SVG and Geometry Nodes schema versions changed only
   when the release intentionally includes a tested schema migration.
6. Install and qualify the exact source tree.

   ```bash
   pnpm install --frozen-lockfile
   pnpm test
   pnpm build
   pnpm audit --audit-level high
   git diff --check
   ```

7. Commit the version, changelog, release notes, and product changes together.
   Open a pull request to `master`, wait for `Test, build, and audit`, and review
   the final diff before merging.

## Deploy and verify

Merging to `master` starts the Vercel production deployment through its GitHub
integration. GitHub Actions verifies the source but does not deploy it.

1. Confirm that CI succeeded for the exact commit merged to `master`.
2. In Vercel, confirm that the production deployment uses that same commit and
   that the `nanquim.vercel.app` alias points to it.
3. Open the production site in a clean browser session and check:

   - The page title and status bar show the package version being released.
   - The application loads without console errors at normal and narrow desktop
     widths.
   - A line and rectangle can be created, selected, undone, and redone.
   - A small native SVG can be saved, reopened, and inspected without losing
     visible geometry or collection ownership.
   - File upload/download fallbacks remain usable when persistent browser file
     handles are unavailable.

4. Record the deployed commit, deployment URL, browser, operating system, and
   result in the release notes or release issue.

## Tag and publish the GitHub release

Tag only the commit that passed production verification. The package version,
visible application version, changelog heading, tag, release title, and release
notes must all agree.

Before tagging, replace the candidate's `Unreleased` changelog marker with the
release date, point its changelog link at the future immutable GitHub release,
and remove the `Prepared` and `Before publishing` markers from its release
note. Commit and merge that metadata finalization, wait for CI and Vercel on the
new exact commit, and repeat the production version/startup smoke check. Then
tag that commit:

```bash
git switch master
git pull --ff-only
release_version="$(node -p "require('./package.json').version")"
release_tag="v${release_version}"
release_notes="docs/releases/${release_tag}.md"
test -f "${release_notes}"
git tag -a "${release_tag}" -m "Nanquim ${release_tag}"
git push origin "${release_tag}"
gh release create "${release_tag}" \
  --verify-tag \
  --prerelease \
  --title "Nanquim ${release_tag}" \
  --notes-file "${release_notes}"
```

Inspect the published release and download its source archive once. A tag and
GitHub release are external publishing actions and must never be created merely
because a package version changed locally.

## Roll back production

Prefer a reversible deployment rollback followed by a normal source revert.
Do not rewrite `master` or move a published tag.

1. In Vercel, find the last known-good deployment that previously served
   production, record its commit and URL, and use **Instant Rollback** to make
   it current again. From an authenticated CLI, the equivalent operation is
   `vercel rollback <deployment-url-or-id>`. Use **Promote to Production** only
   for a separately qualified preview or staged deployment that has not already
   served production.
2. Confirm that `nanquim.vercel.app` now serves the known-good deployment and
   repeat the critical smoke checks above.
3. Revert the faulty source change on `master` with `git revert`, qualify the
   revert through CI, and let Vercel deploy that new commit normally.
4. If a GitHub release was already published, add a prominent known-issue note.
   Keep its immutable tag and prepare the fix under a new prerelease version.
5. Record the incident, affected version, symptoms, rollback deployment and
   commit, verification evidence, and follow-up owner.

If Vercel itself is unavailable, communicate the outage and avoid pointing the
production alias at an unqualified local build. Source archives and users'
saved SVG documents are independent of the hosted deployment.

Vercel references: [Git production branches](https://vercel.com/docs/git) and
[promoting or rolling back deployments](https://vercel.com/docs/deployments/promoting-a-deployment).
