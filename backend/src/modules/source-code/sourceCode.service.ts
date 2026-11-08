// SPDX-License-Identifier: AGPL-3.0-only
//
// The public AGPL source offer (served by sourceCode.routes at GET /source).
//
// AGPL-3.0 section 13 requires that every network user be offered the
// Corresponding Source of the exact running version. This service assembles
// that offer from values the build already carries: the repository and
// upstream attribution from the single brand configuration
// (lib/brand.generated), the running commit and version from the GIT_SHA and
// MIKE_VERSION the image build stamps, and the workflow catalog repository and
// the commit its active rows were synced from (mike_workflows.source_commit).
//
// It never touches req/res and takes an explicit `db` and `env`, so the route
// stays thin and the offer is testable without a running server. The catalog
// lookup is best-effort: the compliance offer (repository, commit, licence,
// upstream attribution) is served even when the database cannot answer.

import type { Db } from "../../lib/supabase";
import { brand } from "../../lib/brand.generated";
import { WORKFLOW_CATALOG_PIN } from "../../lib/workflowCatalogPin";
import { ok, type ServiceResult } from "../../lib/serviceResult";

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface SourceOfferUpstream {
  readonly projectName: string;
  readonly author: string;
  readonly url: string;
  readonly license: string;
  readonly notice: string;
}

export interface SourceOfferWorkflowCatalog {
  /** Public repository the active workflow rows are synced from. */
  readonly repository: string;
  /** The commit those rows were synced from, or null when none are synced. */
  readonly syncedCommit: string | null;
  /** The catalog repository at the synced commit, or null when unknown. */
  readonly sourceUrl: string | null;
}

/** The complete corresponding-source offer served at GET /source. */
export interface SourceOffer {
  readonly license: "AGPL-3.0-only";
  /** Public repository holding the corresponding source of the running build. */
  readonly repository: string;
  /** The exact commit the running image was built from, or null when unstamped. */
  readonly commit: string | null;
  /** The running version (MIKE_VERSION), or null when unstamped. */
  readonly version: string | null;
  /** The repository at the running commit, or the repository root when unstamped. */
  readonly sourceUrl: string;
  readonly upstream: SourceOfferUpstream;
  /** Links to the fork's notice and modification ledger at the running commit. */
  readonly notices: {
    readonly notice: string;
    readonly modifications: string;
  };
  readonly workflowCatalog: SourceOfferWorkflowCatalog;
}

/** A repository web base with any trailing slash or `.git` suffix removed. */
function repositoryWebBase(url: string): string {
  return url.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
}

function treeUrl(base: string, commit: string | null): string {
  return commit ? `${base}/tree/${commit}` : base;
}

function blobUrl(base: string, commit: string | null, file: string): string {
  return `${base}/blob/${commit ?? "HEAD"}/${file}`;
}

/** The running commit as a full 40-character hex SHA, or null when unstamped. */
export function runningCommit(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.GIT_SHA?.trim().toLowerCase() ?? "";
  return FULL_COMMIT.test(value) ? value : null;
}

/** The running version string, or null when unstamped. */
export function runningVersion(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.MIKE_VERSION?.trim() || null;
}

/**
 * The workflow catalog repository this build syncs: the configured override
 * when it names an `owner/repository`, otherwise the pinned default. Kept to
 * the same precedence the sync resolution uses (lib/workflowCatalogSource).
 */
export function workflowCatalogRepository(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.MIKE_WORKFLOWS_REPOSITORY?.trim();
  return configured && OWNER_REPO.test(configured)
    ? configured
    : WORKFLOW_CATALOG_PIN.repository;
}

/** An `owner/repository` slug as a GitHub web URL. */
function repositorySlugUrl(slug: string): string {
  return `https://github.com/${slug}`;
}

/**
 * Read the commit the active workflow rows were synced from. All active rows
 * are replaced together with one source commit, so reading a single row is
 * enough. Best-effort: a database that cannot answer yields null rather than
 * failing the source offer.
 */
async function syncedCatalogCommit(db: Db): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("mike_workflows")
      .select("source_commit")
      .eq("active", true)
      .limit(1);
    if (error || !Array.isArray(data)) return null;
    const commit = data[0]?.source_commit;
    return typeof commit === "string" && commit.trim() ? commit.trim() : null;
  } catch {
    return null;
  }
}

/** Assemble the corresponding-source offer served at GET /source. */
export async function getSourceOffer(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServiceResult<SourceOffer>> {
  const commit = runningCommit(env);
  const repository = repositoryWebBase(brand.sourceRepositoryUrl);
  const catalogRepositorySlug = workflowCatalogRepository(env);
  const catalogRepository = repositorySlugUrl(catalogRepositorySlug);
  const syncedCommit = await syncedCatalogCommit(db);

  return ok({
    license: "AGPL-3.0-only",
    repository,
    commit,
    version: runningVersion(env),
    sourceUrl: treeUrl(repository, commit),
    upstream: {
      projectName: brand.upstreamAttribution.projectName,
      author: brand.upstreamAttribution.author,
      url: brand.upstreamAttribution.url,
      license: brand.upstreamAttribution.license,
      notice: brand.upstreamAttribution.notice,
    },
    notices: {
      notice: blobUrl(repository, commit, "NOTICE.md"),
      modifications: blobUrl(repository, commit, "MODIFICATIONS.md"),
    },
    workflowCatalog: {
      repository: catalogRepository,
      syncedCommit,
      sourceUrl: syncedCommit ? `${catalogRepository}/tree/${syncedCommit}` : null,
    },
  });
}
