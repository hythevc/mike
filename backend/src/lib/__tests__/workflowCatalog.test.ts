import { brand } from "../brand.generated";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogKeyFromWorkflowId,
  catalogWorkflowId,
  catalogWorkflowToLegacy,
  ensureDefaultWorkflows,
  findActiveCatalogVersions,
  resetEnsuredDefaultUsersForTests,
  type WorkflowCatalogRow,
} from "../workflowCatalog";

const CATALOG_ROW: WorkflowCatalogRow = {
  id: "catalog-1",
  workflow_key: "proofread",
  distribution: "default",
  version: "1.0.0",
  title: "Proofread",
  description: "Proofread a document.",
  type: "assistant",
  prompt_md: "# Proofread\n\nCheck the document.",
  columns_config: null,
  contributors: [
    {
      name: brand.productName,
      organisation: null,
      role: null,
      linkedin: null,
    },
  ],
  language: "English",
  practice: "General Transactions",
  jurisdictions: ["General"],
  pack_key: null,
  pack_title: null,
  pack_description: null,
  pack_version: null,
  source_commit: "a".repeat(40),
  content_hash: "b".repeat(64),
  active: true,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

describe("workflow catalog identifiers", () => {
  it("maps stable catalog keys to legacy builtin ids and back", () => {
    expect(catalogWorkflowId("proofread")).toBe("builtin-proofread");
    expect(catalogKeyFromWorkflowId("builtin-proofread")).toBe("proofread");
    expect(catalogKeyFromWorkflowId("proofread")).toBeNull();
    expect(catalogKeyFromWorkflowId("builtin-../proofread")).toBeNull();
  });

  it("preserves the compatibility response without embedding asset bytes", () => {
    expect(catalogWorkflowToLegacy(CATALOG_ROW)).toEqual(
      expect.objectContaining({
        id: "builtin-proofread",
        user_id: null,
        is_system: true,
        metadata: expect.objectContaining({
          name: "proofread",
          title: "Proofread",
          type: "assistant",
        }),
        skill_md: CATALOG_ROW.prompt_md,
        assets: [],
      }),
    );
  });

  it("reports the catalog licence, credit, provenance and notices on the built-in detail", () => {
    const provenance = {
      catalog_repository: "example/workflow-catalog",
      catalog_path: "assistant-workflows/proofread",
      license_file: "LICENSE",
      source_repository: null,
      source_path: null,
      source_commit: null,
      source_name: null,
      source_version: null,
      review_by: null,
    };
    expect(
      catalogWorkflowToLegacy({
        ...CATALOG_ROW,
        license: "MIT",
        license_evidence: "file",
        author_confirmation: null,
        attribution: "Proofread by Sample Author",
        provenance,
        notice_md: "Notice text",
        changes_md: "## 1.0.0",
      }),
    ).toMatchObject({
      license: "MIT",
      license_evidence: "file",
      author_confirmation: null,
      attribution: "Proofread by Sample Author",
      provenance,
      notice_md: "Notice text",
      changes_md: "## 1.0.0",
      source_commit: "a".repeat(40),
    });
    // Rows synced before the licence fields existed read as null.
    expect(catalogWorkflowToLegacy(CATALOG_ROW)).toMatchObject({
      license: null,
      attribution: null,
      provenance: null,
      notice_md: null,
    });
  });
});

describe("findActiveCatalogVersions", () => {
  it("maps each key the active catalog still serves to its version", async () => {
    const calls: unknown[][] = [];
    const query = {
      select: (...args: unknown[]) => (calls.push(["select", ...args]), query),
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
      in: (...args: unknown[]) => (calls.push(["in", ...args]), query),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [{ workflow_key: "proofread", version: "1.1.0" }],
          error: null,
        }).then(resolve),
    };
    const from = vi.fn(() => query);

    const versions = await findActiveCatalogVersions({ from } as never, [
      "proofread",
      "proofread",
      "withdrawn-key",
      "not a key",
    ]);

    expect(versions).toEqual(new Map([["proofread", "1.1.0"]]));
    expect(from).toHaveBeenCalledWith("mike_workflows");
    expect(calls).toContainEqual(["eq", "active", true]);
    expect(calls).toContainEqual([
      "in",
      "workflow_key",
      ["proofread", "withdrawn-key"],
    ]);
  });

  it("makes no query for no keys", async () => {
    const from = vi.fn();
    await expect(
      findActiveCatalogVersions({ from } as never, []),
    ).resolves.toEqual(new Map());
    expect(from).not.toHaveBeenCalled();
  });
});

describe("ensureDefaultWorkflows request-path cost", () => {
  beforeEach(() => resetEnsuredDefaultUsersForTests());

  it("asks Postgres to install catalog defaults once per user per process", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5, error: null });
    const db = { rpc } as never;

    await expect(ensureDefaultWorkflows("user-1", db)).resolves.toBe(5);
    await expect(ensureDefaultWorkflows("user-1", db)).resolves.toBe(0);
    await expect(ensureDefaultWorkflows("user-2", db)).resolves.toBe(5);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("install_missing_default_workflows", {
      p_user_id: "user-1",
    });
  });

  it("retries after a failed install instead of caching the failure", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("db down") })
      .mockResolvedValue({ data: 5, error: null });
    const db = { rpc } as never;

    await expect(ensureDefaultWorkflows("user-1", db)).rejects.toThrow(
      "db down",
    );
    await expect(ensureDefaultWorkflows("user-1", db)).resolves.toBe(5);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
