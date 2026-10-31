import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, eq, copyFile, downloadFile, uploadFile, deleteFile, docxToPdf, reportError } =
  vi.hoisted(() => ({
    from: vi.fn(),
    eq: vi.fn(),
    copyFile: vi.fn(),
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    docxToPdf: vi.fn(),
    reportError: vi.fn(),
  }));

vi.mock("../../lib/observability/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/observability/sentry")>()),
  reportError,
}));

vi.mock("../../lib/supabase", () => ({
  // Asset versions are created in one batch through the documents facade.
  createServerSupabase: () => ({ from, rpc: async (name: string, args: { p_versions: Record<string, unknown>[] }) => {
    expect(name).toBe("create_document_versions");
    for (const version of args.p_versions) {
      await from("document_versions").insert(version);
    }
    return { data: null, error: null };
  } }),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.userId = "u1";
    next();
  },
}));

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  return {
    ...actual,
    copyFile,
    downloadFile,
    uploadFile,
    deleteFile,
  };
});

vi.mock("../../lib/convert", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/convert")>();
  return { ...actual, docxToPdf };
});

import { AppError } from "../../lib/appError";
import { workflowAddonsRouter } from "../../modules/workflows/workflowAddons.routes";

function queryReturning(data: unknown[]) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "order", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.eq = eq.mockImplementation(() => query);
  query.then = (
    resolve: (value: unknown) => unknown,
    reject?: (error: unknown) => unknown,
  ) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return query;
}

function singleQueryReturning(data: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "insert", "delete", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => ({ data, error: null }));
  query.maybeSingle = vi.fn(async () => ({ data, error: null }));
  query.then = (
    resolve: (value: unknown) => unknown,
    reject?: (error: unknown) => unknown,
  ) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return query;
}

const app = express();
app.use(express.json());
app.use("/workflow-addons", workflowAddonsRouter);

describe("workflow add-on catalog routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyFile.mockResolvedValue(undefined);
    downloadFile.mockResolvedValue(
      new TextEncoder().encode("reference").buffer,
    );
    uploadFile.mockResolvedValue(undefined);
    deleteFile.mockResolvedValue(undefined);
    docxToPdf.mockResolvedValue(Buffer.from("converted-pdf"));
  });

  it("lists only active add-ons and preserves the public addon_key field", async () => {
    from.mockImplementation((table: string) =>
      table === "mike_workflows"
        ? queryReturning([
            {
              id: "c0a7a1e1-0000-4000-8000-000000000001",
              workflow_key: "design-partner-draft",
              title: "Design Partner Draft",
              type: "assistant",
              active: true,
            },
          ])
        : queryReturning([
            {
              id: "reference-1",
              mike_workflow_id: "c0a7a1e1-0000-4000-8000-000000000001",
              filename: "Precedent.docx",
              file_type: "docx",
              size_bytes: 42,
              created_at: "2026-08-28T00:00:00.000Z",
            },
          ]),
    );

    const response = await request(app).get("/workflow-addons?type=assistant");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "c0a7a1e1-0000-4000-8000-000000000001",
        addon_key: "design-partner-draft",
        title: "Design Partner Draft",
      }),
    ]);
    expect(response.body[0]).not.toHaveProperty("workflow_key");
    expect(response.body[0].assets).toEqual([
      expect.objectContaining({
        id: "reference-1",
        filename: "Precedent.docx",
      }),
    ]);
    expect(eq).toHaveBeenCalledWith("distribution", "addon");
    expect(eq).toHaveBeenCalledWith("active", true);
    expect(eq).toHaveBeenCalledWith("type", "assistant");
  });

  // workflow_addons.id is a uuid; a malformed id used to reach Postgres as
  // `uuid = 'nope'` (22P02) and, once lookup errors stopped being swallowed,
  // surfaced as a 500 where main answered 404. The router guards the param.
  it("answers 404, not 500, for a malformed add-on id on every route", async () => {
    for (const [method, path] of [
      ["get", "/workflow-addons/nope"],
      ["post", "/workflow-addons/nope/import"],
      ["get", "/workflow-addons/nope/assets/reference-1/display"],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      expect(res.body).toEqual({ detail: "Add-on not found" });
    }
  });

  it("copies catalog assets into documents and document versions when imported", async () => {
    const insertedDocuments: unknown[] = [];
    const insertedVersions: unknown[] = [];
    const insertedWorkflows: unknown[] = [];
    const provenance = {
      catalog_repository: "example/workflow-catalog",
      catalog_path: "assistant-workflows/design-partner-draft",
      license_file: "LICENSE",
    };
    from.mockImplementation((table: string) => {
      if (table === "mike_workflows") {
        return singleQueryReturning({
          id: "c0a7a1e1-0000-4000-8000-000000000001",
          workflow_key: "design-partner-draft",
          version: "1.0.0",
          title: "Design Partner Draft",
          type: "assistant",
          prompt_md: "Draft from the precedent.",
          columns_config: null,
          language: "English",
          practice: "General Transactions",
          jurisdictions: ["General"],
          license: "MIT",
          attribution: "Design Partner Draft by Open Legal Products.",
          provenance,
          source_commit: "a".repeat(40),
        });
      }
      if (table === "workflows") {
        const query = singleQueryReturning({
          id: "workflow-1",
          user_id: "u1",
          title: "Design Partner Draft",
          type: "assistant",
          prompt_md: "Draft from the precedent.",
          columns_config: null,
          language: "English",
          practice: "General Transactions",
          jurisdictions: ["General"],
          created_at: "2026-08-28T00:00:00.000Z",
          catalog_workflow_key: "design-partner-draft",
          catalog_version: "1.0.0",
          license: "MIT",
          attribution: "Design Partner Draft by Open Legal Products.",
          provenance,
        });
        query.insert = vi.fn((value: unknown) => {
          insertedWorkflows.push(value);
          return query;
        });
        return query;
      }
      if (table === "mike_workflow_assets") {
        return queryReturning([
          {
            filename: "Precedent.docx",
            file_type: "docx",
            storage_path: "mike-workflows/c0a7a1e1-0000-4000-8000-000000000001/precedent.docx",
            size_bytes: 9,
          },
        ]);
      }
      if (table === "documents") {
        const query = singleQueryReturning(null);
        query.insert = vi.fn((value: unknown) => {
          insertedDocuments.push(...[value].flat());
          return query;
        });
        query.update = vi.fn(() => query);
        query.in = vi.fn(() => query);
        return query;
      }
      if (table === "document_versions") {
        const query = singleQueryReturning(null);
        query.insert = vi.fn((value: unknown) => {
          insertedVersions.push(value);
          return query;
        });
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await request(app).post(
      "/workflow-addons/c0a7a1e1-0000-4000-8000-000000000001/import",
    );

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    // The copy keeps the add-on's licence, credit and provenance, and reports
    // where it stands against the catalog.
    expect(insertedWorkflows).toEqual([
      expect.objectContaining({
        catalog_workflow_key: "design-partner-draft",
        catalog_version: "1.0.0",
        license: "MIT",
        attribution: "Design Partner Draft by Open Legal Products.",
        provenance: expect.objectContaining({
          ...provenance,
          catalog_commit: "a".repeat(40),
        }),
      }),
    ]);
    expect(response.body).toMatchObject({
      id: "workflow-1",
      license: "MIT",
      attribution: "Design Partner Draft by Open Legal Products.",
      provenance,
      catalog_workflow_key: "design-partner-draft",
      catalog_status: "current",
      is_default: false,
    });
    // The source object is copied server-side through the documents module;
    // the Word file's PDF rendition is rendered from its bytes.
    expect(copyFile).toHaveBeenCalledWith(
      "mike-workflows/c0a7a1e1-0000-4000-8000-000000000001/precedent.docx",
      expect.stringMatching(/^documents\/u1\/.+\/source\.docx$/),
    );
    expect(downloadFile).toHaveBeenCalledWith(
      "mike-workflows/c0a7a1e1-0000-4000-8000-000000000001/precedent.docx",
    );
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(insertedDocuments).toEqual([
      expect.objectContaining({
        workflow_id: "workflow-1",
        user_id: "u1",
        library_kind: "workflow_asset",
      }),
    ]);
    expect(insertedVersions).toEqual([
      expect.objectContaining({
        filename: "Precedent.docx",
        file_type: "docx",
        version_number: 1,
        pdf_storage_path: expect.stringMatching(
          /^converted-pdfs\/u1\/.+\.pdf$/,
        ),
      }),
    ]);
    expect(docxToPdf).toHaveBeenCalledOnce();
  });

  it("answers a fixed 500 for a failed asset copy and reports it once, with the cause", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cause = Object.assign(new Error("bucket gone"), { name: "NoSuchKey" });
    copyFile.mockRejectedValue(cause);
    from.mockImplementation((table: string) => {
      if (table === "mike_workflows") {
        return singleQueryReturning({
          id: "c0a7a1e1-0000-4000-8000-000000000001",
          title: "Design Partner Draft",
          type: "assistant",
          prompt_md: "Draft from the precedent.",
          columns_config: null,
          language: "English",
          practice: "General Transactions",
          jurisdictions: ["General"],
        });
      }
      if (table === "workflows") {
        return singleQueryReturning({ id: "workflow-1", user_id: "u1" });
      }
      // The target key of the failed copy goes to the durable cleanup job.
      if (table === "db_jobs") {
        return singleQueryReturning({ id: "job-1" });
      }
      if (table === "mike_workflow_assets") {
        return queryReturning([
          {
            filename: "Precedent.docx",
            file_type: "docx",
            storage_path: "mike-workflows/c0a7a1e1-0000-4000-8000-000000000001/precedent.docx",
            size_bytes: 9,
          },
        ]);
      }
      throw new Error(`Unexpected table ${table}`);
    });

    try {
      const response = await request(app).post(
        "/workflow-addons/c0a7a1e1-0000-4000-8000-000000000001/import",
      );

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ detail: "Failed to copy add-on assets" });
      // What failed travels under its kind with the storage error as the
      // cause; the response never learns more than the fixed detail.
      expect(reportError).toHaveBeenCalledTimes(1);
      const [reported] = reportError.mock.calls[0];
      expect(reported).toBeInstanceOf(AppError);
      expect(reported.kind).toBe("workflows.addon_failed");
      expect(reported.cause).toBe(cause);
      // Logged as the reported object, so the console bridge files it once.
      expect(consoleError).toHaveBeenCalledWith(
        "[workflow-addons] import failed",
        reported,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("streams an add-on asset and converts presentations for PdfView", async () => {
    from.mockImplementation((table: string) => {
      if (table === "mike_workflows") {
        return singleQueryReturning({
          id: "c0a7a1e1-0000-4000-8000-000000000001",
          type: "assistant",
        });
      }
      if (table === "mike_workflow_assets") {
        return singleQueryReturning({
          id: "reference-1",
          filename: "Deck.pptx",
          file_type: "pptx",
          storage_path: "mike-workflows/c0a7a1e1-0000-4000-8000-000000000001/deck.pptx",
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await request(app).get(
      "/workflow-addons/c0a7a1e1-0000-4000-8000-000000000001/assets/reference-1/display",
    );

    expect(response.status).toBe(200);
    expect(downloadFile).toHaveBeenCalledWith(
      "mike-workflows/c0a7a1e1-0000-4000-8000-000000000001/deck.pptx",
    );
    expect(docxToPdf).toHaveBeenCalledTimes(1);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toContain("Deck.pdf");
    expect(Buffer.from(response.body).toString()).toBe("converted-pdf");
  });
});
