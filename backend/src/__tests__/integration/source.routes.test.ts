// SPDX-License-Identifier: AGPL-3.0-only
//
// GET /source is the AGPL-3.0 section 13 corresponding-source offer. It must
// answer without a session, so this exercises it through the real Express app
// with no auth, and checks the offer carries the licence, the configured
// repository, the build commit, and the workflow catalog repository and the
// commit its active rows were synced from.
//
// Env is set inside vi.hoisted so GIT_SHA and MIKE_VERSION land before app.ts
// and the source module read process.env at import.
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

const { COMMIT, CATALOG_COMMIT } = vi.hoisted(() => {
  const COMMIT = "0123456789abcdef0123456789abcdef01234567";
  const CATALOG_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";
  process.env.GIT_SHA = COMMIT;
  process.env.MIKE_VERSION = "2.1.0";
  process.env.RATE_LIMIT_GENERAL_MAX = "500";
  return { COMMIT, CATALOG_COMMIT };
});

function makeQuery() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit", "order", "not"]) q[m] = vi.fn(() => q);
  const result = { data: [{ source_commit: CATALOG_COMMIT }], error: null };
  // The offer awaits the builder after .limit(1); make it thenable.
  q.limit = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}

vi.mock("../../lib/supabase", () => ({
  createServerSupabase: vi.fn(() => ({
    from: vi.fn(() => makeQuery()),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  })),
}));

import { app } from "../../app";
import { brand } from "../../lib/brand.generated";

describe("GET /source", () => {
  it("answers 200 without a session with the corresponding-source offer", async () => {
    const res = await request(app).get("/source");
    expect(res.status).toBe(200);
    expect(res.body.license).toBe("AGPL-3.0-only");
    expect(res.body.repository).toBe(brand.sourceRepositoryUrl);
    expect(res.body.commit).toBe(COMMIT);
    expect(res.body.version).toBe("2.1.0");
    expect(res.body.sourceUrl).toBe(`${brand.sourceRepositoryUrl}/tree/${COMMIT}`);
    expect(res.body.upstream.notice).toBe(brand.upstreamAttribution.notice);
    expect(typeof res.body.workflowCatalog.repository).toBe("string");
    expect(res.body.workflowCatalog.repository).toMatch(/^https:\/\/github\.com\//);
    expect(res.body.workflowCatalog.syncedCommit).toBe(CATALOG_COMMIT);
  });

  it("sends no set-cookie and needs no authorization", async () => {
    const res = await request(app).get("/source");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
