// SPDX-License-Identifier: AGPL-3.0-only
//
// Importing an add-on and duplicating a built-in run the same copy (object
// copies, a LibreOffice rendition per Word or presentation asset, text
// extraction), so both routes spend one budget: workflowImportLimiter in
// app.ts. Without it the duplicate route was a second import path on the
// general limit alone.

import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Env is set inside vi.hoisted so it lands before app.ts reads it at import.
vi.hoisted(() => {
  process.env.RATE_LIMIT_UPLOAD_MAX = "2";
  process.env.RATE_LIMIT_UPLOAD_WINDOW_HOURS = "1";
});

vi.mock("../../lib/supabase", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock.js");
  return { createServerSupabase: vi.fn(() => mockSupabase()) };
});

vi.mock("../../middleware/auth", async () => {
  const { authMock } = await import("../helpers/authMock.js");
  return authMock();
});

import { app } from "../../app";

const AUTH = ["Authorization", "Bearer test"] as const;
const ADDON_ID = "c0a7a1e1-0000-4000-8000-000000000001";

describe("workflow copy rate limit", () => {
  it("counts add-on imports and built-in duplicates against one budget", async () => {
    // The catalog serves neither workflow, so each copy ends in a cheap 404;
    // the limiter counts the request all the same.
    const imported = await request(app)
      .post(`/workflow-addons/${ADDON_ID}/import`)
      .set(...AUTH);
    expect(imported.status).toBe(404);
    const duplicated = await request(app)
      .post("/workflows/builtin-proofread/duplicate")
      .set(...AUTH);
    expect(duplicated.status).toBe(404);

    const limited = await request(app)
      .post("/workflows/builtin-proofread/duplicate")
      .set(...AUTH);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      code: "rate_limited",
      detail: "Too many workflow imports or copies. Please try again later.",
    });
    const limitedImport = await request(app)
      .post(`/workflow-addons/${ADDON_ID}/import`)
      .set(...AUTH);
    expect(limitedImport.status).toBe(429);

    // Reading a built-in is not a copy and stays on the general limit.
    const read = await request(app)
      .get("/workflows/builtin-proofread")
      .set(...AUTH);
    expect(read.status).not.toBe(429);
  });
});
