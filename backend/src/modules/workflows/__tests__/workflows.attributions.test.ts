// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit test for the open-source notices listing: it projects the active
// catalog rows into the wire shape the notices page renders, carrying the
// licence, credit, source and revision, ordered by pack then title.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { listActiveCatalogWorkflows } = vi.hoisted(() => ({
  listActiveCatalogWorkflows: vi.fn(),
}));

vi.mock("../../../lib/workflowCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/workflowCatalog")>();
  return { ...actual, listActiveCatalogWorkflows };
});

import type { Db } from "../../../lib/supabase";
import type { WorkflowCatalogRow } from "../../../lib/workflowCatalog";
import { listCatalogAttributions } from "../workflows.catalog";

function row(overrides: Partial<WorkflowCatalogRow>): WorkflowCatalogRow {
  return {
    id: overrides.id ?? "row-1",
    workflow_key: overrides.workflow_key ?? "key",
    distribution: overrides.distribution ?? "addon",
    version: overrides.version ?? "1.0.0",
    title: overrides.title ?? "Title",
    description: null,
    type: overrides.type ?? "assistant",
    prompt_md: null,
    columns_config: null,
    contributors: overrides.contributors ?? null,
    language: "English",
    practice: null,
    jurisdictions: null,
    pack_key: overrides.pack_key ?? null,
    pack_title: overrides.pack_title ?? null,
    pack_description: null,
    pack_version: null,
    license: overrides.license ?? null,
    license_evidence: overrides.license_evidence ?? null,
    author_confirmation: null,
    attribution: overrides.attribution ?? null,
    provenance: overrides.provenance ?? null,
    notice_md: overrides.notice_md ?? null,
    changes_md: overrides.changes_md ?? null,
    source_commit: overrides.source_commit ?? null,
    content_hash: "hash",
    active: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

describe("listCatalogAttributions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("projects the catalog's licence, credit, source and revision, ordered by pack then title", async () => {
    listActiveCatalogWorkflows.mockResolvedValue([
      row({
        id: "b",
        workflow_key: "nda-review",
        distribution: "default",
        title: "NDA Review",
        pack_key: null,
        pack_title: null,
        license: "MIT",
        license_evidence: "file",
        attribution: "Copyright (c) 2026 Sample Author.",
        source_commit: "aaaa",
      }),
      row({
        id: "a",
        workflow_key: "opposing-counsel-review",
        distribution: "addon",
        title: "Opposing Counsel Review",
        pack_key: "disputes",
        pack_title: "Disputes",
        license: "Apache-2.0",
        license_evidence: "manifest-only",
        attribution: "Based on Opposing Counsel Review.",
        provenance: {
          catalog_repository: "Open-Legal-Products/mike-workflows",
          catalog_path: "assistant-workflows/opposing-counsel-review",
          license_file: null,
          source_repository: null,
          source_path: null,
          source_commit: null,
          source_name: "Opposing Counsel Review",
          source_version: null,
          review_by: null,
        },
        source_commit: "bbbb",
      }),
    ]);

    const result = await listCatalogAttributions({} as Db);

    // Ordered by pack title (none sorts first), then title.
    expect(result.map((entry) => entry.workflow_key)).toEqual([
      "nda-review",
      "opposing-counsel-review",
    ]);

    expect(result[1]).toMatchObject({
      workflow_key: "opposing-counsel-review",
      title: "Opposing Counsel Review",
      type: "assistant",
      distribution: "addon",
      pack_title: "Disputes",
      version: "1.0.0",
      license: "Apache-2.0",
      license_evidence: "manifest-only",
      attribution: "Based on Opposing Counsel Review.",
      source_commit: "bbbb",
    });
    expect(result[1].provenance?.source_name).toBe("Opposing Counsel Review");
  });

  it("returns licence fields as null for a row synced before provenance", async () => {
    listActiveCatalogWorkflows.mockResolvedValue([
      row({ workflow_key: "legacy", title: "Legacy", license: null }),
    ]);
    const [entry] = await listCatalogAttributions({} as Db);
    expect(entry.license).toBeNull();
    expect(entry.attribution).toBeNull();
    expect(entry.provenance).toBeNull();
  });
});
