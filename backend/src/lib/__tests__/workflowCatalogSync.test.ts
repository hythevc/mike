import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { syncWorkflowCatalog } from "../workflowCatalogSync";

const storage = vi.hoisted(() => ({
  enabled: true,
  uploadFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage", () => ({
  get storageEnabled() {
    return storage.enabled;
  },
  uploadFile: storage.uploadFile,
}));

const COMMIT = "b".repeat(40);

// An adapted workflow with the licence and provenance metadata the catalog's
// converter emits, plus its own LICENSE, NOTICE and CHANGES.md.
const ADAPTED_KEY = "lease-review";
function addAdaptedWorkflow(zip: JSZip, archiveRoot: string) {
  const directory = `${archiveRoot}/assistant-workflows/${ADAPTED_KEY}`;
  zip.file(
    `${directory}/SKILL.md`,
    `---
name: "${ADAPTED_KEY}"
description: "Review a commercial lease and list the points to raise. Draft for lawyer review."
license: "CC-BY-4.0"
metadata:
  version: "1.2.0"
  author: "Sample Author"
  author-organisation: "Sample Practice LLP"
  language: "English"
  mike-display-name: "Lease Review"
  mike-type: "assistant"
  mike-availability: "add-on"
  practice: "Commercial Contracts"
  jurisdictions: "United States"
  source-repository: "example/legal-skills"
  source-commit: "${"d".repeat(40)}"
  source-path: "skills/lease-review"
  source-version: "unversioned"
  license-evidence: "manifest-only"
  author-confirmation: "confirmed 2026-10-01"
  attribution: "Lease Review by Sample Author, CC BY 4.0; modified."
  review-by: "2027-04-30"
---
Review the lease.
`,
  );
  zip.file(`${directory}/LICENSE`, "Creative Commons Attribution 4.0\n");
  zip.file(`${directory}/NOTICE`, "Lease Review\nCopyright 2026 Sample Author\n");
  zip.file(`${directory}/CHANGES.md`, "## 1.2.0 - 2026-10-31\n- Converted.\n");
}

async function sourceArchive(options: { adapted?: boolean } = {}) {
  const zip = new JSZip();
  const archiveRoot = "mike-workflows-test";
  const root = `${archiveRoot}/assistant-workflows/proofread`;
  zip.file(`${archiveRoot}/LICENSE`, "MIT License\n\nCopyright (c) 2026 Mike\n");
  if (options.adapted) addAdaptedWorkflow(zip, archiveRoot);
  zip.file(
    `${root}/SKILL.md`,
    `---
name: "proofread"
description: "Proofread documents"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "Proofread"
  mike-type: "assistant"
  mike-availability: "system"
  practice: "General Transactions"
  jurisdictions: "General"
---
Proofread the document.
`,
  );
  zip.file(`${root}/assets/template.docx`, Buffer.from("template"));
  for (const [key, title] of [
    ["compare-documents", "Compare Documents"],
    ["extract-key-terms", "Extract Key Terms"],
    ["draft-from-template", "Draft From Template"],
  ] as const) {
    zip.file(
      `${archiveRoot}/assistant-workflows/${key}/SKILL.md`,
      `---
name: "${key}"
description: "Test workflow"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "${title}"
  mike-type: "assistant"
  practice: "General Transactions"
  jurisdictions: "General"
---
Run the workflow.
`,
    );
  }
  const tabularKey = "commercial-agreement-tabular-review";
  const tabularRoot = `${archiveRoot}/tabular-review-workflows/${tabularKey}`;
  zip.file(
    `${tabularRoot}/SKILL.md`,
    `---
name: "${tabularKey}"
description: "Test workflow"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "Commercial Agreement Review"
  mike-type: "tabular"
  practice: "General Transactions"
  jurisdictions: "General"
---
Run the workflow.
`,
  );
  zip.file(
    `${tabularRoot}/table-columns.yaml`,
    `columns:
  - index: 0
    name: "Issue"
    prompt: "Identify the issue"
`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("workflow catalog synchronization", () => {
  it("uploads assets, sends no temporary paths to Postgres, and cleans up", async () => {
    storage.enabled = true;
    storage.uploadFile.mockClear();
    const bytes = await sourceArchive();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (new URL(value).hostname === "api.github.com") {
        return new Response(JSON.stringify({ sha: COMMIT }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-sync-test-"),
    );
    try {
      await expect(
        syncWorkflowCatalog({ rpc } as never, {
          temporaryRoot,
          ref: "main",
          fetchImpl,
        }),
      ).resolves.toEqual({
        workflows: 5,
        assets: 1,
        sourceCommit: COMMIT,
      });
      expect(storage.uploadFile).toHaveBeenCalledOnce();
      const [name, args] = rpc.mock.calls[0];
      expect(name).toBe("replace_mike_workflows");
      expect(args.p_source_commit).toBe(COMMIT);
      expect(args.p_workflows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflow_key: "proofread",
            assets: [
              expect.objectContaining({
                filename: "template.docx",
                storage_path: expect.stringContaining(
                  "mike-workflows/proofread/",
                ),
              }),
            ],
          }),
        ]),
      );
      expect(JSON.stringify(args)).not.toContain("temporary_path");
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("fails and cleans up instead of dropping assets without storage", async () => {
    storage.enabled = false;
    const bytes = await sourceArchive();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (new URL(value).hostname === "api.github.com") {
        return new Response(JSON.stringify({ sha: COMMIT }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;
    const rpc = vi.fn();
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-sync-test-"),
    );
    try {
      await expect(
        syncWorkflowCatalog({ rpc } as never, {
          temporaryRoot,
          ref: "main",
          fetchImpl,
        }),
      ).rejects.toThrow("require configured S3-compatible storage");
      expect(rpc).not.toHaveBeenCalled();
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      storage.enabled = true;
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("hands each workflow's licence, evidence, confirmation, credit, provenance, NOTICE and CHANGES to replace_mike_workflows", async () => {
    storage.enabled = true;
    const bytes = await sourceArchive({ adapted: true });
    const fetchImpl = vi.fn(
      async () => new Response(bytes, { status: 200 }),
    ) as unknown as typeof fetch;
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-sync-test-"),
    );
    try {
      await syncWorkflowCatalog({ rpc } as never, {
        temporaryRoot,
        repository: "example/workflow-catalog",
        ref: COMMIT,
        fetchImpl,
      });
      const [, args] = rpc.mock.calls[0];
      const byKey = new Map(
        (args.p_workflows as Array<Record<string, unknown>>).map((w) => [
          w.workflow_key,
          w,
        ]),
      );
      expect(byKey.get(ADAPTED_KEY)).toMatchObject({
        license: "CC-BY-4.0",
        license_evidence: "manifest-only",
        author_confirmation: "confirmed 2026-10-01",
        attribution: "Lease Review by Sample Author, CC BY 4.0; modified.",
        notice_md: "Lease Review\nCopyright 2026 Sample Author",
        changes_md: "## 1.2.0 - 2026-10-31\n- Converted.",
        contributors: [
          expect.objectContaining({ organisation: "Sample Practice LLP" }),
        ],
        provenance: {
          catalog_repository: "example/workflow-catalog",
          catalog_path: `assistant-workflows/${ADAPTED_KEY}`,
          license_file: `assistant-workflows/${ADAPTED_KEY}/LICENSE`,
          source_repository: "example/legal-skills",
          source_path: "skills/lease-review",
          source_commit: "d".repeat(40),
          source_name: null,
          source_version: "unversioned",
          review_by: "2027-04-30",
        },
      });
      // A vendored default relies on the catalog's root licence.
      expect(byKey.get("proofread")).toMatchObject({
        license: "MIT",
        license_evidence: "file",
        author_confirmation: null,
        attribution: null,
        notice_md: null,
        changes_md: null,
        provenance: expect.objectContaining({ license_file: "LICENSE" }),
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
