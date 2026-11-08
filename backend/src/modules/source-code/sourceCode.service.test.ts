// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { brand } from "../../lib/brand.generated";
import { WORKFLOW_CATALOG_PIN } from "../../lib/workflowCatalogPin";
import type { Db } from "../../lib/supabase";
import {
  getSourceOffer,
  runningCommit,
  runningVersion,
  workflowCatalogRepository,
} from "./sourceCode.service";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CATALOG_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";

/**
 * A Supabase stand-in for the one read the offer performs:
 * from("mike_workflows").select("source_commit").eq("active", true).limit(1).
 * `mode` picks the resolved rows, a returned error, or a thrown query.
 */
function fakeDb(mode: "rows" | "none" | "error" | "throw"): Db {
  const result =
    mode === "rows"
      ? { data: [{ source_commit: CATALOG_COMMIT }], error: null }
      : mode === "error"
        ? { data: null, error: { message: "unavailable" } }
        : { data: [], error: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    limit: () =>
      mode === "throw"
        ? Promise.reject(new Error("connection reset"))
        : Promise.resolve(result),
  };
  return { from: () => builder } as unknown as Db;
}

describe("source offer", () => {
  it("serves the licence, repository, running commit and synced catalog commit", async () => {
    const result = await getSourceOffer(fakeDb("rows"), {
      GIT_SHA: COMMIT,
      MIKE_VERSION: "2.1.0",
    } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offer = result.data;

    expect(offer.license).toBe("AGPL-3.0-only");
    expect(offer.repository).toBe(brand.sourceRepositoryUrl);
    expect(offer.commit).toBe(COMMIT);
    expect(offer.version).toBe("2.1.0");
    expect(offer.sourceUrl).toBe(`${brand.sourceRepositoryUrl}/tree/${COMMIT}`);
    // Upstream attribution comes from the single brand configuration.
    expect(offer.upstream.notice).toBe(brand.upstreamAttribution.notice);
    expect(offer.upstream.projectName).toBe(
      brand.upstreamAttribution.projectName,
    );
    expect(offer.notices.notice).toBe(
      `${brand.sourceRepositoryUrl}/blob/${COMMIT}/NOTICE.md`,
    );
    expect(offer.notices.modifications).toBe(
      `${brand.sourceRepositoryUrl}/blob/${COMMIT}/MODIFICATIONS.md`,
    );
    expect(offer.workflowCatalog.repository).toBe(
      `https://github.com/${WORKFLOW_CATALOG_PIN.repository}`,
    );
    expect(offer.workflowCatalog.syncedCommit).toBe(CATALOG_COMMIT);
    expect(offer.workflowCatalog.sourceUrl).toBe(
      `https://github.com/${WORKFLOW_CATALOG_PIN.repository}/tree/${CATALOG_COMMIT}`,
    );
  });

  it("reports null commit, version and synced commit when unstamped and nothing is synced", async () => {
    const result = await getSourceOffer(fakeDb("none"), {} as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offer = result.data;
    expect(offer.commit).toBeNull();
    expect(offer.version).toBeNull();
    // With no commit the source link is the repository root, never a bad ref.
    expect(offer.sourceUrl).toBe(brand.sourceRepositoryUrl);
    expect(offer.notices.notice).toBe(
      `${brand.sourceRepositoryUrl}/blob/HEAD/NOTICE.md`,
    );
    expect(offer.workflowCatalog.syncedCommit).toBeNull();
    expect(offer.workflowCatalog.sourceUrl).toBeNull();
  });

  it("still serves the compliance offer when the catalog read fails", async () => {
    for (const mode of ["error", "throw"] as const) {
      const result = await getSourceOffer(fakeDb(mode), {
        GIT_SHA: COMMIT,
      } as NodeJS.ProcessEnv);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.license).toBe("AGPL-3.0-only");
      expect(result.data.commit).toBe(COMMIT);
      expect(result.data.workflowCatalog.syncedCommit).toBeNull();
    }
  });

  it("normalizes a short or malformed GIT_SHA to null", () => {
    expect(runningCommit({ GIT_SHA: COMMIT } as NodeJS.ProcessEnv)).toBe(COMMIT);
    expect(runningCommit({ GIT_SHA: "abc" } as NodeJS.ProcessEnv)).toBeNull();
    expect(runningCommit({} as NodeJS.ProcessEnv)).toBeNull();
    expect(runningVersion({ MIKE_VERSION: " " } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("prefers a configured catalog repository over the pin, when well formed", () => {
    expect(
      workflowCatalogRepository({
        MIKE_WORKFLOWS_REPOSITORY: "acme/legal-workflows",
      } as NodeJS.ProcessEnv),
    ).toBe("acme/legal-workflows");
    // A malformed override is ignored in favour of the pin.
    expect(
      workflowCatalogRepository({
        MIKE_WORKFLOWS_REPOSITORY: "not a repo",
      } as NodeJS.ProcessEnv),
    ).toBe(WORKFLOW_CATALOG_PIN.repository);
  });
});
