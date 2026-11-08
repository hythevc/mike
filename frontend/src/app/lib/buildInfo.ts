// SPDX-License-Identifier: AGPL-3.0-only
//
// The running build's identity for the source pages and the auth footer.
//
// The repository and upstream attribution come from the single brand
// configuration; the running commit and version come from the public build
// variables the image bakes in (NEXT_PUBLIC_GIT_SHA, NEXT_PUBLIC_MIKE_VERSION).
// This is enough to show the version, link to the source at the exact commit,
// and credit the upstream project without any call to the backend, so the
// About page, the public /source page and the signed-out auth footer all
// render the same facts offline.

import { brand } from "@/shared/brand.generated";

const FULL_COMMIT = /^[0-9a-f]{40}$/;

export interface BuildInfo {
  /** The running version (NEXT_PUBLIC_MIKE_VERSION), or null when unstamped. */
  version: string | null;
  /** The running commit as a full 40-character SHA, or null when unstamped. */
  commit: string | null;
  /** The first 12 characters of the commit, for display, or null. */
  shortCommit: string | null;
  /** The source repository web address, without a trailing slash or `.git`. */
  repositoryUrl: string;
  /**
   * The repository at the running commit (`<repo>/tree/<commit>`), or the
   * repository root when the commit is unknown — never a broken ref.
   */
  sourceTreeUrl: string;
  /** The upstream project this software is derived from. */
  upstream: {
    projectName: string;
    author: string;
    url: string;
    license: string;
    notice: string;
  };
}

function repositoryWebBase(url: string): string {
  return url.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
}

/** The running build's identity, read fresh so tests can vary the build env. */
export function getBuildInfo(): BuildInfo {
  const rawCommit = (process.env.NEXT_PUBLIC_GIT_SHA ?? "").trim().toLowerCase();
  const commit = FULL_COMMIT.test(rawCommit) ? rawCommit : null;
  const version = (process.env.NEXT_PUBLIC_MIKE_VERSION ?? "").trim() || null;
  const repositoryUrl = repositoryWebBase(brand.sourceRepositoryUrl);
  return {
    version,
    commit,
    shortCommit: commit ? commit.slice(0, 12) : null,
    repositoryUrl,
    sourceTreeUrl: commit ? `${repositoryUrl}/tree/${commit}` : repositoryUrl,
    upstream: brand.upstreamAttribution,
  };
}

/** A link to a repository file at the running commit (or HEAD when unknown). */
export function repositoryFileUrl(info: BuildInfo, file: string): string {
  return `${info.repositoryUrl}/blob/${info.commit ?? "HEAD"}/${file}`;
}
