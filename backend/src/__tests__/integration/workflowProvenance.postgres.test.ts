// SPDX-License-Identifier: AGPL-3.0-only
//
// A catalog workflow's licence, evidence, confirmation, credit, provenance,
// NOTICE and CHANGES survive the real path: the archive parser, the sync job,
// replace_mike_workflows in PostgreSQL, and the built-in detail route.
//
// Opt in with MIKE_TEST_POSTGRES_CONTAINER=supabase_db_backend, as for the
// other PostgreSQL suites. Only disposable databases are written.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import express from "express";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { storedRow } = vi.hoisted(() => ({
  storedRow: { current: null as Record<string, unknown> | null },
}));

vi.mock("../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage")>()),
  storageEnabled: true,
  uploadFile: vi.fn(async () => undefined),
}));

// The detail route reads the row PostgreSQL stored.
vi.mock("../../lib/supabase", () => ({
  createServerSupabase: () => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      query[method] = () => query;
    }
    query.maybeSingle = async () => ({ data: storedRow.current, error: null });
    return { from: () => query };
  },
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = "00000000-0000-4000-8000-000000000001";
    next();
  },
}));

import { syncWorkflowCatalog } from "../../lib/workflowCatalogSync";
import { workflowsRouter } from "../../modules/workflows/workflows.routes";

const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const COMMIT = "1".repeat(40);
const KEY = "lease-review";

function defaultsAndAdapted(attribution: string) {
  const zip = new JSZip();
  const root = "catalog-test";
  zip.file(`${root}/LICENSE`, "MIT License\n\nCopyright (c) 2026 Sample Author\n");
  const skill = (key: string, type: string, extra = "", license = "MIT") => `---
name: "${key}"
description: "Test workflow. Draft for lawyer review."
license: "${license}"
metadata:
  version: "1.0.0"
  author: "Sample Author"
  language: "English"
  mike-display-name: "${key}"
  mike-type: "${type}"
  practice: "General Transactions"
  jurisdictions: "General"
${extra}---
Run the workflow.
`;
  for (const key of ["proofread", "compare-documents", "extract-key-terms", "draft-from-template"]) {
    zip.file(`${root}/assistant-workflows/${key}/SKILL.md`, skill(key, "assistant"));
  }
  const tabular = `${root}/tabular-review-workflows/commercial-agreement-tabular-review`;
  zip.file(`${tabular}/SKILL.md`, skill("commercial-agreement-tabular-review", "tabular"));
  zip.file(`${tabular}/table-columns.yaml`, 'columns:\n  - index: 0\n    name: "Party"\n    prompt: "Who?"\n');
  const adapted = `${root}/assistant-workflows/${KEY}`;
  zip.file(
    `${adapted}/SKILL.md`,
    skill(
      KEY,
      "assistant",
      `  author-organisation: "Sample Practice LLP"
  source-repository: "example/legal-skills"
  source-commit: "${"2".repeat(40)}"
  source-path: "skills/lease-review"
  source-name: "lease-review"
  source-version: "3.0.0"
  license-evidence: "manifest-only"
  author-confirmation: "confirmed 2026-10-01"
  attribution: "${attribution}"
  review-by: "2027-04-30"
`,
      "Apache-2.0",
    ),
  );
  zip.file(`${adapted}/LICENSE`, "Apache License\nVersion 2.0, January 2004\n");
  zip.file(`${adapted}/NOTICE`, "Lease Review\nCopyright 2026 Sample Author\n");
  zip.file(`${adapted}/CHANGES.md`, "## 1.0.0 - 2026-10-31\n- Converted.\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

describe.skipIf(!container).each(["fresh", "upgraded"])(
  "workflow provenance in PostgreSQL (%s)",
  (mode) => {
    const database = `mike_workflow_provenance_${mode}_${process.pid}_${Date.now()}`;
    const sql = (query: string): string =>
      execFileSync(
        "docker",
        ["exec", "-i", container!, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-XqAt"],
        { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    let created = false;

    // Each sync goes through syncWorkflowCatalog; its replace RPC runs here.
    async function sync(attribution: string) {
      const bytes = await defaultsAndAdapted(attribution);
      const temporaryRoot = await mkdtemp(path.join(tmpdir(), "workflow-provenance-"));
      try {
        const rpc = async (name: string, args: { p_source_commit: string; p_workflows: unknown }) => {
          expect(name).toBe("replace_mike_workflows");
          sql(
            `select public.replace_mike_workflows('${args.p_source_commit}', ` +
              `$w04$${JSON.stringify(args.p_workflows)}$w04$::jsonb);`,
          );
          return { data: null, error: null };
        };
        await syncWorkflowCatalog({ rpc } as never, {
          temporaryRoot,
          repository: "example/workflow-catalog",
          ref: COMMIT,
          fetchImpl: (async () => new Response(new Uint8Array(bytes), { status: 200 })) as unknown as typeof fetch,
        });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }

    const activeRow = (): Record<string, unknown> =>
      JSON.parse(
        sql(`select row_to_json(w) from public.mike_workflows w where workflow_key = '${KEY}' and active;`),
      ) as Record<string, unknown>;

    beforeAll(() => {
      execFileSync("docker", ["exec", container!, "createdb", "-U", "postgres", database]);
      created = true;
      sql(`create schema auth;
        create table auth.users (id uuid primary key, email text,
          raw_user_meta_data jsonb default '{}', created_at timestamptz default now());`);
      sql(readFileSync(resolve("schema.sql"), "utf8"));
      if (mode === "upgraded") {
        // The migration is safe to re-run over a database that has it.
        const migration = readFileSync(resolve("migrations/20261031_52_workflow_provenance.sql"), "utf8");
        sql(migration);
        sql(migration);
      }
    }, 60_000);

    afterAll(() => {
      if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("persists licence, evidence, confirmation, credit, provenance, NOTICE and CHANGES and serves them from the detail API", async () => {
      await sync("Lease Review by Sample Author (Apache-2.0); modified.");
      const row = activeRow();
      expect(row).toMatchObject({
        source_commit: COMMIT,
        license: "Apache-2.0",
        license_evidence: "manifest-only",
        author_confirmation: "confirmed 2026-10-01",
        attribution: "Lease Review by Sample Author (Apache-2.0); modified.",
        notice_md: "Lease Review\nCopyright 2026 Sample Author",
        changes_md: "## 1.0.0 - 2026-10-31\n- Converted.",
        contributors: [expect.objectContaining({ organisation: "Sample Practice LLP" })],
        provenance: {
          catalog_repository: "example/workflow-catalog",
          catalog_path: `assistant-workflows/${KEY}`,
          license_file: `assistant-workflows/${KEY}/LICENSE`,
          source_repository: "example/legal-skills",
          source_path: "skills/lease-review",
          source_commit: "2".repeat(40),
          source_name: "lease-review",
          source_version: "3.0.0",
          review_by: "2027-04-30",
        },
      });
      // The vendored defaults rest on the catalog's root licence.
      expect(
        sql(`select license || '|' || license_evidence || '|' || (provenance->>'license_file')
             from public.mike_workflows where workflow_key = 'proofread' and active;`),
      ).toBe("MIT|file|LICENSE");

      storedRow.current = row;
      const app = express();
      app.use("/workflows", workflowsRouter);
      const res = await request(app).get(`/workflows/builtin-${KEY}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: `builtin-${KEY}`,
        license: "Apache-2.0",
        license_evidence: "manifest-only",
        author_confirmation: "confirmed 2026-10-01",
        attribution: row.attribution,
        provenance: row.provenance,
        notice_md: row.notice_md,
        changes_md: row.changes_md,
        source_commit: COMMIT,
      });
    });

    it("keeps a changed credit as a new catalog row and retires the old one", async () => {
      await sync("Lease Review by Sample Author (Apache-2.0); modified.");
      const before = activeRow();
      await sync("Lease Review, credited to Sample Author.");
      const after = activeRow();
      expect(after.id).not.toBe(before.id);
      expect(after.attribution).toBe("Lease Review, credited to Sample Author.");
      expect(
        sql(`select active from public.mike_workflows where id = '${String(before.id)}';`),
      ).toBe("f");
    });
  },
);
