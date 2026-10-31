import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareWorkflowCatalog,
  removePreparedWorkflowCatalog,
  resolveWorkflowSourceCommit,
  validateWorkflowCatalogDocument,
  type WorkflowCatalogSourceDocument,
  type WorkflowCatalogSourceOptions,
} from "../workflowCatalogSource";
import { WORKFLOW_CATALOG_PIN } from "../workflowCatalogPin";

const COMMIT = "a".repeat(40);

// The catalog's own MIT licence, as a catalog root carries it.
const ROOT_LICENSE = `MIT License

Copyright (c) 2026 Mike

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function skill(options: {
  key: string;
  title: string;
  type: "assistant" | "tabular";
}) {
  return `---
name: "${options.key}"
description: "Test workflow"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "${options.title}"
  mike-type: "${options.type}"
  mike-availability: "system"
  practice: "General Transactions"
  jurisdictions: "General"
---
Run the test workflow.
`;
}

async function archive(options: { duplicate?: boolean } = {}) {
  const zip = new JSZip();
  const root = "mike-workflows-test/";
  zip.file(`${root}LICENSE`, ROOT_LICENSE);
  for (const [key, title] of [
    ["compare-documents", "Compare Documents"],
    ["extract-key-terms", "Extract Key Terms"],
    ["draft-from-template", "Draft From Template"],
  ] as const) {
    zip.file(
      `${root}assistant-workflows/${key}/SKILL.md`,
      skill({ key, title, type: "assistant" }),
    );
  }
  zip.file(
    `${root}assistant-workflows/proofread/SKILL.md`,
    skill({ key: "proofread", title: "Proofread", type: "assistant" }),
  );
  zip.file(
    `${root}assistant-workflows/proofread/assets/template.docx`,
    Buffer.from("test template"),
  );
  const requiredTabular = "commercial-agreement-tabular-review";
  zip.file(
    `${root}tabular-review-workflows/${requiredTabular}/SKILL.md`,
    skill({
      key: requiredTabular,
      title: "Commercial Agreement Review",
      type: "tabular",
    }),
  );
  zip.file(
    `${root}tabular-review-workflows/${requiredTabular}/table-columns.yaml`,
    `columns:
  - index: 0
    name: "Issue"
    prompt: "Identify the issue"
`,
  );
  zip.file(
    `${root}tabular-review-workflows/${options.duplicate ? "proofread" : "test-table"}/SKILL.md`,
    skill({
      key: options.duplicate ? "proofread" : "test-table",
      title: "Test Table",
      type: "tabular",
    }),
  );
  zip.file(
    `${root}tabular-review-workflows/${options.duplicate ? "proofread" : "test-table"}/table-columns.yaml`,
    `columns:
  - index: 0
    name: "Issue"
    prompt: "Identify the issue"
`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function githubFetch(zipBytes: Buffer) {
  return vi.fn(async (url: string | URL | Request) => {
    const value =
      url instanceof Request ? url.url : url instanceof URL ? url.href : url;
    if (new URL(value).hostname === "api.github.com") {
      return new Response(JSON.stringify({ sha: COMMIT }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // BodyInit wants an ArrayBuffer-backed view; Node's Buffer is typed over
    // ArrayBufferLike (it may sit on a SharedArrayBuffer), so hand Response a
    // plain Uint8Array over the same bytes.
    return new Response(new Uint8Array(zipBytes), {
      status: 200,
      headers: { "content-length": String(zipBytes.byteLength) },
    });
  }) as typeof fetch;
}

describe("GitHub workflow catalog preparation", () => {
  it("creates a validated temporary catalog and extracts assets", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-source-test-"),
    );
    try {
      const prepared = await prepareWorkflowCatalog({
        temporaryRoot,
        ref: "main",
        fetchImpl: githubFetch(await archive()),
      });
      const document = validateWorkflowCatalogDocument(
        JSON.parse(await readFile(prepared.catalogPath, "utf8")) as unknown,
      );
      expect(document.source_commit).toBe(COMMIT);
      expect(document.workflows).toHaveLength(6);
      expect(
        document.workflows.find(
          (workflow) => workflow.workflow_key === "proofread",
        ),
      ).toMatchObject({
        distribution: "default",
        default_sort_order: 0,
        quick_action_name: "Proofread",
      });
      const asset = document.workflows.find(
        (workflow) => workflow.workflow_key === "proofread",
      )!.assets[0];
      expect(asset).toMatchObject({
        filename: "template.docx",
        file_type: "docx",
        size_bytes: 13,
      });
      await expect(readFile(asset.temporary_path, "utf8")).resolves.toBe(
        "test template",
      );

      await removePreparedWorkflowCatalog(prepared);
      await expect(readFile(prepared.catalogPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects duplicate workflow keys and cleans its temporary directory", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-source-test-"),
    );
    try {
      await expect(
        prepareWorkflowCatalog({
          temporaryRoot,
          ref: "main",
          fetchImpl: githubFetch(await archive({ duplicate: true })),
        }),
      ).rejects.toThrow("duplicate key 'proofread'");
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects oversized downloads before parsing and cleans up", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (new URL(value).hostname === "api.github.com") {
        return new Response(JSON.stringify({ sha: COMMIT }), { status: 200 });
      }
      return new Response("oversized", {
        status: 200,
        headers: { "content-length": String(11 * 1024 * 1024) },
      });
    }) as typeof fetch;
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-source-test-"),
    );
    try {
      await expect(
        prepareWorkflowCatalog({ temporaryRoot, ref: "main", fetchImpl }),
      ).rejects.toThrow("10 MB compressed limit");
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Licence gates, provenance and the never-ship rules.
// ---------------------------------------------------------------------------

type Entry = { path: string; contents: string | Buffer; mode?: number };

const ROOT = "catalog-0123abc";

// A copy of the five upstream defaults as the pinned catalog commit ships
// them: their frontmatter verbatim (bodies shortened), no licence metadata,
// and the catalog's MIT LICENSE at the archive root.
function upstreamDefaults(): Entry[] {
  const defaults: Array<[string, string, string, string, string]> = [
    [
      "assistant-workflows",
      "proofread",
      "Review the uploaded document for drafting quality, internal consistency, and mechanical errors.",
      "1.1.0",
      "Proofread",
    ],
    [
      "assistant-workflows",
      "compare-documents",
      "Compare the uploaded documents in a structured table, highlighting key similarities, differences, risks, and follow-up points.",
      "1.0.0",
      "Compare Documents",
    ],
    [
      "assistant-workflows",
      "extract-key-terms",
      "Extract the key legal, commercial, and operational terms from the uploaded documents.",
      "1.0.0",
      "Extract Key Terms",
    ],
    [
      "assistant-workflows",
      "draft-from-template",
      "Edit a copy of an uploaded template using the user's instructions and source materials while preserving the original file.",
      "1.0.0",
      "Draft from Template",
    ],
    [
      "tabular-review-workflows",
      "commercial-agreement-tabular-review",
      "Use this workflow to review uploaded documents and extract structured information into the tabular review columns defined in table-columns.yaml.",
      "1.0.0",
      "Commercial Agreement Tabular Review",
    ],
  ];
  const entries: Entry[] = [{ path: "LICENSE", contents: ROOT_LICENSE }];
  for (const [collection, key, description, version, title] of defaults) {
    const type = collection === "assistant-workflows" ? "assistant" : "tabular";
    entries.push({
      path: `${collection}/${key}/SKILL.md`,
      contents: `---
name: "${key}"
description: "${description}"
license: "MIT"
metadata:
  version: "${version}"
  author: "${key === "proofread" ? "Anna Guo" : "Open Legal Products"}"
  language: "English"
  mike-display-name: "${title}"
  mike-type: "${type}"
  mike-availability: "system"
  practice: "General Transactions"
  jurisdictions: "General"
---
# ${title}

## Instructions

Follow the workflow.
`,
    });
    if (type === "tabular") {
      entries.push({
        path: `${collection}/${key}/table-columns.yaml`,
        contents: `columns:
  - index: 0
    name: "Party"
    prompt: "Identify each party"
`,
      });
    }
  }
  return entries;
}

type ConvertedOptions = {
  key?: string;
  license?: string;
  evidence?: string | null;
  confirmation?: string | null;
  attribution?: string | null;
  folderLicense?: boolean;
  notice?: string | null;
  changes?: string | null;
};

const ADAPTED_KEY = "supplier-agreement-review";
const ADAPTED_DIRECTORY = `assistant-workflows/sample-pack/${ADAPTED_KEY}`;

// An adapted third-party workflow in a pack, with the provenance metadata the
// catalog's converter emits.
function adaptedWorkflow(options: ConvertedOptions = {}): Entry[] {
  const key = options.key ?? ADAPTED_KEY;
  const directory = `assistant-workflows/sample-pack/${key}`;
  const metadataLine = (name: string, value: string | null | undefined) =>
    value === null || value === undefined ? "" : `  ${name}: "${value}"\n`;
  const entries: Entry[] = [
    {
      path: "assistant-workflows/sample-pack/pack.yaml",
      contents: `id: "sample"
title: "Sample Pack"
description: "Sample workflows that each keep their own licence."
version: "1.0.0"
workflows:
  - "${key}"
`,
    },
    {
      path: `${directory}/SKILL.md`,
      contents: `---
name: "${key}"
description: "Review a supplier agreement and list the points to negotiate. Draft for lawyer review."
license: "${options.license ?? "Apache-2.0"}"
metadata:
  version: "1.0.0"
  author: "Sample Author"
  author-organisation: "Sample Practice LLP"
  language: "English"
  language-code: "en"
  mike-display-name: "Supplier Agreement Review"
  mike-type: "assistant"
  mike-availability: "add-on"
  practice: "Commercial Contracts"
  jurisdictions: "United States"
  jurisdiction-codes: "US"
  source-repository: "example/legal-skills"
  source-commit: "${"c".repeat(40)}"
  source-path: "skills/supplier-agreement"
  source-name: "supplier-agreement"
  source-version: "2.1.0"
${metadataLine("license-evidence", options.evidence === undefined ? "file" : options.evidence)}${metadataLine("author-confirmation", options.confirmation === undefined ? "not-required" : options.confirmation)}${metadataLine("attribution", options.attribution === undefined ? "Adapted from Supplier Agreement by Sample Author (Apache-2.0)." : options.attribution)}  copilot-block: "v1"
  review-by: "2027-10-31"
---
# Supplier Agreement Review

Review the agreement.
`,
    },
  ];
  if (options.folderLicense !== false) {
    entries.push({
      path: `${directory}/LICENSE`,
      contents: "Apache License\nVersion 2.0, January 2004\n",
    });
  }
  if (options.notice !== null) {
    entries.push({
      path: `${directory}/NOTICE`,
      contents: options.notice ?? "Supplier Agreement\r\nCopyright 2026 Sample Author\r\n",
    });
  }
  if (options.changes !== null) {
    entries.push({
      path: `${directory}/CHANGES.md`,
      contents:
        options.changes ??
        "## 1.0.0 - 2026-10-31\n- Converted to the workflow format.\n",
    });
  }
  return entries;
}

async function zipOf(entries: Entry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(
      `${ROOT}/${entry.path}`,
      entry.contents,
      entry.mode === undefined ? undefined : { unixPermissions: entry.mode },
    );
  }
  // UNIX platform, as GitHub's archives record file modes.
  return Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" }),
  );
}

async function parse(
  entries: Entry[],
  options: Partial<WorkflowCatalogSourceOptions> = {},
): Promise<WorkflowCatalogSourceDocument> {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "catalog-source-test-"),
  );
  try {
    const prepared = await prepareWorkflowCatalog({
      temporaryRoot,
      repository: "example/workflow-catalog",
      ref: COMMIT,
      fetchImpl: githubFetch(await zipOf(entries)),
      ...options,
    });
    try {
      return validateWorkflowCatalogDocument(
        JSON.parse(await readFile(prepared.catalogPath, "utf8")) as unknown,
      );
    } finally {
      await removePreparedWorkflowCatalog(prepared);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function withSkillLicense(entries: Entry[], license: string): Entry[] {
  return entries.map((entry) =>
    entry.path.endsWith("/SKILL.md")
      ? {
          ...entry,
          contents: String(entry.contents).replace(
            /^license: .*$/m,
            `license: "${license}"`,
          ),
        }
      : entry,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("catalog licences", () => {
  it("still parses a copy of the upstream defaults (frontmatter plus root LICENSE)", async () => {
    const document = await parse(upstreamDefaults());

    expect(document.workflows).toHaveLength(5);
    for (const workflow of document.workflows) {
      expect(workflow).toMatchObject({
        license: "MIT",
        license_evidence: "file",
        author_confirmation: null,
        attribution: null,
        notice_md: null,
        changes_md: null,
        provenance: {
          catalog_repository: "example/workflow-catalog",
          license_file: "LICENSE",
          source_repository: null,
          source_commit: null,
          review_by: null,
        },
      });
    }
    expect(
      document.workflows.find((w) => w.workflow_key === "proofread"),
    ).toMatchObject({
      version: "1.1.0",
      contributors: [{ name: "Anna Guo", organisation: null }],
      provenance: { catalog_path: "assistant-workflows/proofread" },
    });
  });

  it("refuses defaults that carry no licence file anywhere in the archive", async () => {
    await expect(
      parse(upstreamDefaults().filter((entry) => entry.path !== "LICENSE")),
    ).rejects.toThrow(/Workflow '[a-z-]+' has no licence file/);
  });

  it.each(["GPL-3.0", "CC-BY-NC-4.0"])(
    "refuses the %s licence with a message naming the workflow",
    async (license) => {
      const entries = [
        ...upstreamDefaults(),
        ...adaptedWorkflow({ license }),
      ];
      await expect(parse(entries)).rejects.toThrow(
        `Workflow '${ADAPTED_KEY}' declares licence "${license}"`,
      );
    },
  );

  it("accepts the deprecated AGPL-3.0 identifier and stores it as AGPL-3.0-only", async () => {
    const document = await parse([
      ...upstreamDefaults(),
      ...adaptedWorkflow({ license: "AGPL-3.0" }),
    ]);
    expect(
      document.workflows.find((w) => w.workflow_key === ADAPTED_KEY)?.license,
    ).toBe("AGPL-3.0-only");
  });

  it.each([
    ["AGPL-3.0-or-later", "AGPL-3.0-or-later"],
    ["mit", "MIT"],
    ["cc-by-4.0", "CC-BY-4.0"],
  ])("accepts %s as %s", async (declared, stored) => {
    const document = await parse(withSkillLicense(upstreamDefaults(), declared));
    expect(new Set(document.workflows.map((w) => w.license))).toEqual(
      new Set([stored]),
    );
  });

  it("refuses a manifest-only licence without the author's confirmation while the flag is on", async () => {
    const entries = [
      ...upstreamDefaults(),
      ...adaptedWorkflow({ evidence: "manifest-only", confirmation: null }),
    ];
    // On by default.
    await expect(parse(entries)).rejects.toThrow(
      `Workflow '${ADAPTED_KEY}' declares its licence only in a manifest`,
    );
    vi.stubEnv("MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES", "true");
    await expect(parse(entries)).rejects.toThrow("only in a manifest");
    // An unrecognised value keeps the gate closed.
    vi.stubEnv("MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES", "flase");
    await expect(parse(entries)).rejects.toThrow("only in a manifest");
  });

  it("accepts a manifest-only licence once the author's confirmation is recorded", async () => {
    const document = await parse([
      ...upstreamDefaults(),
      ...adaptedWorkflow({
        evidence: "manifest-only",
        confirmation: "confirmed 2026-10-20",
      }),
    ]);
    expect(
      document.workflows.find((w) => w.workflow_key === ADAPTED_KEY),
    ).toMatchObject({
      license_evidence: "manifest-only",
      author_confirmation: "confirmed 2026-10-20",
    });
  });

  it("lets an unconfirmed manifest-only licence through only when the flag is off", async () => {
    const entries = [
      ...upstreamDefaults(),
      ...adaptedWorkflow({ evidence: "manifest-only", confirmation: "pending" }),
    ];
    vi.stubEnv("MIKE_WORKFLOWS_REQUIRE_CONFIRMED_LICENSES", "false");
    const document = await parse(entries);
    expect(
      document.workflows.find((w) => w.workflow_key === ADAPTED_KEY),
    ).toMatchObject({
      license_evidence: "manifest-only",
      author_confirmation: "pending",
    });
    await expect(
      parse(entries, { requireConfirmedLicenses: true }),
    ).rejects.toThrow(`Workflow '${ADAPTED_KEY}' is waiting for its author`);
  });

  it("refuses a pending author confirmation even with licence-file evidence", async () => {
    await expect(
      parse([
        ...upstreamDefaults(),
        ...adaptedWorkflow({ evidence: "file", confirmation: "pending" }),
      ]),
    ).rejects.toThrow(`Workflow '${ADAPTED_KEY}' is waiting for its author`);
  });

  it.each([
    ["an unknown evidence class", { evidence: "manifest" }, "invalid license-evidence"],
    ["a malformed confirmation", { confirmation: "confirmed" }, "invalid author-confirmation"],
    ["an impossible confirmation date", { evidence: "manifest-only", confirmation: "confirmed 2026-02-30" }, "invalid author-confirmation"],
    ["no LICENSE in its own folder", { folderLicense: false }, "has no LICENSE file"],
    ["no CHANGES.md", { changes: null }, "has no CHANGES.md"],
    ["no attribution", { attribution: null }, "has no attribution credit line"],
  ] as const)(
    "refuses an adapted workflow with %s",
    async (_label, options, message) => {
      await expect(
        parse([...upstreamDefaults(), ...adaptedWorkflow(options)]),
      ).rejects.toThrow(new RegExp(`Workflow '${ADAPTED_KEY}'.*${message}`));
    },
  );

  it("reads licence, provenance, NOTICE and CHANGES into the payload and its hash", async () => {
    const document = await parse([
      ...upstreamDefaults(),
      ...adaptedWorkflow(),
    ]);
    const adapted = document.workflows.find(
      (w) => w.workflow_key === ADAPTED_KEY,
    )!;
    expect(adapted).toMatchObject({
      distribution: "addon",
      license: "Apache-2.0",
      license_evidence: "file",
      author_confirmation: "not-required",
      attribution:
        "Adapted from Supplier Agreement by Sample Author (Apache-2.0).",
      contributors: [
        { name: "Sample Author", organisation: "Sample Practice LLP" },
      ],
      // Stored with LF line endings.
      notice_md: "Supplier Agreement\nCopyright 2026 Sample Author",
      changes_md: "## 1.0.0 - 2026-10-31\n- Converted to the workflow format.",
      provenance: {
        catalog_repository: "example/workflow-catalog",
        catalog_path: ADAPTED_DIRECTORY,
        license_file: `${ADAPTED_DIRECTORY}/LICENSE`,
        source_repository: "example/legal-skills",
        source_path: "skills/supplier-agreement",
        source_commit: "c".repeat(40),
        source_name: "supplier-agreement",
        source_version: "2.1.0",
        review_by: "2027-10-31",
      },
    });

    // The credit and notices are part of the content hash.
    const recredited = await parse([
      ...upstreamDefaults(),
      ...adaptedWorkflow({ attribution: "Adapted from Supplier Agreement." }),
    ]);
    const renoticed = await parse([
      ...upstreamDefaults(),
      ...adaptedWorkflow({ notice: "Different notice" }),
    ]);
    const hashOf = (doc: WorkflowCatalogSourceDocument) =>
      doc.workflows.find((w) => w.workflow_key === ADAPTED_KEY)!.content_hash;
    expect(hashOf(recredited)).not.toBe(adapted.content_hash);
    expect(hashOf(renoticed)).not.toBe(adapted.content_hash);
    expect(hashOf(await parse([...upstreamDefaults(), ...adaptedWorkflow()])))
      .toBe(adapted.content_hash);
  });
});

describe("never-ship rules", () => {
  const inAdapted = (relative: string, contents: string | Buffer = "x", mode?: number): Entry =>
    ({ path: `${ADAPTED_DIRECTORY}/${relative}`, contents, mode });

  it.each([
    ["a .py asset", inAdapted("assets/helper.py", "print(1)"), "contains a script or executable file"],
    ["a scripts/ folder", inAdapted("scripts/build.md"), "contains a scripts/ folder"],
    ["a bin/ folder", inAdapted("bin/tool.txt"), "contains a bin/ folder"],
    ["a hooks/ folder", inAdapted("hooks/pre.txt"), "contains a hooks/ folder"],
    ["a macro-enabled Word asset", inAdapted("assets/template.docm"), "contains a script or executable file"],
    ["a .wasm binary", inAdapted("source/module.wasm"), "contains a script or executable file"],
    ["a symlink", inAdapted("assets/link.docx", "../../../LICENSE", 0o120777), "contains a symlink"],
    ["an executable file", inAdapted("assets/run", "binary", 0o100755), "contains an executable file"],
    ["an asset that is a script", inAdapted("assets/notes.txt", "#!/bin/sh\necho hi\n"), "is a script"],
  ] as const)("refuses %s and names the workflow", async (_label, entry, message) => {
    await expect(
      parse([...upstreamDefaults(), ...adaptedWorkflow(), entry]),
    ).rejects.toThrow(new RegExp(`Workflow '${ADAPTED_KEY}'.*${message}`));
  });

  it("refuses a '..' path that would leave the workflow folder", async () => {
    await expect(
      parse([
        ...upstreamDefaults(),
        ...adaptedWorkflow(),
        { path: `${ADAPTED_DIRECTORY}/assets/../../../escaped.docx`, contents: "x" },
      ]),
    ).rejects.toThrow("unsafe path");
  });

  it.each([
    ["a '.' segment", `${ADAPTED_DIRECTORY}/./assets/a.docx`],
    ["a backslash", `${ADAPTED_DIRECTORY}/assets\\..\\a.docx`],
  ])("refuses %s in an archive path", async (_label, entryPath) => {
    await expect(
      parse([...upstreamDefaults(), { path: entryPath, contents: "x" }]),
    ).rejects.toThrow("unsafe path");
  });

  it("ignores scripts outside the workflow collections, such as catalog tooling", async () => {
    const document = await parse([
      ...upstreamDefaults(),
      { path: "workflow-schema/validate-workflows.py", contents: "print(1)", mode: 0o100755 },
      { path: "tools/convert/index.ts", contents: "export {};" },
    ]);
    expect(document.workflows).toHaveLength(5);
  });
});

describe("pinned catalog source", () => {
  it("syncs the pinned repository and commit when nothing is configured", async () => {
    vi.stubEnv("MIKE_WORKFLOWS_REPOSITORY", "");
    vi.stubEnv("MIKE_WORKFLOWS_REF", "");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(resolveWorkflowSourceCommit({ fetchImpl })).resolves.toEqual({
      repository: WORKFLOW_CATALOG_PIN.repository,
      ref: WORKFLOW_CATALOG_PIN.commit,
      commit: WORKFLOW_CATALOG_PIN.commit,
    });
    // A full commit needs no GitHub API call.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(WORKFLOW_CATALOG_PIN.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("requires a ref for any repository other than the pinned one", async () => {
    vi.stubEnv("MIKE_WORKFLOWS_REF", "");
    await expect(
      resolveWorkflowSourceCommit({ repository: "example/workflow-catalog" }),
    ).rejects.toThrow("MIKE_WORKFLOWS_REF must be set");
  });

  it("refuses a branch ref under NODE_ENV=production, before any request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      resolveWorkflowSourceCommit({ ref: "main", fetchImpl }),
    ).rejects.toThrow("must be a 40-character commit SHA in production");
    vi.stubEnv("MIKE_WORKFLOWS_REF", "v1.0.0");
    await expect(resolveWorkflowSourceCommit({ fetchImpl })).rejects.toThrow(
      "40-character commit SHA",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a 40-character commit under NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const commit = "0123456789abcdef0123456789abcdef01234567";
    await expect(
      resolveWorkflowSourceCommit({
        repository: "example/workflow-catalog",
        ref: commit.toUpperCase(),
      }),
    ).resolves.toEqual({
      repository: "example/workflow-catalog",
      ref: commit,
      commit,
    });
  });
});
