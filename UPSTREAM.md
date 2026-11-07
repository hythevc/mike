# Upstream

This repository is a fork of **Mike** by Open-Legal-Products
(<https://github.com/Open-Legal-Products/mike>), licensed under the GNU Affero
General Public License, version 3 only (AGPL-3.0-only). This file records how
the fork tracks upstream and what it changes about the release process. The
prominent, dated modification notice is in [NOTICE.md](NOTICE.md), and the
per-file ledger is in [MODIFICATIONS.md](MODIFICATIONS.md).

## Synchronization

- Fork base commit: `1f7ae19fd1643fd350d564bbdbbe5801611d0765` (Mike v2.1.0).
- Last synced upstream commit: `1f7ae19fd1643fd350d564bbdbbe5801611d0765` (Mike v2.1.0).

Upstream changes are pulled in on a regular cadence through `fix/upstream-sync`
pull requests, merged with merge commits so the join to upstream history stays
visible in the git log. After each sync, the "Last synced upstream commit"
line above is updated to the upstream commit that was merged. `scripts/agpl`
reads these two lines: the SPDX check uses the fork base, and the modification
ledger is taken relative to the last synced commit.

## Migrations

Upstream owns the lower database-migration sequence numbers for each date.
Fork-authored migrations use sequence numbers in the range **50–99**
(for example `20261031_50_playbook_decisions.sql`), so a fork migration and an
upstream migration created on the same day never collide, and a sync does not
have to renumber anyone's files. See the migration rules in `AGENTS.md`.

## Release images

The upstream `publish-images` workflow builds and pushes release images to a
container registry. This fork does **not** publish images: the preview runs
from source, and nothing here is built from a published image. The workflow's
automatic triggers are therefore turned off in
[`.github/workflows/publish-images.yml`](.github/workflows/publish-images.yml);
it remains available to run by hand if the fork later chooses to publish its
own images under its own namespace.

Before any release image is built, `scripts/agpl/check-release-commit.mjs`
requires the commit to be present on the public fork's remote, so the AGPL
source offer can always point at source that can be fetched.
