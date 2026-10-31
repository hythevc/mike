// SPDX-License-Identifier: AGPL-3.0-only
//
// Editable copies of catalog workflows: a duplicated built-in and an imported
// add-on keep the original's licence, credit and provenance, keep them when
// the body is edited, copy their assets through the documents module, and
// report where they stand against the catalog.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  copyDocumentVersionFiles,
  createDocumentVersions,
  downloadFile,
  uploadFile,
  prepareDocumentDisplay,
  enqueueStorageCleanup,
  checkWorkflowAccess,
} = vi.hoisted(() => ({
  copyDocumentVersionFiles: vi.fn(),
  createDocumentVersions: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  prepareDocumentDisplay: vi.fn(),
  enqueueStorageCleanup: vi.fn(),
  checkWorkflowAccess: vi.fn(),
}));

// The documents facade is the boundary under test for asset copies.
vi.mock("../../documents/documents.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../documents/documents.service")>()),
  copyDocumentVersionFiles,
  createDocumentVersions,
}));

vi.mock("../../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage")>()),
  downloadFile,
  uploadFile,
}));

vi.mock("../../../lib/documentDisplay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/documentDisplay")>()),
  // The real one shells out to LibreOffice for a .docx.
  prepareDocumentDisplay,
}));

vi.mock("../../../lib/dbq/enqueue", () => ({
  enqueueStorageCleanup: (...args: unknown[]) => enqueueStorageCleanup(...args),
}));

vi.mock("../../../lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/access")>()),
  checkWorkflowAccess: (...args: unknown[]) => checkWorkflowAccess(...args),
}));

import { AppError } from "../../../lib/appError";
import type { Db } from "../../../lib/supabase";
import { importWorkflowAddon } from "../workflows.addons";
import {
  CATALOG_MODIFICATION_NOTICE,
  catalogCopyFields,
  catalogStatusFor,
  compareCatalogVersions,
  duplicateBuiltInWorkflow,
  serializeNewCatalogCopy,
  workflowBodySha256,
} from "../workflows.catalogCopy";
import { getWorkflowDetail, updateWorkflow } from "../workflows.crud";
import { submitOpenSourceWorkflow } from "../workflows.submissions";
import type { WorkflowRecord } from "../workflows.types";

type Result = { data: unknown; error: unknown };
type Call = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: [string, ...unknown[]][];
};

// PostgREST-shaped fake: a queue of results per table (the last one repeats)
// and a record of every call, its payload and its filters. A queued function
// answers from the call itself, as the database would from its filters.
function makeDb(results: Record<string, Array<Result | ((call: Call) => Result)>>) {
  const calls: Call[] = [];
  function from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const next = (): Result => {
      const queue = results[table];
      if (!queue || queue.length === 0) {
        throw new Error(`no result queued for table ${table}`);
      }
      const entry = queue.length > 1 ? queue.shift()! : queue[0];
      return typeof entry === "function" ? entry(call) : entry;
    };
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      call.filters.push([name, ...args]);
      return builder;
    };
    for (const name of ["select", "eq", "in", "order", "limit"]) {
      builder[name] = chain(name);
    }
    builder.insert = (payload: unknown) => {
      call.op = "insert";
      call.payload = payload;
      return builder;
    };
    builder.update = (payload: unknown) => {
      call.op = "update";
      call.payload = payload;
      return builder;
    };
    builder.delete = () => {
      call.op = "delete";
      return builder;
    };
    builder.single = async () => next();
    builder.maybeSingle = async () => next();
    builder.then = (
      resolve: (value: Result) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(next()).then(resolve, reject);
    return builder;
  }
  return { db: { from, rpc: vi.fn() } as unknown as Db, calls };
}

const PROVENANCE = {
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

const CONTRIBUTORS = [
  { name: "Sample Author", organisation: "Sample Practice LLP", role: null, linkedin: null },
];

const BUILT_IN = {
  id: "c0a7a1e1-0000-4000-8000-000000000001",
  workflow_key: "proofread",
  distribution: "default",
  version: "1.1.0",
  title: "Proofread",
  type: "assistant",
  prompt_md: "# Proofread\n\nCheck the document.",
  columns_config: null,
  contributors: CONTRIBUTORS,
  language: "English",
  practice: "General Transactions",
  jurisdictions: ["General"],
  license: "MIT",
  license_evidence: "file",
  author_confirmation: null,
  attribution: "Proofread by Sample Author (MIT).",
  provenance: PROVENANCE,
  notice_md: "Notice text",
  changes_md: "## 1.1.0",
  source_commit: "a".repeat(40),
  active: true,
};

const COPY_PROVENANCE = {
  ...PROVENANCE,
  catalog_commit: "a".repeat(40),
  contributors: CONTRIBUTORS,
  content_sha256: workflowBodySha256(BUILT_IN.prompt_md, null),
};

// The user's copy as the database returns it.
function copyRow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "w1",
    user_id: "u1",
    org_id: null,
    visibility: "private",
    title: "Proofread",
    type: "assistant",
    prompt_md: BUILT_IN.prompt_md,
    columns_config: null,
    language: "English",
    practice: "General Transactions",
    jurisdictions: ["General"],
    created_at: "2026-10-31T00:00:00.000Z",
    catalog_workflow_key: "proofread",
    catalog_version: "1.1.0",
    license: "MIT",
    attribution: "Proofread by Sample Author (MIT).",
    provenance: COPY_PROVENANCE,
    ...overrides,
  };
}

const ASSET = {
  filename: "Precedent.docx",
  file_type: "docx",
  storage_path: "mike-workflows/proofread/hash/Precedent.docx",
  size_bytes: 9,
  content_hash: "f".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  copyDocumentVersionFiles.mockImplementation(
    async (args: { storagePath: string; beforeWrite?: (key: string) => void }) => {
      args.beforeWrite?.(args.storagePath);
      return { pdfStoragePath: null };
    },
  );
  createDocumentVersions.mockResolvedValue({ data: [], error: null });
  downloadFile.mockResolvedValue(new TextEncoder().encode("reference").buffer);
  uploadFile.mockResolvedValue(undefined);
  prepareDocumentDisplay.mockResolvedValue({
    bytes: Buffer.from("converted-pdf"),
    contentType: "application/pdf",
    filename: "Precedent.pdf",
  });
  checkWorkflowAccess.mockResolvedValue({ ok: true, projectRole: "owner" });
});

describe("catalog version order", () => {
  it.each([
    ["1.10.0", "1.9.3", 1],
    ["1.0.0", "1.0.0", 0],
    ["v2.0.0", "1.9.9", 1],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
  ])("compares %s with %s as %d", (a, b, order) => {
    expect(compareCatalogVersions(a, b)).toBe(order);
  });

  it("cannot order versions that are not semantic versions", () => {
    expect(compareCatalogVersions("unversioned", "1.0.0")).toBeNull();
  });

  it.each([
    ["1.0.0", "1.1.0", "update_available"],
    ["1.1.0", "1.1.0", "current"],
    // The catalog rolled back: the copy is not behind it.
    ["1.2.0", "1.1.0", "current"],
    ["1.0.0", undefined, "withdrawn"],
    ["draft-a", "draft-b", "update_available"],
    [null, "1.0.0", "update_available"],
  ] as const)("a copy at %s against a catalog at %s is %s", (copy, active, status) => {
    expect(catalogStatusFor(copy, active)).toBe(status);
  });
});

describe("catalogCopyFields", () => {
  it("reports nothing for a workflow that was not copied from the catalog", () => {
    expect(
      catalogCopyFields(
        copyRow({ catalog_workflow_key: null, catalog_version: null, license: null, attribution: null, provenance: null }),
        undefined,
      ),
    ).toEqual({
      catalog_workflow_key: null,
      catalog_version: null,
      license: null,
      attribution: null,
      provenance: null,
      catalog_status: null,
      catalog_latest_version: null,
      catalog_modified: false,
      modification_notice: null,
    });
  });

  it("marks a copy whose instructions were edited, keeping its licence and credit", () => {
    expect(
      catalogCopyFields(copyRow({ prompt_md: "# Proofread\n\nOur own checks." }), "1.1.0"),
    ).toMatchObject({
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
      catalog_status: "current",
      catalog_modified: true,
      modification_notice: CATALOG_MODIFICATION_NOTICE,
    });
    expect(CATALOG_MODIFICATION_NOTICE).toBe("Modified by your organisation");
    expect(catalogCopyFields(copyRow(), "1.1.0")).toMatchObject({
      catalog_modified: false,
      modification_notice: null,
    });
  });

  it("ignores the key order of columns when deciding whether a copy was edited", () => {
    const columns = [{ index: 0, name: "Party", prompt: "Who?", format: "text" }];
    const reordered = [{ prompt: "Who?", format: "text", name: "Party", index: 0 }];
    const row = copyRow({
      type: "tabular",
      columns_config: reordered,
      provenance: { ...COPY_PROVENANCE, content_sha256: workflowBodySha256(BUILT_IN.prompt_md, columns) },
    });
    expect(catalogCopyFields(row, "1.1.0").catalog_modified).toBe(false);
  });
});

describe("duplicateBuiltInWorkflow", () => {
  it("refuses an id that is not a built-in, without a query", async () => {
    const { db, calls } = makeDb({});
    expect(
      await duplicateBuiltInWorkflow(db, { workflowId: "w-123", userId: "u1" }),
    ).toEqual({ ok: false, kind: "not_found", detail: "Built-in workflow not found" });
    expect(calls).toEqual([]);
  });

  it("refuses a built-in the active catalog no longer serves", async () => {
    const { db, calls } = makeDb({ mike_workflows: [{ data: null, error: null }] });
    expect(
      await duplicateBuiltInWorkflow(db, { workflowId: "builtin-proofread", userId: "u1" }),
    ).toMatchObject({ ok: false, kind: "not_found" });
    expect(calls[0].filters).toContainEqual(["eq", "workflow_key", "proofread"]);
    expect(calls[0].filters).toContainEqual(["eq", "distribution", "default"]);
    expect(calls[0].filters).toContainEqual(["eq", "active", true]);
  });

  it("refuses an add-on's key: add-ons are copied only through their import route", async () => {
    const addon: Record<string, unknown> = {
      ...BUILT_IN,
      workflow_key: "sample-review",
      distribution: "addon",
    };
    const { db, calls } = makeDb({
      mike_workflows: [
        (call) => ({
          data: call.filters.every(
            ([name, column, value]) =>
              name !== "eq" || addon[column as string] === value,
          )
            ? addon
            : null,
          error: null,
        }),
      ],
    });

    expect(
      await duplicateBuiltInWorkflow(db, {
        workflowId: "builtin-sample-review",
        userId: "u1",
      }),
    ).toEqual({ ok: false, kind: "not_found", detail: "Built-in workflow not found" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("makes an editable copy with the built-in's licence, credit and provenance", async () => {
    const inserted = copyRow();
    const { db, calls } = makeDb({
      mike_workflows: [{ data: BUILT_IN, error: null }],
      workflows: [{ data: inserted, error: null }],
      mike_workflow_assets: [{ data: [], error: null }],
    });

    const result = await duplicateBuiltInWorkflow(db, {
      workflowId: "builtin-proofread",
      userId: "u1",
    });

    expect(result).toEqual({ ok: true, data: inserted });
    const insert = calls.find((c) => c.table === "workflows" && c.op === "insert");
    expect(insert?.payload).toEqual({
      user_id: "u1",
      title: "Proofread",
      type: "assistant",
      prompt_md: BUILT_IN.prompt_md,
      columns_config: null,
      language: "English",
      practice: "General Transactions",
      jurisdictions: ["General"],
      catalog_workflow_key: "proofread",
      catalog_version: "1.1.0",
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
    });
    // NOTICE and CHANGES stay with the catalog row; the copy links to them.
    expect(insert?.payload).not.toHaveProperty("notice_md");

    // The 201 body: the GET /workflows/:id shape, owned, and current.
    expect(serializeNewCatalogCopy(inserted)).toMatchObject({
      id: "w1",
      is_system: false,
      is_owner: true,
      allow_edit: true,
      access_role: "owner",
      is_default: false,
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
      catalog_workflow_key: "proofread",
      catalog_version: "1.1.0",
      catalog_status: "current",
      catalog_latest_version: "1.1.0",
      catalog_modified: false,
      metadata: expect.objectContaining({
        version: "1.1.0",
        contributors: CONTRIBUTORS,
      }),
    });
  });

  it("copies assets through the documents facade, in one version batch", async () => {
    const { db, calls } = makeDb({
      mike_workflows: [{ data: BUILT_IN, error: null }],
      workflows: [{ data: copyRow(), error: null }],
      mike_workflow_assets: [
        {
          data: [
            ASSET,
            {
              filename: "Guide.pdf",
              file_type: "pdf",
              storage_path: "mike-workflows/proofread/hash/Guide.pdf",
              size_bytes: 4,
              content_hash: "e".repeat(64),
            },
          ],
          error: null,
        },
      ],
      documents: [{ data: null, error: null }],
    });

    const result = await duplicateBuiltInWorkflow(db, {
      workflowId: "builtin-proofread",
      userId: "u1",
    });

    expect(result.ok).toBe(true);
    expect(copyDocumentVersionFiles).toHaveBeenCalledTimes(2);
    expect(copyDocumentVersionFiles).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source: { storage_path: ASSET.storage_path, pdf_storage_path: null, file_type: "docx" },
        storagePath: expect.stringMatching(/^documents\/u1\/.+\/source\.docx$/),
        transport: "server",
      }),
    );
    // Only the Word file needs a rendition.
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(createDocumentVersions).toHaveBeenCalledTimes(1);
    const [, versions] = createDocumentVersions.mock.calls[0] as [unknown, Array<Record<string, unknown>>];
    expect(versions).toEqual([
      expect.objectContaining({
        filename: "Precedent.docx",
        version_number: 1,
        content_sha256: "f".repeat(64),
        pdf_storage_path: expect.stringMatching(/^converted-pdfs\/u1\/.+\.pdf$/),
      }),
      expect.objectContaining({
        filename: "Guide.pdf",
        content_sha256: "e".repeat(64),
        pdf_storage_path: null,
      }),
    ]);
    const documents = calls.find((c) => c.table === "documents" && c.op === "insert");
    expect(documents?.payload).toEqual([
      expect.objectContaining({ workflow_id: "w1", library_kind: "workflow_asset", status: "processing" }),
      expect.objectContaining({ workflow_id: "w1", library_kind: "workflow_asset", status: "processing" }),
    ]);
    const ready = calls.find((c) => c.table === "documents" && c.op === "update");
    expect(ready?.payload).toMatchObject({ status: "ready" });
  });

  it("never asks for assets of a tabular built-in", async () => {
    const { db, calls } = makeDb({
      mike_workflows: [{ data: { ...BUILT_IN, type: "tabular" }, error: null }],
      workflows: [{ data: copyRow({ type: "tabular" }), error: null }],
    });
    expect((await duplicateBuiltInWorkflow(db, { workflowId: "builtin-proofread", userId: "u1" })).ok).toBe(true);
    expect(calls.some((c) => c.table === "mike_workflow_assets")).toBe(false);
  });

  it("gives a copy of a row synced before provenance existed every provenance key, as null", async () => {
    const { db, calls } = makeDb({
      mike_workflows: [
        {
          data: { ...BUILT_IN, license: null, attribution: null, provenance: null },
          error: null,
        },
      ],
      workflows: [{ data: copyRow(), error: null }],
      mike_workflow_assets: [{ data: [], error: null }],
    });

    await duplicateBuiltInWorkflow(db, { workflowId: "builtin-proofread", userId: "u1" });

    const insert = calls.find((c) => c.table === "workflows" && c.op === "insert");
    expect((insert?.payload as { provenance: unknown }).provenance).toEqual({
      catalog_repository: null,
      catalog_path: null,
      license_file: null,
      source_repository: null,
      source_path: null,
      source_commit: null,
      source_name: null,
      source_version: null,
      review_by: null,
      catalog_commit: "a".repeat(40),
      contributors: CONTRIBUTORS,
      content_sha256: workflowBodySha256(BUILT_IN.prompt_md, null),
    });
  });

  it("rolls the copy back and queues cleanup when a version batch fails", async () => {
    createDocumentVersions.mockResolvedValue({ data: null, error: { message: "batch failed" } });
    const { db, calls } = makeDb({
      mike_workflows: [{ data: BUILT_IN, error: null }],
      workflows: [{ data: copyRow(), error: null }],
      mike_workflow_assets: [{ data: [ASSET], error: null }],
      documents: [{ data: null, error: null }],
    });

    const result = await duplicateBuiltInWorkflow(db, {
      workflowId: "builtin-proofread",
      userId: "u1",
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "assets_copy_failed",
      detail: "Failed to copy workflow assets",
    });
    const failure = (result as { error?: AppError }).error!;
    expect(failure).toBeInstanceOf(AppError);
    expect(failure.kind).toBe("workflows.duplicate_failed");
    expect(failure.cause).toEqual({ message: "batch failed" });
    const rollback = calls.find((c) => c.table === "workflows" && c.op === "delete");
    expect(rollback?.filters).toEqual([
      ["eq", "id", "w1"],
      ["eq", "user_id", "u1"],
    ]);
    const [, paths] = enqueueStorageCleanup.mock.calls[0] as [unknown, string[]];
    expect(paths).toEqual([
      expect.stringMatching(/^documents\/u1\/.+\/source\.docx$/),
      expect.stringMatching(/^converted-pdfs\/u1\/.+\.pdf$/),
    ]);
  });
});

describe("importWorkflowAddon", () => {
  it("copies an add-on's licence, credit and provenance, and its assets through the documents facade", async () => {
    const addon = { ...BUILT_IN, workflow_key: "sample-review", distribution: "addon" };
    const { db, calls } = makeDb({
      mike_workflows: [{ data: addon, error: null }],
      workflows: [{ data: copyRow({ catalog_workflow_key: "sample-review" }), error: null }],
      mike_workflow_assets: [{ data: [ASSET], error: null }],
      documents: [{ data: null, error: null }],
    });

    const result = await importWorkflowAddon(db, { addonId: addon.id, userId: "u1" });

    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.table === "workflows" && c.op === "insert")?.payload).toMatchObject({
      catalog_workflow_key: "sample-review",
      catalog_version: "1.1.0",
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
    });
    expect(copyDocumentVersionFiles).toHaveBeenCalledTimes(1);
    expect(createDocumentVersions).toHaveBeenCalledTimes(1);
  });
});

describe("getWorkflowDetail catalog status", () => {
  function detailDb(row: WorkflowRecord, active: Array<{ workflow_key: string; version: string | null }>) {
    return makeDb({
      workflows: [{ data: row, error: null }],
      workflow_open_source_submissions: [{ data: null, error: null }],
      default_workflow_installations: [{ data: null, error: null }],
      mike_workflows: [{ data: active, error: null }],
    });
  }

  it("reports update_available when the catalog serves a newer version", async () => {
    const { db } = detailDb(copyRow({ catalog_version: "1.0.0" }), [
      { workflow_key: "proofread", version: "1.1.0" },
    ]);

    const result = await getWorkflowDetail(db, { workflowId: "w1", userId: "u1", userEmail: undefined });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      catalog_workflow_key: "proofread",
      catalog_version: "1.0.0",
      catalog_status: "update_available",
      catalog_latest_version: "1.1.0",
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
      metadata: expect.objectContaining({ version: "1.0.0", contributors: CONTRIBUTORS }),
    });
  });

  it("reports withdrawn when the copy's key has left the catalog", async () => {
    const { db } = detailDb(copyRow(), []);

    const result = await getWorkflowDetail(db, { workflowId: "w1", userId: "u1", userEmail: undefined });

    expect(result.ok && result.body).toMatchObject({
      catalog_status: "withdrawn",
      catalog_latest_version: null,
      // The credit stays with the copy after the catalog drops it.
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
    });
  });

  it("reports current, and the edit, for an edited copy of the current version", async () => {
    const { db } = detailDb(copyRow({ prompt_md: "Our own instructions." }), [
      { workflow_key: "proofread", version: "1.1.0" },
    ]);

    const result = await getWorkflowDetail(db, { workflowId: "w1", userId: "u1", userEmail: undefined });

    expect(result.ok && result.body).toMatchObject({
      catalog_status: "current",
      catalog_modified: true,
      modification_notice: "Modified by your organisation",
      license: "MIT",
    });
  });

  it("asks the catalog nothing for a workflow of the user's own", async () => {
    const { db, calls } = detailDb(
      copyRow({ catalog_workflow_key: null, catalog_version: null, license: null, attribution: null, provenance: null }),
      [],
    );

    const result = await getWorkflowDetail(db, { workflowId: "w1", userId: "u1", userEmail: undefined });

    expect(result.ok && result.body).toMatchObject({ catalog_status: null, license: null });
    expect(calls.some((c) => c.table === "mike_workflows")).toBe(false);
  });

  it("still answers, with the status unknown, when the catalog lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeDb({
      workflows: [{ data: copyRow({ catalog_version: "1.0.0" }), error: null }],
      workflow_open_source_submissions: [{ data: null, error: null }],
      default_workflow_installations: [{ data: null, error: null }],
      mike_workflows: [{ data: null, error: { message: "lookup failed" } }],
    });

    const result = await getWorkflowDetail(db, { workflowId: "w1", userId: "u1", userEmail: undefined });

    expect(result.ok && result.body).toMatchObject({
      catalog_workflow_key: "proofread",
      catalog_version: "1.0.0",
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
      catalog_status: null,
      catalog_latest_version: null,
    });
    expect(warn).toHaveBeenCalledWith(
      "[best-effort] workflow-catalog-status failed",
      expect.objectContaining({ error: { message: "lookup failed" } }),
    );
    warn.mockRestore();
  });
});

describe("updateWorkflow on a catalog copy", () => {
  it("keeps the licence, credit and provenance read-only and marks the edited body", async () => {
    const before = copyRow();
    const after = copyRow({ prompt_md: "Our own instructions." });
    const { db, calls } = makeDb({
      workflows: [
        { data: before, error: null },
        { data: after, error: null },
      ],
      mike_workflows: [{ data: [{ workflow_key: "proofread", version: "1.1.0" }], error: null }],
    });

    const result = await updateWorkflow(db, {
      workflowId: "w1",
      userId: "u1",
      userEmail: undefined,
      body: {
        skill_md: "Our own instructions.",
        // Attempts to rewrite the credit or the origin are not edits.
        license: "MIT-0",
        attribution: "Ours",
        provenance: {},
        catalog_workflow_key: "other",
        catalog_version: "9.9.9",
      } as never,
    });

    const update = calls.find((c) => c.table === "workflows" && c.op === "update");
    expect(update?.payload).toEqual({ prompt_md: "Our own instructions." });
    expect(result.ok && result.body).toMatchObject({
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
      catalog_workflow_key: "proofread",
      catalog_version: "1.1.0",
      catalog_status: "current",
      catalog_modified: true,
      modification_notice: "Modified by your organisation",
    });
  });

  it("answers the saved edit, with the status unknown, when the catalog lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, calls } = makeDb({
      workflows: [
        { data: copyRow(), error: null },
        { data: copyRow({ prompt_md: "Our own instructions." }), error: null },
      ],
      mike_workflows: [{ data: null, error: { message: "lookup failed" } }],
    });

    const result = await updateWorkflow(db, {
      workflowId: "w1",
      userId: "u1",
      userEmail: undefined,
      body: { skill_md: "Our own instructions." },
    });

    // The edit was saved, so the answer is the saved row, not an error the
    // client would retry.
    expect(calls.find((c) => c.table === "workflows" && c.op === "update")?.payload).toEqual({
      prompt_md: "Our own instructions.",
    });
    expect(result).toMatchObject({
      ok: true,
      body: {
        skill_md: "Our own instructions.",
        license: "MIT",
        attribution: "Proofread by Sample Author (MIT).",
        provenance: COPY_PROVENANCE,
        catalog_status: null,
        catalog_latest_version: null,
        catalog_modified: true,
      },
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("open-source submission of a catalog copy", () => {
  function submissionDb(row: WorkflowRecord) {
    return makeDb({
      workflows: [{ data: row, error: null }],
      user_profiles: [{ data: { display_name: "Submitting Lawyer" }, error: null }],
      workflow_open_source_submissions: [
        // No pending submission yet, then the created one.
        { data: null, error: null },
        {
          data: {
            id: "s1",
            status: "pending",
            submitted_at: "2026-10-31T00:00:00.000Z",
            updated_at: "2026-10-31T00:00:00.000Z",
            reviewed_at: null,
          },
          error: null,
        },
      ],
    });
  }

  it("keeps the copy's licence, credit and source in the snapshot, whoever submits it", async () => {
    const { db, calls } = submissionDb(copyRow({ prompt_md: "Our own instructions." }));

    const result = await submitOpenSourceWorkflow(db, {
      workflowId: "w1",
      userId: "u1",
      userEmail: "u1@example.com",
      body: { contributor_mode: "named" },
    });

    expect(result).toMatchObject({ ok: true, status: 201 });
    const insert = calls.find(
      (c) => c.table === "workflow_open_source_submissions" && c.op === "insert",
    );
    const snapshot = (insert?.payload as { snapshot: Record<string, unknown> }).snapshot;
    // The submitter is credited for the submission...
    expect(snapshot.metadata).toMatchObject({
      contributors: [expect.objectContaining({ name: "Submitting Lawyer" })],
    });
    // ...and the original work keeps its licence, credit and contributors.
    expect(snapshot.catalog_lineage).toEqual({
      catalog_workflow_key: "proofread",
      catalog_version: "1.1.0",
      license: "MIT",
      attribution: "Proofread by Sample Author (MIT).",
      provenance: COPY_PROVENANCE,
      catalog_modified: true,
    });
  });

  it("records no catalog lineage for a workflow of the user's own", async () => {
    const { db, calls } = submissionDb(
      copyRow({ catalog_workflow_key: null, catalog_version: null, license: null, attribution: null, provenance: null }),
    );

    await submitOpenSourceWorkflow(db, {
      workflowId: "w1",
      userId: "u1",
      userEmail: "u1@example.com",
      body: {},
    });

    const insert = calls.find(
      (c) => c.table === "workflow_open_source_submissions" && c.op === "insert",
    );
    expect((insert?.payload as { snapshot: Record<string, unknown> }).snapshot.catalog_lineage).toBeNull();
  });
});
