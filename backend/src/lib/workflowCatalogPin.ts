// SPDX-License-Identifier: AGPL-3.0-only
//
// The workflow catalog this build syncs when MIKE_WORKFLOWS_REPOSITORY and
// MIKE_WORKFLOWS_REF are not set. Pinning a full 40-character commit, rather
// than a branch, keeps every sync reproducible: the archive behind a commit
// cannot change after a release, and the sync downloads it without asking the
// GitHub API to resolve a name. Moving to a newer catalog release is a change
// to `commit` here (and `repository`, if the catalog moves).
export const WORKFLOW_CATALOG_PIN = Object.freeze({
  repository: "Open-Legal-Products/mike-workflows",
  commit: "ce62e6a2d3f47e1d3567a4f2edc61898cfe9e78a",
});
